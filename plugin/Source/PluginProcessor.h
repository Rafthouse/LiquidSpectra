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

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "LiquidSpectra"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    /** Hosts (VST3 / AU / AAX) report the DAW track name and colour here. */
    void updateTrackProperties (const TrackProperties& properties) override;

    // Track identity (message thread; never touched by the audio thread)
    int getInstanceId() const noexcept { return instanceId; }
    void setTrackName (const juce::String& name);
    juce::String getTrackName() const;
    void setTrackColour (juce::Colour c);
    juce::Colour getTrackColour() const;

    const SpectralAnalyzerDSP& getSpectralAnalyzer() const noexcept { return spectralAnalyzer; }
    LoudnessMeterEBU& getLoudnessMeter() noexcept { return loudnessMeter; }
    static MultiInstanceBus& getSharedBus() noexcept;

private:
    void publishTrackInfo();

    int instanceId { -1 };

    mutable juce::SpinLock trackInfoLock;
    juce::String trackName { "Track" };
    juce::Colour trackColour { juce::Colours::cyan };

    SpectralAnalyzerDSP spectralAnalyzer;
    LoudnessMeterEBU loudnessMeter;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (LiquidSpectraAudioProcessor)
};

} // namespace LiquidAudio
