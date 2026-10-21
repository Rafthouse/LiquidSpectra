#pragma once

#include <juce_dsp/juce_dsp.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <vector>
#include "BarkScale.h"
#include "SeqLock.h"

namespace LiquidAudio {

/**
 * 4096-point Hann-windowed FFT analyser with 50 % overlap and 24 critical-band grouping.
 * pushSamples() runs on the audio thread and is allocation-free (all buffers are sized in
 * the constructor). Results are published through sequence locks for the GUI thread.
 */
class SpectralAnalyzerDSP
{
public:
    static constexpr int FFT_ORDER = 12; // 4096 points
    static constexpr int FFT_SIZE = 1 << FFT_ORDER;
    static constexpr int NUM_BINS = FFT_SIZE / 2;
    static constexpr int HOP_SIZE = FFT_SIZE / 2;
    static constexpr int NUM_BARK_BANDS = BARK_BANDS_COUNT;
    static constexpr float FLOOR_DB = -120.0f;

    SpectralAnalyzerDSP()
        : forwardFFT (FFT_ORDER),
          window ((size_t) FFT_SIZE, juce::dsp::WindowingFunction<float>::hann, false)
    {
        fftBuffer.resize ((size_t) FFT_SIZE * 2, 0.0f);
        smoothedDb.resize ((size_t) NUM_BINS, FLOOR_DB);
        bandPower.resize ((size_t) NUM_BARK_BANDS, 0.0f);
        barkDb.resize ((size_t) NUM_BARK_BANDS, FLOOR_DB);
        reset();
    }

    void prepare (double newSampleRate) noexcept
    {
        sampleRate = newSampleRate;
        reset();
    }

    void reset() noexcept
    {
        fifo.fill (0.0f);
        fifoIndex = 0;
        samplesUntilHop = FFT_SIZE;
        std::fill (smoothedDb.begin(), smoothedDb.end(), FLOOR_DB);
        std::fill (bandPower.begin(), bandPower.end(), 0.0f);
        std::fill (barkDb.begin(), barkDb.end(), FLOOR_DB);
        publishedSpectrum.write (smoothedDb.data(), smoothedDb.size());
        publishedBark.write (barkDb.data(), barkDb.size());
    }

    /** Down-mixes the given channels to mono and analyses them. Audio thread only. */
    void pushSamples (const float* const* channels, int numChannels, int numSamples) noexcept
    {
        if (numChannels <= 0)
            return;

        const float scale = 1.0f / (float) numChannels;
        for (int i = 0; i < numSamples; ++i)
        {
            float mono = 0.0f;
            for (int ch = 0; ch < numChannels; ++ch)
                mono += channels[ch][i];

            fifo[(size_t) fifoIndex] = mono * scale;
            fifoIndex = (fifoIndex + 1) % FFT_SIZE;

            if (--samplesUntilHop == 0)
            {
                performFFT();
                samplesUntilHop = HOP_SIZE;
            }
        }
    }

    /** Critical-band levels from the latest frame (audio thread, same thread as pushSamples). */
    const std::vector<float>& getLatestBarkMagnitudes() const noexcept { return barkDb; }

    /** Thread-safe copies for the GUI. Return false if no consistent frame could be read. */
    bool readSpectrum (std::array<float, NUM_BINS>& out) const noexcept { return publishedSpectrum.read (out.data(), out.size()); }
    bool readBark (std::array<float, NUM_BARK_BANDS>& out) const noexcept { return publishedBark.read (out.data(), out.size()); }
    std::uint32_t getFrameVersion() const noexcept { return publishedSpectrum.version(); }

    double getSampleRate() const noexcept { return sampleRate; }

private:
    void performFFT() noexcept
    {
        // Unroll the circular FIFO so the oldest sample comes first
        const auto split = (size_t) fifoIndex;
        std::copy (fifo.begin() + (std::ptrdiff_t) split, fifo.end(), fftBuffer.begin());
        std::copy (fifo.begin(), fifo.begin() + (std::ptrdiff_t) split, fftBuffer.begin() + (std::ptrdiff_t) (FFT_SIZE - split));
        std::fill (fftBuffer.begin() + FFT_SIZE, fftBuffer.end(), 0.0f);

        window.multiplyWithWindowingTable (fftBuffer.data(), (size_t) FFT_SIZE);
        forwardFFT.performFrequencyOnlyForwardTransform (fftBuffer.data());

        // A full-scale sine reads 0 dB: single-sided spectrum (x2) / Hann coherent gain (0.5)
        constexpr float amplitudeScale = 4.0f / (float) FFT_SIZE;
        constexpr float smoothing = 0.6f;

        for (int i = 0; i < NUM_BINS; ++i)
        {
            const float rawDb = juce::Decibels::gainToDecibels (fftBuffer[(size_t) i] * amplitudeScale, FLOOR_DB);
            smoothedDb[(size_t) i] = smoothedDb[(size_t) i] * smoothing + rawDb * (1.0f - smoothing);
        }

        // Critical bands: power average of the bins inside each band, smoothed in the power domain
        const float binHz = (float) sampleRate / (float) FFT_SIZE;
        for (int band = 0; band < NUM_BARK_BANDS; ++band)
        {
            const int startBin = std::clamp ((int) std::ceil (barkBandEdgesHz[(size_t) band] / binHz), 1, NUM_BINS - 1);
            const int endBin = std::clamp ((int) std::floor (barkBandEdgesHz[(size_t) band + 1] / binHz), startBin, NUM_BINS - 1);

            float sumPower = 0.0f;
            for (int b = startBin; b <= endBin; ++b)
            {
                const float amp = fftBuffer[(size_t) b] * amplitudeScale;
                sumPower += amp * amp;
            }
            const float meanPower = sumPower / (float) (endBin - startBin + 1);

            auto& p = bandPower[(size_t) band];
            p = p * smoothing + meanPower * (1.0f - smoothing);
            barkDb[(size_t) band] = p > 1.0e-12f ? 10.0f * std::log10 (p) : FLOOR_DB;
        }

        publishedSpectrum.write (smoothedDb.data(), smoothedDb.size());
        publishedBark.write (barkDb.data(), barkDb.size());
    }

    double sampleRate { 48000.0 };
    juce::dsp::FFT forwardFFT;
    juce::dsp::WindowingFunction<float> window;

    std::array<float, FFT_SIZE> fifo {};
    int fifoIndex { 0 };
    int samplesUntilHop { FFT_SIZE };

    std::vector<float> fftBuffer;
    std::vector<float> smoothedDb;
    std::vector<float> bandPower;
    std::vector<float> barkDb;

    SeqLockArray<float, NUM_BINS> publishedSpectrum;
    SeqLockArray<float, NUM_BARK_BANDS> publishedBark;
};

} // namespace LiquidAudio
