#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <array>
#include <vector>
#include "PluginProcessor.h"

namespace LiquidAudio {

class LiquidSpectraAudioProcessorEditor : public juce::AudioProcessorEditor,
                                          private juce::Timer
{
public:
    explicit LiquidSpectraAudioProcessorEditor (LiquidSpectraAudioProcessor&);
    ~LiquidSpectraAudioProcessorEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;

    void mouseDown (const juce::MouseEvent& event) override;
    void mouseDoubleClick (const juce::MouseEvent& event) override;

private:
    void timerCallback() override;

    void paintHeader (juce::Graphics& g, juce::Rectangle<int> bounds);
    void paintFrequencyGrid (juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintCollisionRegions (juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintOtherTracks (juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintSpectrumCurve (juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintMasterOutputMeter (juce::Graphics& g, juce::Rectangle<int> bounds);

    float freqToX (float freqHz, juce::Rectangle<float> bounds) const noexcept;
    float dbToY (float db, juce::Rectangle<float> bounds) const noexcept;

    LiquidSpectraAudioProcessor& audioProcessor;

    // Layout (computed in resized() so painting and hit-testing always agree)
    juce::Rectangle<int> headerArea, meterArea, loudnessArea, clipBox;
    juce::Rectangle<float> spectrumArea;

    // GUI-thread copies of the analyser output
    std::array<float, SpectralAnalyzerDSP::NUM_BINS> spectrumDb {};
    std::array<TrackSnapshot, MAX_SIMULTANEOUS_TRACKS> busTracks {};
    int numBusTracks { 0 };
    std::vector<CollisionResult> collisions;

    // Meter ballistics (dBTP)
    std::array<float, 2> meterDb { -90.0f, -90.0f };
    std::array<float, 2> peakHoldDb { -90.0f, -90.0f };
    std::array<int, 2> peakHoldAgeFrames { 0, 0 };
    bool clipLatched { false };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (LiquidSpectraAudioProcessorEditor)
};

} // namespace LiquidAudio
