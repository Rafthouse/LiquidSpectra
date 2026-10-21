#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>

namespace LiquidAudio {

/**
 * ITU-R BS.1770-4 / EBU R128 loudness meter.
 *  - K-weighting (head shelf + RLB high-pass) derived for any sample rate
 *  - Momentary (400 ms), Short-term (3 s), gated Integrated loudness
 *  - Loudness Range per EBU Tech 3342, 4x oversampled True Peak on the unweighted signal
 *
 * processBlock() is real-time safe: no allocation, no locks. Gating history is kept in
 * fixed 0.1 dB histograms (exact power sums per bin), so memory does not grow with time.
 * Results are published through atomics and may be read from any thread.
 */
class LoudnessMeterEBU
{
public:
    static constexpr int MAX_CHANNELS = 2;
    static constexpr float SILENCE_DB = -90.0f;

    LoudnessMeterEBU() { prepare (48000.0); }

    /** Not real-time safe in spirit (call from prepareToPlay), but it does not allocate either. */
    void prepare (double sampleRate)
    {
        makeKWeighting (sampleRate);
        makeTruePeakInterpolator();
        subBlockSize = std::max (1, (int) std::lround (sampleRate * 0.1));
        resetState();
        publish();
    }

    /** Thread-safe request; the audio thread clears its state at the start of the next block. */
    void requestReset() noexcept { resetRequested.store (true, std::memory_order_release); }

    void processBlock (const float* const* channels, int numChannels, int numSamples) noexcept
    {
        if (resetRequested.exchange (false, std::memory_order_acq_rel))
        {
            resetState();
            publish();
        }

        numChannels = std::clamp (numChannels, 0, MAX_CHANNELS);
        if (numChannels == 0 || numSamples <= 0)
            return;

        for (int i = 0; i < numSamples; ++i)
        {
            double energy = 0.0;
            for (int ch = 0; ch < numChannels; ++ch)
            {
                const double x = channels[ch][i];
                trackTruePeak (ch, x);

                // K-weighting, transposed direct form II, double precision
                auto& st = filterState[(size_t) ch];
                const double y1 = shelf.b0 * x + st[0];
                st[0] = shelf.b1 * x - shelf.a1 * y1 + st[1];
                st[1] = shelf.b2 * x - shelf.a2 * y1;
                const double y2 = highPass.b0 * y1 + st[2];
                st[2] = highPass.b1 * y1 - highPass.a1 * y2 + st[3];
                st[3] = highPass.b2 * y1 - highPass.a2 * y2;

                energy += y2 * y2; // channel weight 1.0 for L / R
            }

            subBlockEnergy += energy;
            if (++subBlockFill >= subBlockSize)
                completeSubBlock();
        }
    }

    float getMomentaryLUFS() const noexcept       { return momentary.load (std::memory_order_relaxed); }
    float getShortTermLUFS() const noexcept       { return shortTerm.load (std::memory_order_relaxed); }
    float getIntegratedLUFS() const noexcept      { return integrated.load (std::memory_order_relaxed); }
    float getLoudnessRangeLU() const noexcept     { return loudnessRange.load (std::memory_order_relaxed); }
    /** Maximum true peak since the last reset (dBTP). */
    float getTruePeakDb() const noexcept          { return truePeakMaxDb.load (std::memory_order_relaxed); }
    /** True peak of one channel over the last ~400 ms (dBTP), for meter bars. */
    float getRecentTruePeakDb (int channel) const noexcept
    {
        return channel >= 0 && channel < MAX_CHANNELS ? recentTruePeakDb[(size_t) channel].load (std::memory_order_relaxed)
                                                       : SILENCE_DB;
    }

private:
    struct Biquad { double b0, b1, b2, a1, a2; };

    static constexpr int TP_OVERSAMPLING = 4;
    static constexpr int TP_TAPS = 12; // taps per polyphase branch

    // 0.1 dB histogram bins spanning -70 .. +10 LUFS for the gating history
    static constexpr double HIST_MIN_DB = -70.0;
    static constexpr double HIST_STEP_DB = 0.1;
    static constexpr int HIST_BINS = 800;

    struct Histogram
    {
        std::array<std::uint32_t, HIST_BINS> counts {};
        std::array<double, HIST_BINS> powerSums {};

        void clear() noexcept { counts.fill (0); powerSums.fill (0.0); }

        void add (double power) noexcept
        {
            const double lufs = powerToLufs (power);
            if (lufs <= HIST_MIN_DB) // absolute gate
                return;
            const int bin = std::clamp ((int) ((lufs - HIST_MIN_DB) / HIST_STEP_DB), 0, HIST_BINS - 1);
            ++counts[(size_t) bin];
            powerSums[(size_t) bin] += power;
        }

        static double binCentreDb (int bin) noexcept { return HIST_MIN_DB + (bin + 0.5) * HIST_STEP_DB; }

        /** Mean power of all entries in bins whose centre lies above gateDb. */
        bool meanPowerAbove (double gateDb, double& meanPower) const noexcept
        {
            double sum = 0.0;
            std::uint64_t n = 0;
            for (int b = 0; b < HIST_BINS; ++b)
            {
                if (binCentreDb (b) <= gateDb)
                    continue;
                sum += powerSums[(size_t) b];
                n += counts[(size_t) b];
            }
            if (n == 0)
                return false;
            meanPower = sum / (double) n;
            return true;
        }
    };

    static double powerToLufs (double power) noexcept
    {
        return power > 0.0 ? -0.691 + 10.0 * std::log10 (power) : (double) SILENCE_DB;
    }

    static float linearToDb (double linear) noexcept
    {
        return linear > 1.0e-6 ? (float) (20.0 * std::log10 (linear)) : SILENCE_DB;
    }

    // Same derivation as libebur128: exact BS.1770 coefficients at 48 kHz, matched elsewhere
    void makeKWeighting (double sampleRate) noexcept
    {
        constexpr double pi = 3.14159265358979323846;

        double f0 = 1681.974450955533;
        const double gainDb = 3.999843853973347;
        double q = 0.7071752369554196;
        double k = std::tan (pi * f0 / sampleRate);
        const double vh = std::pow (10.0, gainDb / 20.0);
        const double vb = std::pow (vh, 0.4996667741545416);
        double a0 = 1.0 + k / q + k * k;
        shelf = { (vh + vb * k / q + k * k) / a0,
                  2.0 * (k * k - vh) / a0,
                  (vh - vb * k / q + k * k) / a0,
                  2.0 * (k * k - 1.0) / a0,
                  (1.0 - k / q + k * k) / a0 };

        f0 = 38.13547087602444;
        q = 0.5003270373238773;
        k = std::tan (pi * f0 / sampleRate);
        a0 = 1.0 + k / q + k * k;
        highPass = { 1.0, -2.0, 1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0 };
    }

    // Blackman-windowed sinc, split into polyphase branches with unity DC gain each
    void makeTruePeakInterpolator() noexcept
    {
        constexpr double pi = 3.14159265358979323846;
        constexpr int length = TP_OVERSAMPLING * TP_TAPS;
        const double centre = (length - 1) / 2.0;

        std::array<double, length> proto {};
        for (int n = 0; n < length; ++n)
        {
            const double x = (n - centre) / TP_OVERSAMPLING;
            const double sinc = x == 0.0 ? 1.0 : std::sin (pi * x) / (pi * x);
            const double w = 0.42 - 0.5 * std::cos (2.0 * pi * (n + 0.5) / length)
                                  + 0.08 * std::cos (4.0 * pi * (n + 0.5) / length);
            proto[(size_t) n] = sinc * w;
        }

        for (int p = 0; p < TP_OVERSAMPLING; ++p)
        {
            double sum = 0.0;
            for (int k = 0; k < TP_TAPS; ++k)
                sum += (tpPhases[(size_t) p][(size_t) k] = proto[(size_t) (k * TP_OVERSAMPLING + p)]);
            for (int k = 0; k < TP_TAPS; ++k)
                tpPhases[(size_t) p][(size_t) k] /= sum;
        }
    }

    void trackTruePeak (int ch, double x) noexcept
    {
        auto& hist = tpHistory[(size_t) ch];
        auto& pos = tpPos[(size_t) ch];
        hist[(size_t) pos] = x;

        double peak = std::abs (x);
        for (const auto& phase : tpPhases)
        {
            double acc = 0.0;
            int idx = pos;
            for (int k = 0; k < TP_TAPS; ++k)
            {
                acc += phase[(size_t) k] * hist[(size_t) idx];
                idx = idx == 0 ? TP_TAPS - 1 : idx - 1;
            }
            peak = std::max (peak, std::abs (acc));
        }
        pos = (pos + 1) % TP_TAPS;

        auto& current = subBlockTruePeak[(size_t) ch];
        current = std::max (current, peak);
    }

    void completeSubBlock() noexcept
    {
        subBlocks[(size_t) subBlockWrite] = subBlockEnergy / (double) subBlockFill;
        subBlockWrite = (subBlockWrite + 1) % 30;
        subBlockCount = std::min (subBlockCount + 1, 30);
        subBlockEnergy = 0.0;
        subBlockFill = 0;

        for (int ch = 0; ch < MAX_CHANNELS; ++ch)
        {
            const double peak = subBlockTruePeak[(size_t) ch];
            recentPeaks[(size_t) ch][(size_t) recentPeakWrite] = peak;
            truePeakMax = std::max (truePeakMax, peak);
            subBlockTruePeak[(size_t) ch] = 0.0;
        }
        recentPeakWrite = (recentPeakWrite + 1) % 4;

        if (subBlockCount >= 4)
            gatingBlocks.add (meanOfRecent (4)); // 400 ms blocks, 75 % overlap
        if (subBlockCount >= 30)
            shortTermBlocks.add (meanOfRecent (30)); // 3 s windows every 100 ms (LRA)

        publish();
    }

    double meanOfRecent (int count) const noexcept
    {
        double sum = 0.0;
        for (int i = 1; i <= count; ++i)
            sum += subBlocks[(size_t) ((subBlockWrite - i + 30) % 30)];
        return sum / count;
    }

    double computeIntegrated() const noexcept
    {
        double ungated = 0.0, gated = 0.0;
        if (! gatingBlocks.meanPowerAbove (HIST_MIN_DB, ungated))
            return SILENCE_DB;
        if (! gatingBlocks.meanPowerAbove (powerToLufs (ungated) - 10.0, gated))
            return SILENCE_DB;
        return powerToLufs (gated);
    }

    double computeLoudnessRange() const noexcept
    {
        double ungated = 0.0;
        if (! shortTermBlocks.meanPowerAbove (HIST_MIN_DB, ungated))
            return 0.0;
        const double gate = powerToLufs (ungated) - 20.0;

        std::uint64_t total = 0;
        for (int b = 0; b < HIST_BINS; ++b)
            if (Histogram::binCentreDb (b) > gate)
                total += shortTermBlocks.counts[(size_t) b];
        if (total < 2)
            return 0.0;

        auto percentile = [&] (double q)
        {
            const auto target = (std::uint64_t) std::llround (q * (double) (total - 1));
            std::uint64_t seen = 0;
            for (int b = 0; b < HIST_BINS; ++b)
            {
                if (Histogram::binCentreDb (b) <= gate)
                    continue;
                seen += shortTermBlocks.counts[(size_t) b];
                if (seen > target)
                    return Histogram::binCentreDb (b);
            }
            return Histogram::binCentreDb (HIST_BINS - 1);
        };
        return std::max (0.0, percentile (0.95) - percentile (0.10));
    }

    void publish() noexcept
    {
        momentary.store (subBlockCount > 0 ? (float) powerToLufs (meanOfRecent (std::min (4, subBlockCount))) : SILENCE_DB,
                         std::memory_order_relaxed);
        shortTerm.store (subBlockCount > 0 ? (float) powerToLufs (meanOfRecent (subBlockCount)) : SILENCE_DB,
                         std::memory_order_relaxed);
        integrated.store ((float) computeIntegrated(), std::memory_order_relaxed);
        loudnessRange.store ((float) computeLoudnessRange(), std::memory_order_relaxed);
        truePeakMaxDb.store (linearToDb (truePeakMax), std::memory_order_relaxed);
        for (int ch = 0; ch < MAX_CHANNELS; ++ch)
        {
            const auto& r = recentPeaks[(size_t) ch];
            recentTruePeakDb[(size_t) ch].store (linearToDb (*std::max_element (r.begin(), r.end())),
                                                 std::memory_order_relaxed);
        }
    }

    void resetState() noexcept
    {
        for (auto& s : filterState) s.fill (0.0);
        for (auto& h : tpHistory) h.fill (0.0);
        for (auto& r : recentPeaks) r.fill (0.0);
        tpPos.fill (0);
        subBlockTruePeak.fill (0.0);
        subBlocks.fill (0.0);
        subBlockWrite = subBlockCount = subBlockFill = recentPeakWrite = 0;
        subBlockEnergy = 0.0;
        truePeakMax = 0.0;
        gatingBlocks.clear();
        shortTermBlocks.clear();
    }

    Biquad shelf {}, highPass {};
    std::array<std::array<double, 4>, MAX_CHANNELS> filterState {};

    std::array<std::array<double, TP_TAPS>, TP_OVERSAMPLING> tpPhases {};
    std::array<std::array<double, TP_TAPS>, MAX_CHANNELS> tpHistory {};
    std::array<int, MAX_CHANNELS> tpPos {};
    std::array<double, MAX_CHANNELS> subBlockTruePeak {};
    std::array<std::array<double, 4>, MAX_CHANNELS> recentPeaks {};
    int recentPeakWrite = 0;
    double truePeakMax = 0.0;

    int subBlockSize = 4800;
    int subBlockFill = 0;
    double subBlockEnergy = 0.0;
    std::array<double, 30> subBlocks {};
    int subBlockWrite = 0;
    int subBlockCount = 0;

    Histogram gatingBlocks, shortTermBlocks;

    std::atomic<bool> resetRequested { false };
    std::atomic<float> momentary { SILENCE_DB }, shortTerm { SILENCE_DB }, integrated { SILENCE_DB };
    std::atomic<float> loudnessRange { 0.0f }, truePeakMaxDb { SILENCE_DB };
    std::array<std::atomic<float>, MAX_CHANNELS> recentTruePeakDb { SILENCE_DB, SILENCE_DB };
};

} // namespace LiquidAudio
