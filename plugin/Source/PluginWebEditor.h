#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include <array>
#include <cstdint>
#include <memory>
#include <optional>
#include <vector>
#include "PluginProcessor.h"

namespace LiquidAudio {

/**
 * Hosts the web analyzer inside the plugin window (WebView2 on Windows, WKWebView on macOS).
 * Every frame the shared DSP state (all instances on the bus, collisions, loudness, meters) is pushed
 * into the page as JSON; UI actions come back as "ui" events.
 */
class LiquidSpectraWebEditor : public juce::AudioProcessorEditor,
                               private juce::Timer
{
public:
    explicit LiquidSpectraWebEditor (LiquidSpectraAudioProcessor&);
    ~LiquidSpectraWebEditor() override;

    void resized() override;

private:
    void timerCallback() override;

    std::optional<juce::WebBrowserComponent::Resource> serveResource (const juce::String& url) const;
    void handleUiEvent (const juce::var& message);
    juce::var buildFrame();

    LiquidSpectraAudioProcessor& audioProcessor;
    std::unique_ptr<juce::WebBrowserComponent> webView;
    bool webReady { false };
    bool wantWaveform { false };
    std::int64_t frameCounter { 0 };

    // Scratch buffers (message thread only)
    std::array<float, BUS_SPECTRUM_BINS> spectrumScratch {};
    std::array<TrackSnapshot, MAX_SIMULTANEOUS_TRACKS> busTracks {};
    std::vector<float> waveLeft, waveRight;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (LiquidSpectraWebEditor)
};

} // namespace LiquidAudio
