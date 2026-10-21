#include "PluginProcessor.h"
#include "PluginEditor.h"

namespace LiquidAudio {

MultiInstanceBus LiquidSpectraAudioProcessor::sharedBus;

LiquidSpectraAudioProcessor::LiquidSpectraAudioProcessor()
    : AudioProcessor(BusesProperties()
                     .withInput  ("Input",     juce::AudioChannelSet::stereo(), true)
                     .withOutput ("Output",    juce::AudioChannelSet::stereo(), true)
                     .withInput  ("Sidechain", juce::AudioChannelSet::stereo(), false))
{
    instanceId = sharedBus.registerInstance(this);
}

LiquidSpectraAudioProcessor::~LiquidSpectraAudioProcessor()
{
    sharedBus.unregisterInstance(instanceId);
}

bool LiquidSpectraAudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    // Must have matching main I/O
    if (layouts.getMainOutputChannelSet() != juce::AudioChannelSet::mono()
     && layouts.getMainOutputChannelSet() != juce::AudioChannelSet::stereo())
        return false;

    if (layouts.getMainInputChannelSet() != layouts.getMainOutputChannelSet())
        return false;

    // Sidechain input must be mono or stereo if enabled
    auto sidechain = layouts.getChannelSet(true, 1);
    if (!sidechain.isDisabled() && sidechain != juce::AudioChannelSet::mono() && sidechain != juce::AudioChannelSet::stereo())
        return false;

    return true;
}

void LiquidSpectraAudioProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    spectralAnalyzer.prepare(sampleRate, samplesPerBlock);
    loudnessMeter.prepare(sampleRate, samplesPerBlock);
}

void LiquidSpectraAudioProcessor::releaseResources()
{
    spectralAnalyzer.reset();
    loudnessMeter.reset();
}

void LiquidSpectraAudioProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    const int totalNumInputChannels  = getTotalNumInputChannels();
    const int numSamples = buffer.getNumSamples();

    if (numSamples == 0 || totalNumInputChannels == 0)
        return;

    // 1. Send audio block to local spectral analyzer (FFT + Bark mapping)
    spectralAnalyzer.pushAudioBlock(buffer);

    // 2. Measure ITU-R BS.1770 LUFS and True Peak
    loudnessMeter.processBlock(buffer);

    // 3. Broadcast spectral frame to shared multi-track bus for cross-track collision detection
    const auto& currentMagnitudes = spectralAnalyzer.getLatestBarkMagnitudes();
    sharedBus.publishSpectrum(instanceId, trackName, trackColour, currentMagnitudes.data(), (int)currentMagnitudes.size());

    // Pass-through audio unaltered (pure analyzer)
}

void LiquidSpectraAudioProcessor::getStateInformation(juce::MemoryBlock&) {}
void LiquidSpectraAudioProcessor::setStateInformation(const void*, int) {}

juce::AudioProcessorEditor* LiquidSpectraAudioProcessor::createEditor()
{
    return new LiquidSpectraAudioProcessorEditor(*this);
}

} // namespace LiquidAudio
