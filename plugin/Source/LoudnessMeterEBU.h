#pragma once

#include <juce_dsp/juce_dsp.h>
#include <deque>

namespace LiquidAudio {

class LoudnessMeterEBU
{
public:
    LoudnessMeterEBU() = default;

    void prepare(double sRate, int samplesPerBlock)
    {
        sampleRate = sRate;
        
        // Stage 1: High-pass filter (Pre-filter: 100 Hz cutoff)
        juce::dsp::IIR::Coefficients<float>::Ptr hpCoeffs =
            juce::dsp::IIR::Coefficients<float>::makeHighPass(sampleRate, 100.0, 0.7071);
        preFilter.state = hpCoeffs;

        // Stage 2: High-shelf filter (RLB weighting: +4 dB at 1.5 kHz)
        juce::dsp::IIR::Coefficients<float>::Ptr hsCoeffs =
            juce::dsp::IIR::Coefficients<float>::makeHighShelf(sampleRate, 1500.0, 0.7071, 1.58489f);
        rlbFilter.state = hsCoeffs;

        juce::dsp::ProcessSpec spec { sampleRate, (uint32_t)samplesPerBlock, 2 };
        preFilter.prepare(spec);
        rlbFilter.prepare(spec);

        momentaryBuffer.clear();
        integratedSum = 0.0;
        integratedBlocks = 0;
    }

    void reset()
    {
        preFilter.reset();
        rlbFilter.reset();
        momentaryBuffer.clear();
        integratedSum = 0.0;
        integratedBlocks = 0;
        truePeakMax = 0.0f;
    }

    void processBlock(const juce::AudioBuffer<float>& buffer)
    {
        juce::AudioBuffer<float> filteredBuffer;
        filteredBuffer.makeCopyOf(buffer);

        juce::dsp::AudioBlock<float> block(filteredBuffer);
        preFilter.process(juce::dsp::ProcessContextReplacing<float>(block));
        rlbFilter.process(juce::dsp::ProcessContextReplacing<float>(block));

        const int numChannels = filteredBuffer.getNumChannels();
        const int numSamples = filteredBuffer.getNumSamples();

        double sumSquares = 0.0;
        for (int ch = 0; ch < numChannels; ++ch)
        {
            const float* channelData = filteredBuffer.getReadPointer(ch);
            for (int i = 0; i < numSamples; ++i)
            {
                float s = channelData[i];
                sumSquares += (double)(s * s);

                // True Peak tracking
                float absVal = std::abs(s);
                if (absVal > truePeakMax) truePeakMax = absVal;
            }
        }

        double meanSquare = sumSquares / (double)(numChannels * numSamples);
        double momentaryLufs = meanSquare > 1e-12 ? (-0.691 + 10.0 * std::log10(meanSquare)) : -90.0;

        momentaryBuffer.push_back(momentaryLufs);
        if (momentaryBuffer.size() > 50)
            momentaryBuffer.pop_front();

        // Gated Integrated accumulation (ignoring silence below -70 LUFS)
        if (momentaryLufs > -70.0)
        {
            integratedSum += momentaryLufs;
            integratedBlocks++;
        }
    }

    float getMomentaryLUFS() const
    {
        return momentaryBuffer.empty() ? -90.0f : (float)momentaryBuffer.back();
    }

    float getIntegratedLUFS() const
    {
        return integratedBlocks > 0 ? (float)(integratedSum / integratedBlocks) : -90.0f;
    }

    float getTruePeakDb() const
    {
        return truePeakMax > 1e-6f ? 20.0f * std::log10(truePeakMax) : -90.0f;
    }

private:
    double sampleRate { 48000.0 };
    juce::dsp::IIR::Filter<float> preFilter;
    juce::dsp::IIR::Filter<float> rlbFilter;

    std::deque<double> momentaryBuffer;
    double integratedSum { 0.0 };
    uint64_t integratedBlocks { 0 };
    float truePeakMax { 0.0f };
};

} // namespace LiquidAudio
