#include "PluginProcessor.h"
#include "PluginEditor.h"

namespace LiquidAudio {

MultiInstanceBus& LiquidSpectraAudioProcessor::getSharedBus() noexcept
{
    // Function-local static: constructed on first use, no static-initialisation-order issues
    static MultiInstanceBus bus;
    return bus;
}

LiquidSpectraAudioProcessor::LiquidSpectraAudioProcessor()
    : AudioProcessor (BusesProperties()
                      .withInput  ("Input",     juce::AudioChannelSet::stereo(), true)
                      .withOutput ("Output",    juce::AudioChannelSet::stereo(), true)
                      .withInput  ("Sidechain", juce::AudioChannelSet::stereo(), false))
{
    instanceId = getSharedBus().registerInstance (this);
    if (instanceId >= 0)
        trackName = "Track " + juce::String (instanceId + 1);
    publishTrackInfo();
}

LiquidSpectraAudioProcessor::~LiquidSpectraAudioProcessor()
{
    getSharedBus().unregisterInstance (instanceId);
}

bool LiquidSpectraAudioProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto mainOut = layouts.getMainOutputChannelSet();
    if (mainOut != juce::AudioChannelSet::mono() && mainOut != juce::AudioChannelSet::stereo())
        return false;

    if (layouts.getMainInputChannelSet() != mainOut)
        return false;

    if (layouts.inputBuses.size() > 1)
    {
        const auto sidechain = layouts.getChannelSet (true, 1);
        if (! sidechain.isDisabled() && sidechain != juce::AudioChannelSet::mono() && sidechain != juce::AudioChannelSet::stereo())
            return false;
    }

    return true;
}

void LiquidSpectraAudioProcessor::prepareToPlay (double sampleRate, int)
{
    spectralAnalyzer.prepare (sampleRate);
    loudnessMeter.prepare (sampleRate);
}

void LiquidSpectraAudioProcessor::releaseResources()
{
    spectralAnalyzer.reset();
}

void LiquidSpectraAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    // Analyse the main input only; the sidechain lives in the same buffer and must not leak in
    const auto mainInput = getBusBuffer (buffer, true, 0);
    const int numChannels = mainInput.getNumChannels();
    const int numSamples = mainInput.getNumSamples();

    if (numSamples > 0 && numChannels > 0)
    {
        const auto* const* channels = mainInput.getArrayOfReadPointers();
        spectralAnalyzer.pushSamples (channels, numChannels, numSamples);
        loudnessMeter.processBlock (channels, numChannels, numSamples);

        const auto& bark = spectralAnalyzer.getLatestBarkMagnitudes();
        getSharedBus().publishSpectrum (instanceId, bark.data(), (int) bark.size());
    }

    // Pure analyser: main audio passes through untouched; clear any extra output channels
    for (int ch = getTotalNumInputChannels(); ch < getTotalNumOutputChannels(); ++ch)
        buffer.clear (ch, 0, buffer.getNumSamples());
}

void LiquidSpectraAudioProcessor::setTrackName (const juce::String& name)
{
    {
        const juce::SpinLock::ScopedLockType lock (trackInfoLock);
        trackName = name;
    }
    publishTrackInfo();
}

juce::String LiquidSpectraAudioProcessor::getTrackName() const
{
    const juce::SpinLock::ScopedLockType lock (trackInfoLock);
    return trackName;
}

void LiquidSpectraAudioProcessor::setTrackColour (juce::Colour c)
{
    {
        const juce::SpinLock::ScopedLockType lock (trackInfoLock);
        trackColour = c;
    }
    publishTrackInfo();
}

juce::Colour LiquidSpectraAudioProcessor::getTrackColour() const
{
    const juce::SpinLock::ScopedLockType lock (trackInfoLock);
    return trackColour;
}

void LiquidSpectraAudioProcessor::updateTrackProperties (const TrackProperties& properties)
{
    {
        const juce::SpinLock::ScopedLockType lock (trackInfoLock);
        if (properties.name.has_value() && properties.name->isNotEmpty())
            trackName = *properties.name;
        if (properties.colourARGB.has_value())
            trackColour = juce::Colour (*properties.colourARGB);
    }
    publishTrackInfo();
}

void LiquidSpectraAudioProcessor::publishTrackInfo()
{
    // Several threads may set the name/colour; the lock keeps the bus slot single-writer
    const juce::SpinLock::ScopedLockType lock (trackInfoLock);
    getSharedBus().setTrackInfo (instanceId, trackName.toRawUTF8(), trackColour.getARGB());
}

void LiquidSpectraAudioProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    juce::ValueTree state ("LiquidSpectraState");
    state.setProperty ("trackName", getTrackName(), nullptr);
    state.setProperty ("trackColour", (juce::int64) getTrackColour().getARGB(), nullptr);

    if (auto xml = state.createXml())
        copyXmlToBinary (*xml, destData);
}

void LiquidSpectraAudioProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    const auto xml = getXmlFromBinary (data, sizeInBytes);
    if (xml == nullptr)
        return;

    const auto state = juce::ValueTree::fromXml (*xml);
    if (! state.hasType ("LiquidSpectraState"))
        return;

    {
        const juce::SpinLock::ScopedLockType lock (trackInfoLock);
        if (state.hasProperty ("trackName"))
            trackName = state["trackName"].toString();
        if (state.hasProperty ("trackColour"))
            trackColour = juce::Colour ((juce::uint32) (juce::int64) state["trackColour"]);
    }
    publishTrackInfo();
}

juce::AudioProcessorEditor* LiquidSpectraAudioProcessor::createEditor()
{
    return new LiquidSpectraAudioProcessorEditor (*this);
}

} // namespace LiquidAudio

// Factory used by the JUCE plugin wrappers
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new LiquidAudio::LiquidSpectraAudioProcessor();
}
