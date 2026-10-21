#pragma once

#include <juce_dsp/juce_dsp.h>
#include <vector>
#include <array>
#include <cmath>

namespace LiquidAudio {

class SpectralAnalyzerDSP
{
public:
    static constexpr int FFT_ORDER = 12; // 4096 points
    static constexpr int FFT_SIZE = 1 << FFT_ORDER;
    static constexpr int NUM_BARK_BANDS = 24;

    SpectralAnalyzerDSP()
        : forwardFFT(FFT_ORDER),
          window(FFT_SIZE, juce::dsp::WindowingMethod::hann)
    {
        fftBuffer.resize(FFT_SIZE * 2, 0.0f);
        smoothedMagnitudes.resize(FFT_SIZE / 2, -120.0f);
        barkMagnitudes.resize(NUM_BARK_BANDS, -120.0f);
        initBarkFrequencies();
    }

    void prepare(double sRate, int)
    {
        sampleRate = sRate;
        std::fill(smoothedMagnitudes.begin(), smoothedMagnitudes.end(), -120.0f);
        std::fill(barkMagnitudes.begin(), barkMagnitudes.end(), -120.0f);
    }

    void reset()
    {
        fifoIndex = 0;
        std::fill(fifo.begin(), fifo.end(), 0.0f);
    }

    void pushAudioBlock(const juce::AudioBuffer<float>& buffer)
    {
        const int numChannels = buffer.getNumChannels();
        const int numSamples = buffer.getNumSamples();

        for (int i = 0; i < numSamples; ++i)
        {
            float monoSample = 0.0f;
            for (int ch = 0; ch < numChannels; ++ch)
                monoSample += buffer.getSample(ch, i);
            monoSample /= (float)numChannels;

            fifo[fifoIndex++] = monoSample;

            if (fifoIndex >= FFT_SIZE)
            {
                performFFT();
                fifoIndex = 0;
            }
        }
    }

    const std::vector<float>& getLatestBarkMagnitudes() const noexcept { return barkMagnitudes; }
    const std::vector<float>& getSmoothedFFT() const noexcept { return smoothedMagnitudes; }

private:
    void performFFT()
    {
        std::copy(fifo.begin(), fifo.end(), fftBuffer.begin());
        std::fill(fftBuffer.begin() + FFT_SIZE, fftBuffer.end(), 0.0f);

        window.multiplyWithWindowingTable(fftBuffer.data(), FFT_SIZE);
        forwardFFT.performFrequencyOnlyForwardTransform(fftBuffer.data());

        const float binHz = (float)sampleRate / (float)FFT_SIZE;
        const int numBins = FFT_SIZE / 2;

        // SIMD smoothing and Bark integration
        for (int i = 0; i < numBins; ++i)
        {
            float rawDb = juce::Decibels::gainToDecibels(fftBuffer[i] / (float)FFT_SIZE, -120.0f);
            smoothedMagnitudes[i] = smoothedMagnitudes[i] * 0.75f + rawDb * 0.25f;
        }

        // Integrate energy into 24 standard Bark bands
        for (int band = 0; band < NUM_BARK_BANDS; ++band)
        {
            float lowFreq = barkEdges[band];
            float highFreq = barkEdges[band + 1];

            int startBin = std::clamp((int)(lowFreq / binHz), 0, numBins - 1);
            int endBin   = std::clamp((int)(highFreq / binHz), 0, numBins - 1);

            float sumEnergy = 0.0f;
            int count = 0;
            for (int b = startBin; b <= endBin; ++b)
            {
                sumEnergy += std::pow(10.0f, smoothedMagnitudes[b] / 20.0f);
                count++;
            }

            float avgAmp = count > 0 ? (sumEnergy / (float)count) : 0.00001f;
            barkMagnitudes[band] = juce::Decibels::gainToDecibels(avgAmp, -120.0f);
        }
    }

    void initBarkFrequencies()
    {
        // 24 Critical Band Edges in Hz (Zwicker & Fastl Psychoacoustics)
        barkEdges = {
            20.0f, 100.0f, 200.0f, 300.0f, 400.0f, 510.0f, 630.0f, 770.0f,
            920.0f, 1080.0f, 1270.0f, 1480.0f, 1720.0f, 2000.0f, 2320.0f,
            2700.0f, 3150.0f, 3700.0f, 4400.0f, 5300.0f, 6400.0f, 7700.0f,
            9500.0f, 12000.0f, 15500.0f
        };
    }

    double sampleRate { 48000.0 };
    juce::dsp::FFT forwardFFT;
    juce::dsp::WindowingFunction<float> window;

    std::array<float, FFT_SIZE> fifo { 0.0f };
    int fifoIndex { 0 };

    std::vector<float> fftBuffer;
    std::vector<float> smoothedMagnitudes;
    std::vector<float> barkMagnitudes;
    std::array<float, NUM_BARK_BANDS + 1> barkEdges;
};

} // namespace LiquidAudio
