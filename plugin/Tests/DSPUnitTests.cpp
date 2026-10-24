// DSP unit tests. Uses its own CHECK macro instead of assert(), which compiles away under
// NDEBUG and would make a Release CI run pass without testing anything.

#include <atomic>
#include <cmath>
#include <cstdio>
#include <thread>
#include <vector>
#include "SpectralAnalyzerDSP.h"
#include "CollisionDetector.h"
#include "LoudnessMeterEBU.h"
#include <memory>
#include "MultiInstanceBus.h"

using namespace LiquidAudio;

namespace
{
    int failures = 0;
    int checks = 0;

    void check (bool condition, const char* expression, const char* file, int line, double value)
    {
        ++checks;
        if (! condition)
        {
            ++failures;
            std::printf ("  [FAIL] %s:%d  %s  (value: %.4f)\n", file, line, expression, value);
        }
    }

    #define CHECK(cond, value) check ((cond), #cond, __FILE__, __LINE__, (double) (value))

    constexpr double pi = 3.14159265358979323846;

    std::vector<float> sine (double freq, double dbfs, double seconds, double sampleRate, double phase = 0.0)
    {
        const double amp = std::pow (10.0, dbfs / 20.0);
        std::vector<float> out ((size_t) std::lround (seconds * sampleRate));
        for (size_t i = 0; i < out.size(); ++i)
            out[i] = (float) (amp * std::sin (2.0 * pi * freq * (double) i / sampleRate + phase));
        return out;
    }

    void feed (LoudnessMeterEBU& meter, const std::vector<float>& left, const std::vector<float>& right, int block = 512)
    {
        for (size_t i = 0; i < left.size(); i += (size_t) block)
        {
            const int n = (int) std::min<size_t> ((size_t) block, left.size() - i);
            const float* channels[] = { left.data() + i, right.data() + i };
            meter.processBlock (channels, 2, n);
        }
    }

    void feed (LoudnessMeterEBU& meter, const std::vector<float>& signal) { feed (meter, signal, signal); }

    void append (std::vector<float>& a, const std::vector<float>& b) { a.insert (a.end(), b.begin(), b.end()); }

    void run (const char* name, void (*test)())
    {
        const int before = failures;
        test();
        std::printf ("%s %s\n", failures == before ? "[PASS]" : "[FAIL]", name);
    }

    // ── Loudness (EBU Tech 3341 / 3342 reference signals) ──

    void testLoudnessStereoSine()
    {
        LoudnessMeterEBU meter;
        meter.prepare (48000.0);
        feed (meter, sine (1000.0, -23.0, 20.0, 48000.0));
        CHECK (std::abs (meter.getMomentaryLUFS() + 23.0f) <= 0.1f, meter.getMomentaryLUFS());
        CHECK (std::abs (meter.getShortTermLUFS() + 23.0f) <= 0.1f, meter.getShortTermLUFS());
        CHECK (std::abs (meter.getIntegratedLUFS() + 23.0f) <= 0.1f, meter.getIntegratedLUFS());
    }

    void testLoudnessSampleRates()
    {
        for (double sr : { 44100.0, 96000.0 })
        {
            LoudnessMeterEBU meter;
            meter.prepare (sr);
            feed (meter, sine (1000.0, -23.0, 10.0, sr));
            CHECK (std::abs (meter.getIntegratedLUFS() + 23.0f) <= 0.1f, meter.getIntegratedLUFS());
        }
    }

    void testLoudnessRelativeGate()
    {
        // Tech 3341 case 3: 10 s @ -36, 60 s @ -23, 10 s @ -36 dBFS -> -23.0 LUFS
        std::vector<float> s;
        append (s, sine (1000.0, -36.0, 10.0, 48000.0));
        append (s, sine (1000.0, -23.0, 60.0, 48000.0));
        append (s, sine (1000.0, -36.0, 10.0, 48000.0));
        LoudnessMeterEBU meter;
        meter.prepare (48000.0);
        feed (meter, s);
        CHECK (std::abs (meter.getIntegratedLUFS() + 23.0f) <= 0.1f, meter.getIntegratedLUFS());
    }

    void testLoudnessAbsoluteGate()
    {
        std::vector<float> s = sine (1000.0, -20.0, 10.0, 48000.0);
        s.resize (s.size() + 480000, 0.0f);
        LoudnessMeterEBU meter;
        meter.prepare (48000.0);
        feed (meter, s);
        CHECK (std::abs (meter.getIntegratedLUFS() + 20.0f) <= 0.1f, meter.getIntegratedLUFS());
    }

    void testLoudnessRange()
    {
        // Tech 3342 case 1: 20 s @ -20, 20 s @ -30 dBFS -> LRA 10 LU (±1)
        std::vector<float> s = sine (1000.0, -20.0, 20.0, 48000.0);
        append (s, sine (1000.0, -30.0, 20.0, 48000.0));
        LoudnessMeterEBU meter;
        meter.prepare (48000.0);
        feed (meter, s);
        CHECK (std::abs (meter.getLoudnessRangeLU() - 10.0f) <= 1.0f, meter.getLoudnessRangeLU());
    }

    void testTruePeakInterSample()
    {
        // fs/4 sine at 45°: every sample is at -3 dB of the real peak (0 dBTP)
        LoudnessMeterEBU meter;
        meter.prepare (48000.0);
        feed (meter, sine (12000.0, 0.0, 1.0, 48000.0, pi / 4.0));
        CHECK (meter.getTruePeakDb() > -0.6f && meter.getTruePeakDb() < 0.3f, meter.getTruePeakDb());
    }

    void testTruePeakPerChannel()
    {
        LoudnessMeterEBU meter;
        meter.prepare (48000.0);
        const auto left = sine (1000.0, -6.0, 1.0, 48000.0);
        const std::vector<float> right (left.size(), 0.0f);
        feed (meter, left, right);
        CHECK (std::abs (meter.getRecentTruePeakDb (0) + 6.0f) <= 0.2f, meter.getRecentTruePeakDb (0));
        CHECK (meter.getRecentTruePeakDb (1) <= LoudnessMeterEBU::SILENCE_DB, meter.getRecentTruePeakDb (1));
    }

    void testLoudnessReset()
    {
        LoudnessMeterEBU meter;
        meter.prepare (48000.0);
        feed (meter, sine (1000.0, -10.0, 5.0, 48000.0));
        meter.requestReset();
        const float silence[1] = { 0.0f };
        const float* channels[] = { silence, silence };
        meter.processBlock (channels, 2, 1); // reset is applied on the audio thread
        CHECK (meter.getIntegratedLUFS() <= LoudnessMeterEBU::SILENCE_DB, meter.getIntegratedLUFS());
        CHECK (meter.getTruePeakDb() <= LoudnessMeterEBU::SILENCE_DB, meter.getTruePeakDb());
    }

    // ── Spectral analyser ──

    void testSpectrumCalibration()
    {
        SpectralAnalyzerDSP dsp;
        dsp.prepare (48000.0);
        const auto s = sine (1500.0, -6.0, 1.0, 48000.0);
        const float* channels[] = { s.data() };
        dsp.pushSamples (channels, 1, (int) s.size());

        std::array<float, SpectralAnalyzerDSP::NUM_BINS> spectrum {};
        CHECK (dsp.readSpectrum (spectrum), 0);

        int peakBin = 1;
        for (int b = 1; b < SpectralAnalyzerDSP::NUM_BINS; ++b)
            if (spectrum[(size_t) b] > spectrum[(size_t) peakBin])
                peakBin = b;

        const double peakHz = peakBin * 48000.0 / SpectralAnalyzerDSP::FFT_SIZE;
        CHECK (std::abs (peakHz - 1500.0) <= 12.0, peakHz);
        // Hann scalloping can cost up to ~1.4 dB between bins
        CHECK (spectrum[(size_t) peakBin] > -7.6f && spectrum[(size_t) peakBin] < -5.5f, spectrum[(size_t) peakBin]);

        const auto& bark = dsp.getLatestBarkMagnitudes();
        CHECK ((int) bark.size() == BARK_BANDS_COUNT, bark.size());
        // 1.5 kHz lies in band 12 (1480-1720 Hz), which must dominate
        int loudestBand = 0;
        for (int b = 1; b < BARK_BANDS_COUNT; ++b)
            if (bark[(size_t) b] > bark[(size_t) loudestBand])
                loudestBand = b;
        CHECK (loudestBand == 11, loudestBand);
    }

    void testSpectrumResetPublishesFloor()
    {
        SpectralAnalyzerDSP dsp;
        dsp.prepare (48000.0);
        dsp.reset();
        std::array<float, SpectralAnalyzerDSP::NUM_BARK_BANDS> bark {};
        dsp.readBark (bark);
        CHECK (bark[0] <= SpectralAnalyzerDSP::FLOOR_DB, bark[0]);
    }

    // ── Collision detection ──

    void testCollisionDetection()
    {
        std::array<TrackSnapshot, 2> tracks {};
        for (auto& t : tracks)
            std::fill (std::begin (t.barkMagnitudes), std::end (t.barkMagnitudes), -120.0f);

        tracks[0].instanceId = 0;
        std::snprintf (tracks[0].name, sizeof (tracks[0].name), "Kick");
        tracks[0].barkMagnitudes[0] = -12.0f;
        tracks[1].instanceId = 1;
        std::snprintf (tracks[1].name, sizeof (tracks[1].name), "808 Bass");
        tracks[1].barkMagnitudes[0] = -14.0f;

        const auto collisions = CollisionDetector::analyzeCollisions (tracks.data(), 2, 0.35f);
        CHECK (collisions.size() == 1, collisions.size());
        if (! collisions.empty())
        {
            CHECK (collisions[0].criticalBandIndex == 0, collisions[0].criticalBandIndex);
            CHECK (collisions[0].maskingSeverity > 0.80f, collisions[0].maskingSeverity);
            CHECK (collisions[0].recommendedCutGainDb < -3.0f, collisions[0].recommendedCutGainDb);
            CHECK (collisions[0].centerFrequencyHz > 20.0f && collisions[0].centerFrequencyHz < 100.0f,
                   collisions[0].centerFrequencyHz);
        }

        // Quiet bands never clash
        tracks[1].barkMagnitudes[0] = -80.0f;
        CHECK (CollisionDetector::analyzeCollisions (tracks.data(), 2, 0.35f).empty(), 0);
    }

    // ── Multi-instance bus ──

    void testBusRegistration()
    {
        // Heap-allocated: the bus holds per-slot waveform rings and is too large for the stack
        auto busPtr = std::make_unique<MultiInstanceBus>();
        auto& bus = *busPtr;
        int owner1 = 0, owner2 = 0;
        const int id1 = bus.registerInstance (&owner1);
        const int id2 = bus.registerInstance (&owner2);
        CHECK (id1 >= 0 && id2 >= 0 && id1 != id2, id2);

        bus.setTrackInfo (id1, "Kick", 0xff06b6d4u);
        float bark[BARK_BANDS_COUNT];
        std::fill (std::begin (bark), std::end (bark), -30.0f);
        bus.publishSpectrum (id1, bark, BARK_BANDS_COUNT);

        std::array<TrackSnapshot, MAX_SIMULTANEOUS_TRACKS> snap {};
        CHECK (bus.snapshot (snap) == 2, 0);
        CHECK (std::string (snap[0].name) == "Kick", 0);
        CHECK (snap[0].colourArgb == 0xff06b6d4u, snap[0].colourArgb);
        CHECK (snap[0].barkMagnitudes[5] == -30.0f, snap[0].barkMagnitudes[5]);
        CHECK (snap[1].barkMagnitudes[5] == -120.0f, snap[1].barkMagnitudes[5]);

        bus.unregisterInstance (id1);
        CHECK (bus.snapshot (snap) == 1, 0);

        // Slots are reusable and the bus refuses more than MAX_SIMULTANEOUS_TRACKS owners
        std::vector<int> owners (MAX_SIMULTANEOUS_TRACKS + 1);
        int accepted = 0;
        for (auto& o : owners)
            accepted += bus.registerInstance (&o) >= 0 ? 1 : 0;
        CHECK (accepted == MAX_SIMULTANEOUS_TRACKS - 1, accepted);
    }

    void testBusConcurrentConsistency()
    {
        // A writer publishes frames whose bands all hold the same value; a reader must never
        // observe a torn frame mixing two different publications.
        auto busPtr = std::make_unique<MultiInstanceBus>();
        auto& bus = *busPtr;
        int owner = 0;
        const int id = bus.registerInstance (&owner);
        std::atomic<bool> done { false };

        std::thread writer ([&]
        {
            float frame[BARK_BANDS_COUNT];
            for (int i = 0; i < 200000; ++i)
            {
                std::fill (std::begin (frame), std::end (frame), (float) (i % 1000));
                bus.publishSpectrum (id, frame, BARK_BANDS_COUNT);
            }
            done = true;
        });

        std::array<TrackSnapshot, MAX_SIMULTANEOUS_TRACKS> snap {};
        int torn = 0, reads = 0;
        while (! done)
        {
            if (bus.snapshot (snap) == 1)
            {
                ++reads;
                for (int b = 1; b < BARK_BANDS_COUNT; ++b)
                    if (snap[0].barkMagnitudes[b] != snap[0].barkMagnitudes[0])
                    {
                        ++torn;
                        break;
                    }
            }
        }
        writer.join();
        CHECK (torn == 0, torn);
        CHECK (reads > 0, reads);
    }
}

int main()
{
    std::printf ("=== LiquidSpectra DSP Test Suite ===\n");

    run ("Loudness: stereo 1 kHz @ -23 dBFS reads -23 LUFS (Tech 3341 #1)", testLoudnessStereoSine);
    run ("Loudness: K-weighting at 44.1 / 96 kHz", testLoudnessSampleRates);
    run ("Loudness: relative gate (Tech 3341 #3)", testLoudnessRelativeGate);
    run ("Loudness: absolute gate ignores silence", testLoudnessAbsoluteGate);
    run ("Loudness: LRA 10 LU (Tech 3342 #1)", testLoudnessRange);
    run ("True peak: inter-sample overs", testTruePeakInterSample);
    run ("True peak: per-channel readout", testTruePeakPerChannel);
    run ("Loudness: reset request", testLoudnessReset);
    run ("Spectrum: frequency & level calibration", testSpectrumCalibration);
    run ("Spectrum: reset clears published bands", testSpectrumResetPublishesFloor);
    run ("Collisions: severity, band and EQ suggestion", testCollisionDetection);
    run ("Bus: registration, publish, snapshot, capacity", testBusRegistration);
    run ("Bus: no torn frames under concurrent writes", testBusConcurrentConsistency);

    std::printf ("=== %d checks, %d failed ===\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
