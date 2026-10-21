#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include "PluginProcessor.h"

namespace LiquidAudio {

class LiquidSpectraAudioProcessorEditor : public juce::AudioProcessorEditor,
                                          public juce::Timer
{
public:
    explicit LiquidSpectraAudioProcessorEditor(LiquidSpectraAudioProcessor&);
    ~LiquidSpectraAudioProcessorEditor() override;

    void paint(juce::Graphics&) override;
    void resized() override;
    void timerCallback() override;

    void mouseDown(const juce::MouseEvent& event) override;
    void mouseDrag(const juce::MouseEvent& event) override;
    void mouseWheelMove(const juce::MouseEvent& event, const juce::MouseWheelDetails& wheel) override;
    void mouseDoubleClick(const juce::MouseEvent& event) override;

private:
    LiquidSpectraAudioProcessor& audioProcessor;

    // Viewport drawing subroutines
    void paintHeader(juce::Graphics& g, juce::Rectangle<int> bounds);
    void paintFrequencyGrid(juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintSpectrumCurves(juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintCollisionRegions(juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintMasterOutputMeter(juce::Graphics& g, juce::Rectangle<int> bounds);

    // Helpers
    float freqToX(float freqHz, juce::Rectangle<float> bounds) const noexcept;
    float dbToY(float db, juce::Rectangle<float> bounds) const noexcept;

    // Dynamic UI states
    float masterGainLevel { 0.85f }; // 85%
    bool isDraggingMasterFader { false };
    float smoothedPeakL { -60.0f };
    float smoothedPeakR { -60.0f };
    float smoothedRmsL { -60.0f };
    float smoothedRmsR { -60.0f };
    float peakHoldDbL { -60.0f };
    float peakHoldDbR { -60.0f };
    int peakHoldAgeFrames { 0 };
    bool clipLatched { false };

    // Cached spectrum points for fast 60fps repaints
    std::vector<float> displayMagnitudes;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(LiquidSpectraAudioProcessorEditor)
};

} // namespace LiquidAudio
