#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_dsp/juce_dsp.h>
#include "SpectralAnalyzerDSP.h"
#include "CollisionDetector.h"
#include "LoudnessMeterEBU.h"
#include "MultiInstanceBus.h"

namespace LiquidAudio {

class LiquidSpectraAudioProcessor : public juce::AudioProcessor
{
public:
    LiquidSpectraAudioProcessor();
    ~LiquidSpectraAudioProcessor() override;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "LiquidSpectra"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    // Track Instance Identity across DAW session
    int getInstanceId() const noexcept { return instanceId; }
    void setTrackName(const juce::String& name) { trackName = name; }
    juce::String getTrackName() const { return trackName; }
    void setTrackColour(juce::Colour c) { trackColour = c; }
    juce::Colour getTrackColour() const { return trackColour; }

    SpectralAnalyzerDSP& getSpectralAnalyzer() noexcept { return spectralAnalyzer; }
    LoudnessMeterEBU& getLoudnessMeter() noexcept { return loudnessMeter; }
    static MultiInstanceBus& getSharedBus() noexcept { return sharedBus; }

private:
    int instanceId { 0 };
    juce::String trackName { "Track 1" };
    juce::Colour trackColour { juce::Colours::cyan };

    // High performance DSP modules
    SpectralAnalyzerDSP spectralAnalyzer;
    LoudnessMeterEBU loudnessMeter;

    // Global Lock-Free Inter-Plugin Communication Bus
    static MultiInstanceBus sharedBus;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(LiquidSpectraAudioProcessor)
};

} // namespace LiquidAudio
