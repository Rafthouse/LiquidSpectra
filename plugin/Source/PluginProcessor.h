#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_dsp/juce_dsp.h>
#include <atomic>
#include "SpectralAnalyzerDSP.h"
#include "CollisionDetector.h"
#include "LoudnessMeterEBU.h"
#include "MultiInstanceBus.h"
#include "SampleRing.h"

namespace LiquidAudio {

/** View options shared with the web analyzer's AnalyzerSettings. GUI-only; saved with the project. */
struct DisplaySettings
{
    int frequencyScale { 0 };  // 0 log, 1 linear, 2 bark, 3 mel
    int smoothing { 0 };       // 0 none, 1 1/48 ... 6 1/1 octave
    int tilt { 0 };            // 0 off, 1 +3 dB/oct, 2 +4.5 dB/oct
    int spectrumStyle { 0 };   // 0 curve, 1 bars, 2 stepped
    int decay { 1 };           // peak hold: 0 slow, 1 medium, 2 fast, 3 hold
    int palette { 0 };         // sonogram: 0 liquid, 1 magma, 2 viridis, 3 cyber, 4 grayscale
    int sonogramSpeed { 1 };   // columns per frame, 1 to 5
    int triggerMode { 0 };     // scope: 0 auto (roll), 1 norm (hold), 2 freeze
    bool pianoRoll { true };
    bool collisionOverlay { true };
};

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

    // Display settings chosen in the editor (GUI thread writes, GUI timer reads; saved with the project)
    float getDisplayFloorDb() const noexcept { return displayFloorDb.load (std::memory_order_relaxed); }
    void setDisplayFloorDb (float db) noexcept { displayFloorDb.store (juce::jlimit (-120.0f, -40.0f, db), std::memory_order_relaxed); }
    bool getShowOverlay() const noexcept { return showOverlay.load (std::memory_order_relaxed); }
    void setShowOverlay (bool show) noexcept { showOverlay.store (show, std::memory_order_relaxed); }
    float getClashThreshold() const noexcept { return clashThreshold.load (std::memory_order_relaxed); }
    void setClashThreshold (float threshold) noexcept { clashThreshold.store (juce::jlimit (0.05f, 0.95f, threshold), std::memory_order_relaxed); }

    DisplaySettings getDisplaySettings() const
    {
        const juce::SpinLock::ScopedLockType lock (displayLock);
        return displaySettings;
    }
    void setDisplaySettings (const DisplaySettings& settings)
    {
        const juce::SpinLock::ScopedLockType lock (displayLock);
        displaySettings = settings;
    }

    const SpectralAnalyzerDSP& getSpectralAnalyzer() const noexcept { return spectralAnalyzer; }
    LoudnessMeterEBU& getLoudnessMeter() noexcept { return loudnessMeter; }
    static MultiInstanceBus& getSharedBus() noexcept;

    /** Web UI state (opaque JSON from the web app), saved with the project and handed back on load. */
    void setWebState (const juce::String& json);
    juce::String getWebState() const;

private:
    void publishTrackInfo();

    int instanceId { -1 };

    mutable juce::SpinLock trackInfoLock;
    juce::String trackName { "Track" };
    juce::Colour trackColour { juce::Colours::cyan };

    std::atomic<float> displayFloorDb { -90.0f };
    std::atomic<bool> showOverlay { true };
    std::atomic<float> clashThreshold { 0.40f };
    mutable juce::SpinLock displayLock;
    DisplaySettings displaySettings;

    SpectralAnalyzerDSP spectralAnalyzer;
    LoudnessMeterEBU loudnessMeter;
    mutable juce::SpinLock webStateLock;
    juce::String webState;
    std::uint32_t lastPublishedFrameVersion { 0 }; // audio thread only

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (LiquidSpectraAudioProcessor)
};

} // namespace LiquidAudio
