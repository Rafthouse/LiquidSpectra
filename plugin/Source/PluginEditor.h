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
    enum class ViewMode { spectrum, sonogram, collisions, loudness, stereo, oscilloscope };

    struct StereoStats
    {
        float correlation { 0.0f };
        float midDb { -90.0f };
        float sideDb { -90.0f };
    };

    void timerCallback() override;
    void setViewMode (ViewMode mode);
    void updateControlVisibility();

    void paintHeader (juce::Graphics& g, juce::Rectangle<int> bounds);
    void paintSpectrumView (juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintSonogramView (juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintCollisionsView (juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintLoudnessView (juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintStereoView (juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintOscilloscopeView (juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintFrequencyGrid (juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintLevelGrid (juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintCollisionRegions (juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintOtherTracks (juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintSpectrumCurve (juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintPeakHold (juce::Graphics& g, juce::Rectangle<float> bounds);
    void paintMasterOutputMeter (juce::Graphics& g, juce::Rectangle<int> bounds);
    void paintFrozenBadge (juce::Graphics& g, juce::Rectangle<float> bounds);

    void pushSonogramColumn();
    void updatePeakHold();
    void renderScopeFrame();

    void beginRename();
    void commitRename();
    void cycleTrackColour();

    juce::Path buildSpectrumCurve (const std::array<float, SpectralAnalyzerDSP::NUM_BINS>& data, juce::Rectangle<float> bounds) const;
    float freqToX (float freqHz, juce::Rectangle<float> bounds) const noexcept;
    float freqToY (float freqHz, juce::Rectangle<float> bounds) const noexcept;
    float dbToY (float db, juce::Rectangle<float> bounds) const noexcept;
    float lufsToY (float lufs, juce::Rectangle<float> bounds) const noexcept;

    LiquidSpectraAudioProcessor& audioProcessor;
    ViewMode viewMode { ViewMode::spectrum };

    // Controls (children; bounds are set in resized())
    std::array<juce::TextButton, 6> modeButtons;
    juce::TextButton freezeButton { "Freeze" };
    juce::TextButton overlayButton { "Overlay" };
    juce::TextButton peakButton { "Peak" };
    juce::ComboBox floorBox;
    juce::ComboBox clashBox;
    juce::ComboBox targetBox;
    juce::ComboBox timebaseBox;
    juce::ComboBox gainBox;
    juce::ComboBox persistBox;
    juce::TextEditor nameEditor;

    // Layout (computed in resized() so painting and hit-testing always agree)
    juce::Rectangle<int> headerArea, meterArea, modeBarArea, controlsArea, loudnessArea, clipBox;
    juce::Rectangle<int> trackSwatchArea, trackNameArea;
    juce::Rectangle<float> spectrumArea;

    // GUI-thread copies of the analyser output
    std::array<float, SpectralAnalyzerDSP::NUM_BINS> spectrumDb {};
    std::array<float, SpectralAnalyzerDSP::NUM_BINS> peakSpectrumDb {};
    std::array<TrackSnapshot, MAX_SIMULTANEOUS_TRACKS> busTracks {};
    int numBusTracks { 0 };
    std::vector<CollisionResult> collisions;
    float displayFloorDb { -90.0f };

    // Sonogram: scrolling image, newest column on the right, log frequency bottom to top
    juce::Image sonogramImage;

    // Oscilloscope and Stereo: phosphor image redrawn each frame (faded, then traces on top)
    juce::Image scopeImage;
    std::vector<float> scratchLeft, scratchRight;
    StereoStats stereoStats;

    // Loudness history (about 30 s at the timer rate)
    static constexpr int LOUDNESS_HISTORY = 30 * 60;
    std::array<float, LOUDNESS_HISTORY> momentaryHistory {};
    std::array<float, LOUDNESS_HISTORY> shortTermHistory {};
    int loudnessWrite { 0 };

    // Meter ballistics (dBTP)
    std::array<float, 2> meterDb { -90.0f, -90.0f };
    std::array<float, 2> peakHoldDb { -90.0f, -90.0f };
    std::array<int, 2> peakHoldAgeFrames { 0, 0 };
    bool clipLatched { false };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (LiquidSpectraAudioProcessorEditor)
};

} // namespace LiquidAudio
