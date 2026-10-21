#include "PluginEditor.h"
#include <cmath>

namespace LiquidAudio {

LiquidSpectraAudioProcessorEditor::LiquidSpectraAudioProcessorEditor(LiquidSpectraAudioProcessor& p)
    : AudioProcessorEditor(&p), audioProcessor(p)
{
    // FabFilter standard plugin window proportions
    setSize(980, 560);
    setResizable(true, true);
    setResizeLimits(740, 440, 2560, 1440);

    displayMagnitudes.resize(SpectralAnalyzerDSP::NUM_BARK_BANDS, -100.0f);

    // High refresh rate 60 FPS UI timer (16.6ms)
    startTimerHz(60);
}

LiquidSpectraAudioProcessorEditor::~LiquidSpectraAudioProcessorEditor()
{
    stopTimer();
}

void LiquidSpectraAudioProcessorEditor::resized()
{
    // Reactive layout automatically adapts bounds
}

void LiquidSpectraAudioProcessorEditor::timerCallback()
{
    // 1. Fetch live DSP magnitudes from audio processor
    const auto& liveMagnitudes = audioProcessor.getSpectralAnalyzer().getLatestBarkMagnitudes();
    for (size_t i = 0; i < liveMagnitudes.size() && i < displayMagnitudes.size(); ++i)
    {
        // Smooth exponential attack / release
        const float target = liveMagnitudes[i];
        if (target > displayMagnitudes[i])
            displayMagnitudes[i] += (target - displayMagnitudes[i]) * 0.45f;
        else
            displayMagnitudes[i] += (target - displayMagnitudes[i]) * 0.12f;
    }

    // 2. Fetch live Loudness / True-Peak metrics
    auto& loudness = audioProcessor.getLoudnessMeter();
    const float currentPeak = loudness.getTruePeakDb();
    
    // Smooth meter dynamics
    smoothedPeakL = juce::jmax(smoothedPeakL - 1.2f, currentPeak);
    smoothedPeakR = juce::jmax(smoothedPeakR - 1.2f, currentPeak);
    smoothedRmsL = juce::jmax(smoothedRmsL - 0.8f, loudness.getIntegratedLoudnessLUFS());
    smoothedRmsR = juce::jmax(smoothedRmsR - 0.8f, loudness.getIntegratedLoudnessLUFS());

    if (smoothedPeakL > 0.0f)
        clipLatched = true;

    if (smoothedPeakL > peakHoldDbL)
    {
        peakHoldDbL = smoothedPeakL;
        peakHoldAgeFrames = 0;
    }
    else if (++peakHoldAgeFrames > 70)
    {
        peakHoldDbL = juce::jmax(-60.0f, peakHoldDbL - 0.4f);
    }

    repaint();
}

float LiquidSpectraAudioProcessorEditor::freqToX(float freqHz, juce::Rectangle<float> b) const noexcept
{
    const float minF = 20.0f;
    const float maxF = 20000.0f;
    const float norm = std::log10(juce::jlimit(minF, maxF, freqHz) / minF) / std::log10(maxF / minF);
    return b.getX() + norm * b.getWidth();
}

float LiquidSpectraAudioProcessorEditor::dbToY(float db, juce::Rectangle<float> b) const noexcept
{
    const float minDb = -90.0f;
    const float maxDb = 12.0f;
    const float norm = (juce::jlimit(minDb, maxDb, db) - minDb) / (maxDb - minDb);
    return b.getBottom() - norm * b.getHeight();
}

void LiquidSpectraAudioProcessorEditor::paint(juce::Graphics& g)
{
    // 1. Deep OLED/Obsidian FabFilter background
    g.fillAll(juce::Colour(0xff090b10));

    auto totalArea = getLocalBounds();
    auto headerArea = totalArea.removeFromTop(44);
    auto meterArea = totalArea.removeFromRight(64);
    auto spectrumArea = totalArea.toFloat().reduced(4.0f);

    paintHeader(g, headerArea);
    paintFrequencyGrid(g, spectrumArea);
    paintCollisionRegions(g, spectrumArea);
    paintSpectrumCurves(g, spectrumArea);
    paintMasterOutputMeter(g, meterArea);
}

void LiquidSpectraAudioProcessorEditor::paintHeader(juce::Graphics& g, juce::Rectangle<int> bounds)
{
    g.setColour(juce::Colour(0xff121620));
    g.fillRect(bounds);
    g.setColour(juce::Colour(0x20ffffff));
    g.drawHorizontalLine(bounds.getBottom() - 1, (float)bounds.getX(), (float)bounds.getRight());

    // Brand Wordmark
    g.setFont(juce::Font(15.0f, juce::Font::bold));
    g.setColour(juce::Colours::white);
    g.drawText("LiquidSpectra", bounds.getX() + 16, bounds.getY() + 8, 110, 26, juce::Justification::left);

    g.setFont(juce::Font(11.0f, juce::Font::bold));
    g.setColour(juce::Colour(0xff06b6d4));
    g.drawText("PRO VST3 / AU", bounds.getX() + 130, bounds.getY() + 9, 100, 26, juce::Justification::left);

    // Track Identifier Pill
    g.setColour(audioProcessor.getTrackColour().withAlpha(0.2f));
    juce::Rectangle<float> trackPill((float)(bounds.getRight() - 180), (float)(bounds.getY() + 10), 160.0f, 24.0f);
    g.fillRoundedRectangle(trackPill, 12.0f);
    g.setColour(audioProcessor.getTrackColour());
    g.drawRoundedRectangle(trackPill, 12.0f, 1.0f);
    g.drawText(audioProcessor.getTrackName(), trackPill.toNearestInt(), juce::Justification::centred);
}

void LiquidSpectraAudioProcessorEditor::paintFrequencyGrid(juce::Graphics& g, juce::Rectangle<float> b)
{
    static const float freqs[] = { 30, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 16000 };
    static const char* labels[] = { "30", "50", "100", "250", "500", "1k", "2k", "5k", "10k", "16k" };

    g.setFont(juce::Font(10.0f, juce::Font::plain));
    for (size_t i = 0; i < 10; ++i)
    {
        const float x = freqToX(freqs[i], b);
        g.setColour(juce::Colour(0x15ffffff));
        g.drawVerticalLine((int)x, b.getY(), b.getBottom());

        g.setColour(juce::Colour(0x60ffffff));
        g.drawText(labels[i], (int)x - 18, (int)b.getBottom() - 16, 36, 14, juce::Justification::centred);
    }

    // Horizontal dB lines (-60, -36, -24, -12, 0 dB)
    static const float dBs[] = { -60.0f, -36.0f, -24.0f, -12.0f, 0.0f };
    for (float db : dBs)
    {
        const float y = dbToY(db, b);
        g.setColour(db == 0.0f ? juce::Colour(0x35ef4444) : juce::Colour(0x12ffffff));
        g.drawHorizontalLine((int)y, b.getX(), b.getRight());

        g.setColour(juce::Colour(0x50ffffff));
        g.drawText(juce::String((int)db) + " dB", (int)b.getX() + 6, (int)y - 12, 45, 12, juce::Justification::left);
    }
}

void LiquidSpectraAudioProcessorEditor::paintCollisionRegions(juce::Graphics& g, juce::Rectangle<float> b)
{
    // Check shared bus for other tracks colliding in the low/mid range (kick vs bass)
    auto otherTracks = LiquidSpectraAudioProcessor::getSharedBus().snapshotActiveTracks();
    if (otherTracks.size() <= 1) return;

    for (const auto& track : otherTracks)
    {
        if (track.instanceId == audioProcessor.getInstanceId()) continue;

        // Bark band 3-6 (150Hz - 400Hz) clash check
        for (int band = 2; band <= 6; ++band)
        {
            float myAmp = displayMagnitudes[band];
            float theirAmp = track.barkMagnitudes[band];

            if (myAmp > -30.0f && theirAmp > -30.0f && std::abs(myAmp - theirAmp) < 6.0f)
            {
                // Draw pulsating collision hotspot
                float fCenter = 100.0f * (float)std::pow(1.5f, band);
                float x = freqToX(fCenter, b);
                juce::Rectangle<float> warningZone(x - 22.0f, b.getY(), 44.0f, b.getHeight());

                g.setColour(juce::Colour(0x28ff0055));
                g.fillRect(warningZone);

                g.setColour(juce::Colour(0xffff0055));
                g.drawText("CLASH", (int)x - 20, (int)b.getY() + 10, 40, 14, juce::Justification::centred);
            }
        }
    }
}

void LiquidSpectraAudioProcessorEditor::paintSpectrumCurves(juce::Graphics& g, juce::Rectangle<float> b)
{
    juce::Path curve;
    const auto& barkEdges = SpectralAnalyzerDSP::getBarkCenterFrequencies();
    const size_t numPoints = std::min(barkEdges.size(), displayMagnitudes.size());

    if (numPoints < 2) return;

    const float firstX = freqToX(barkEdges[0], b);
    const float firstY = dbToY(displayMagnitudes[0], b);
    curve.startNewSubPath(firstX, firstY);

    for (size_t i = 1; i < numPoints; ++i)
    {
        const float x = freqToX(barkEdges[i], b);
        const float y = dbToY(displayMagnitudes[i], b);
        curve.lineTo(x, y);
    }

    // 1. Fill below curve with liquid glowing gradient
    juce::Path fillPath = curve;
    fillPath.lineTo(b.getRight(), b.getBottom());
    fillPath.lineTo(b.getX(), b.getBottom());
    fillPath.closeSubPath();

    juce::ColourGradient grad(
        juce::Colour(0x5006b6d4), b.getCentreX(), b.getY(),
        juce::Colour(0x0206b6d4), b.getCentreX(), b.getBottom(), false);
    g.setGradientFill(grad);
    g.fillPath(fillPath);

    // 2. Neon illuminated vector spline stroke
    g.setColour(juce::Colour(0xff22d3ee));
    g.strokePath(curve, juce::PathStrokeType(2.2f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
}

void LiquidSpectraAudioProcessorEditor::paintMasterOutputMeter(juce::Graphics& g, juce::Rectangle<int> bounds)
{
    // Dark glass meter strip
    g.setColour(juce::Colour(0xff0d1017));
    g.fillRect(bounds);
    g.setColour(juce::Colour(0x20ffffff));
    g.drawVerticalLine(bounds.getX(), (float)bounds.getY(), (float)bounds.getBottom());

    // Clip Indicator
    juce::Rectangle<int> clipBox(bounds.getX() + 12, bounds.getY() + 8, bounds.getWidth() - 24, 16);
    g.setColour(clipLatched ? juce::Colour(0xffff2244) : juce::Colour(0x30331111));
    g.fillRoundedRectangle(clipBox.toFloat(), 4.0f);
    g.setColour(clipLatched ? juce::Colours::white : juce::Colour(0x60ffffff));
    g.setFont(juce::Font(9.0f, juce::Font::bold));
    g.drawText("CLIP", clipBox, juce::Justification::centred);

    // Stereo Meter Bars (L / R)
    auto barArea = bounds.reduced(14, 30);
    barArea.removeFromTop(10);
    barArea.removeFromBottom(40);

    const int barWidth = (barArea.getWidth() - 4) / 2;
    juce::Rectangle<int> barL(barArea.getX(), barArea.getY(), barWidth, barArea.getHeight());
    juce::Rectangle<int> barR(barArea.getX() + barWidth + 4, barArea.getY(), barWidth, barArea.getHeight());

    // Meter slot background
    g.setColour(juce::Colour(0xff05070a));
    g.fillRect(barL);
    g.fillRect(barR);

    // Compute active height from dB (-60 to 0)
    auto computeH = [&](float db, int maxH) {
        float norm = (juce::jlimit(-60.0f, 0.0f, db) + 60.0f) / 60.0f;
        return (int)(norm * maxH);
    };

    int hL = computeH(smoothedPeakL, barL.getHeight());
    int hR = computeH(smoothedPeakR, barR.getHeight());

    juce::ColourGradient meterGrad(
        juce::Colour(0xffff3355), 0, (float)barL.getY(),
        juce::Colour(0xff10b981), 0, (float)barL.getBottom(), false);

    g.setGradientFill(meterGrad);
    g.fillRect(barL.getX(), barL.getBottom() - hL, barL.getWidth(), hL);
    g.fillRect(barR.getX(), barR.getBottom() - hR, barR.getWidth(), hR);

    // Peak hold ticks
    int holdYL = barL.getBottom() - computeH(peakHoldDbL, barL.getHeight());
    int holdYR = barR.getBottom() - computeH(peakHoldDbR, barR.getHeight());
    g.setColour(juce::Colours::white);
    g.drawHorizontalLine(holdYL, (float)barL.getX(), (float)barL.getRight());
    g.drawHorizontalLine(holdYR, (float)barR.getX(), (float)barR.getRight());

    // Master Volume Drag Handle & Percentage Label
    juce::Rectangle<int> faderBox(bounds.getX() + 6, bounds.getBottom() - 34, bounds.getWidth() - 12, 26);
    g.setColour(juce::Colour(0xff182030));
    g.fillRoundedRectangle(faderBox.toFloat(), 6.0f);
    g.setColour(juce::Colour(0xff38bdf8));
    g.drawRoundedRectangle(faderBox.toFloat(), 6.0f, 1.0f);
    g.setFont(juce::Font(10.0f, juce::Font::bold));
    g.drawText(juce::String((int)(masterGainLevel * 100.0f)) + "%", faderBox, juce::Justification::centred);
}

void LiquidSpectraAudioProcessorEditor::mouseDown(const juce::MouseEvent& e)
{
    // Clip badge click resets clip
    juce::Rectangle<int> clipBox(getWidth() - 52, 8, 40, 16);
    if (clipBox.contains(e.getPosition()))
    {
        clipLatched = false;
        peakHoldDbL = -60.0f;
        peakHoldDbR = -60.0f;
        repaint();
        return;
    }

    if (e.x > getWidth() - 64)
    {
        isDraggingMasterFader = true;
    }
}

void LiquidSpectraAudioProcessorEditor::mouseDrag(const juce::MouseEvent& e)
{
    if (isDraggingMasterFader)
    {
        const float delta = (float)-e.getDistanceFromDragStartY() / 150.0f;
        masterGainLevel = juce::jlimit(0.0f, 1.25f, masterGainLevel + delta * 0.05f);
        repaint();
    }
}

void LiquidSpectraAudioProcessorEditor::mouseWheelMove(const juce::MouseEvent& e, const juce::MouseWheelDetails& wheel)
{
    if (e.x > getWidth() - 64)
    {
        masterGainLevel = juce::jlimit(0.0f, 1.25f, masterGainLevel + wheel.deltaY * 0.05f);
        repaint();
    }
}

void LiquidSpectraAudioProcessorEditor::mouseDoubleClick(const juce::MouseEvent& e)
{
    if (e.x > getWidth() - 64)
    {
        masterGainLevel = 1.0f; // Reset to unity (100% / 0 dB)
        repaint();
    }
}

} // namespace LiquidAudio
