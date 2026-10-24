#include "PluginWebEditor.h"
#include <cmath>
#include <initializer_list>
#include <utility>
#include "LiquidSpectraWebData.h"

namespace LiquidAudio {

namespace
{
    constexpr int WAVE_FRAMES = 2048;     // ~43 ms at 48 kHz per push; the web UI accumulates its own history
    constexpr int UI_REFRESH_HZ = 30;
    constexpr float SILENCE_FLOOR_DB = -120.0f;

    juce::var makeObject (std::initializer_list<std::pair<const char*, juce::var>> properties)
    {
        auto* object = new juce::DynamicObject();
        for (const auto& [name, value] : properties)
            object->setProperty (name, value);
        return juce::var (object);
    }

    // The JSON encoder rejects NaN and infinity, so every float leaves the plugin through here
    double finiteOr (float value, double fallback)
    {
        return std::isfinite (value) ? (double) value : fallback;
    }
}

LiquidSpectraWebEditor::LiquidSpectraWebEditor (LiquidSpectraAudioProcessor& p)
    : AudioProcessorEditor (&p), audioProcessor (p)
{
    waveLeft.resize ((size_t) WAVE_FRAMES, 0.0f);
    waveRight.resize ((size_t) WAVE_FRAMES, 0.0f);

    const auto userData = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
                              .getChildFile ("LiquidSpectra")
                              .getChildFile ("WebView");

    // WebView2 explicitly: the default Windows backend is the legacy MSHTML engine, which has no resource provider
    const auto options = juce::WebBrowserComponent::Options {}
                             .withBackend (juce::WebBrowserComponent::Options::Backend::webview2)
                             .withWinWebView2Options (juce::WebBrowserComponent::Options::WinWebView2 {}.withUserDataFolder (userData))
                             .withNativeIntegrationEnabled()
                             .withResourceProvider ([this] (const juce::String& url) { return serveResource (url); })
                             .withEventListener ("ui", [this] (juce::var message) { handleUiEvent (message); });

    webView = std::make_unique<juce::WebBrowserComponent> (options);
    addAndMakeVisible (*webView);
    webView->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());

    setResizable (true, true);
    setResizeLimits (720, 480, 2560, 1600);
    setSize (1100, 680);

    startTimerHz (UI_REFRESH_HZ);
}

LiquidSpectraWebEditor::~LiquidSpectraWebEditor()
{
    stopTimer();
    webView.reset();
}

void LiquidSpectraWebEditor::resized()
{
    if (webView != nullptr)
        webView->setBounds (getLocalBounds());
}

std::optional<juce::WebBrowserComponent::Resource> LiquidSpectraWebEditor::serveResource (const juce::String&) const
{
    // The whole web analyzer is one self-contained page: scripts and styles are inlined at build time
    juce::WebBrowserComponent::Resource resource;
    const auto* bytes = reinterpret_cast<const std::byte*> (BinaryData::index_html);
    resource.data.assign (bytes, bytes + BinaryData::index_htmlSize);
    resource.mimeType = "text/html";
    return resource;
}

void LiquidSpectraWebEditor::handleUiEvent (const juce::var& message)
{
    const auto op = message.getProperty ("op", {}).toString();

    if (op == "ready")
    {
        webReady = true;
        // Always answer, so the page knows whether there is a saved state to restore
        const auto saved = audioProcessor.getWebState();
        webView->evaluateJavascript ("window.__LS_RESTORE__&&window.__LS_RESTORE__(" + (saved.isNotEmpty() ? saved : juce::String ("null")) + ")");
    }
    else if (op == "wantWaveform")
    {
        wantWaveform = (bool) message.getProperty ("value", false);
    }
    else if (op == "rename")
    {
        const auto name = message.getProperty ("name", {}).toString().trim();
        if (name.isNotEmpty())
            audioProcessor.setTrackName (name);
    }
    else if (op == "colour")
    {
        audioProcessor.setTrackColour (juce::Colour ((juce::uint32) (juce::int64) message.getProperty ("argb", 0)));
    }
    else if (op == "resetLoudness")
    {
        audioProcessor.getLoudnessMeter().requestReset();
    }
    else if (op == "saveState")
    {
        audioProcessor.setWebState (message.getProperty ("json", {}).toString());
    }
}

juce::var LiquidSpectraWebEditor::buildFrame()
{
    auto& bus = LiquidSpectraAudioProcessor::getSharedBus();
    auto& loudness = audioProcessor.getLoudnessMeter();
    const int selfId = audioProcessor.getInstanceId();
    const int numTracks = bus.snapshot (busTracks);

    juce::Array<juce::var> tracks;
    for (int t = 0; t < numTracks; ++t)
    {
        const auto& entry = busTracks[(size_t) t];
        const int slot = entry.instanceId;

        if (! bus.readFullSpectrum (slot, spectrumScratch.data(), BUS_SPECTRUM_BINS))
            spectrumScratch.fill (SILENCE_FLOOR_DB);

        auto track = makeObject ({
            { "slot", slot },
            { "self", slot == selfId },
            { "name", juce::String (entry.name) },
            { "argb", (juce::int64) entry.colourArgb },
            { "spec", juce::Base64::toBase64 (spectrumScratch.data(), sizeof (float) * BUS_SPECTRUM_BINS) },
            { "bark", juce::Base64::toBase64 (entry.barkMagnitudes, sizeof (float) * BARK_BANDS_COUNT) },
        });

        if (wantWaveform)
        {
            std::int64_t end = 0;
            if (bus.readWaveform (slot, waveLeft.data(), waveRight.data(), WAVE_FRAMES, end))
            {
                track.getDynamicObject()->setProperty ("end", (juce::int64) end);
                track.getDynamicObject()->setProperty ("wl", juce::Base64::toBase64 (waveLeft.data(), sizeof (float) * WAVE_FRAMES));
                track.getDynamicObject()->setProperty ("wr", juce::Base64::toBase64 (waveRight.data(), sizeof (float) * WAVE_FRAMES));
            }
        }

        tracks.add (track);
    }

    juce::Array<juce::var> collisions;
    for (const auto& c : CollisionDetector::analyzeCollisions (busTracks.data(), numTracks, audioProcessor.getClashThreshold()))
    {
        collisions.add (makeObject ({
            { "a", c.trackAId },
            { "b", c.trackBId },
            { "aName", juce::String (c.trackAName) },
            { "bName", juce::String (c.trackBName) },
            { "band", c.criticalBandIndex },
            { "hz", finiteOr (c.centerFrequencyHz, 0.0) },
            { "severity", finiteOr (c.maskingSeverity, 0.0) },
            { "cutDb", finiteOr (c.recommendedCutGainDb, 0.0) },
            { "q", finiteOr (c.recommendedQ, 0.0) },
        }));
    }

    const auto frame = makeObject ({
        { "t", (juce::int64) frameCounter++ },
        { "sr", finiteOr ((float) audioProcessor.getSpectralAnalyzer().getSampleRate(), 48000.0) },
        { "self", selfId },
        { "tracks", tracks },
        { "collisions", collisions },
        { "loud", makeObject ({
            { "m", finiteOr (loudness.getMomentaryLUFS(), -120.0) },
            { "s", finiteOr (loudness.getShortTermLUFS(), -120.0) },
            { "i", finiteOr (loudness.getIntegratedLUFS(), -120.0) },
            { "lra", finiteOr (loudness.getLoudnessRangeLU(), 0.0) },
            { "tp", finiteOr (loudness.getTruePeakDb(), -120.0) },
        }) },
        { "meter", makeObject ({
            { "peakL", finiteOr (loudness.getRecentTruePeakDb (0), -120.0) },
            { "peakR", finiteOr (loudness.getRecentTruePeakDb (1), -120.0) },
        }) },
    });

    return frame;
}

void LiquidSpectraWebEditor::timerCallback()
{
    if (! webReady || webView == nullptr)
        return;

    const auto json = juce::JSON::toString (buildFrame(), true);
    webView->evaluateJavascript ("window.__LS_FRAME__&&window.__LS_FRAME__(" + json + ")");
}

} // namespace LiquidAudio
