#include "PluginEditor.h"
#include <cmath>

namespace LiquidAudio {

namespace
{
    constexpr float MIN_FREQ = 20.0f;
    constexpr float MAX_FREQ = 20000.0f;
    constexpr float MIN_DB = -90.0f;
    constexpr float MAX_DB = 6.0f;
    constexpr float METER_MIN_DB = -60.0f;
    constexpr int TIMER_HZ = 60;
    constexpr int PEAK_HOLD_FRAMES = TIMER_HZ * 3 / 2; // 1.5 s

    juce::Font uiFont (float height, bool bold = false)
    {
        return juce::Font (juce::FontOptions (height, bold ? juce::Font::bold : juce::Font::plain));
    }

    juce::String formatLufs (float value)
    {
        return value <= LoudnessMeterEBU::SILENCE_DB + 0.5f ? juce::String ("-inf") : juce::String (value, 1);
    }
}

LiquidSpectraAudioProcessorEditor::LiquidSpectraAudioProcessorEditor (LiquidSpectraAudioProcessor& p)
    : AudioProcessorEditor (&p), audioProcessor (p)
{
    spectrumDb.fill (SpectralAnalyzerDSP::FLOOR_DB);

    setResizable (true, true);
    setResizeLimits (740, 440, 2560, 1440);
    setSize (980, 560);

    startTimerHz (TIMER_HZ);
}

LiquidSpectraAudioProcessorEditor::~LiquidSpectraAudioProcessorEditor()
{
    stopTimer();
}

void LiquidSpectraAudioProcessorEditor::resized()
{
    auto area = getLocalBounds();
    headerArea = area.removeFromTop (44);
    meterArea = area.removeFromRight (72);
    spectrumArea = area.toFloat().reduced (4.0f);

    clipBox = { meterArea.getX() + 12, meterArea.getY() + 8, meterArea.getWidth() - 24, 16 };
    loudnessArea = headerArea.withTrimmedLeft (250).withTrimmedRight (190);
}

void LiquidSpectraAudioProcessorEditor::timerCallback()
{
    // 1. Spectrum of this instance (consistent copy via the analyser's sequence lock)
    audioProcessor.getSpectralAnalyzer().readSpectrum (spectrumDb);

    // 2. Every instance on the shared bus, then cross-track masking for this one
    numBusTracks = LiquidSpectraAudioProcessor::getSharedBus().snapshot (busTracks);
    collisions = CollisionDetector::analyzeCollisions (busTracks.data(), numBusTracks);

    // 3. Per-channel true-peak meters with peak hold and clip latch
    const auto& loudness = audioProcessor.getLoudnessMeter();
    for (int ch = 0; ch < 2; ++ch)
    {
        const float target = loudness.getRecentTruePeakDb (ch);
        auto& level = meterDb[(size_t) ch];
        level = target > level ? target : juce::jmax (target, level - 1.2f); // instant attack, ~72 dB/s release

        auto& hold = peakHoldDb[(size_t) ch];
        auto& age = peakHoldAgeFrames[(size_t) ch];
        if (target >= hold)
        {
            hold = target;
            age = 0;
        }
        else if (++age > PEAK_HOLD_FRAMES)
        {
            hold = juce::jmax (-90.0f, hold - 0.4f);
        }

        if (target > 0.0f)
            clipLatched = true;
    }

    repaint();
}

float LiquidSpectraAudioProcessorEditor::freqToX (float freqHz, juce::Rectangle<float> b) const noexcept
{
    const float norm = std::log10 (juce::jlimit (MIN_FREQ, MAX_FREQ, freqHz) / MIN_FREQ) / std::log10 (MAX_FREQ / MIN_FREQ);
    return b.getX() + norm * b.getWidth();
}

float LiquidSpectraAudioProcessorEditor::dbToY (float db, juce::Rectangle<float> b) const noexcept
{
    const float norm = (juce::jlimit (MIN_DB, MAX_DB, db) - MIN_DB) / (MAX_DB - MIN_DB);
    return b.getBottom() - norm * b.getHeight();
}

void LiquidSpectraAudioProcessorEditor::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour (0xff090b10));

    paintHeader (g, headerArea);
    paintFrequencyGrid (g, spectrumArea);
    paintCollisionRegions (g, spectrumArea);
    paintOtherTracks (g, spectrumArea);
    paintSpectrumCurve (g, spectrumArea);
    paintMasterOutputMeter (g, meterArea);
}

void LiquidSpectraAudioProcessorEditor::paintHeader (juce::Graphics& g, juce::Rectangle<int> bounds)
{
    g.setColour (juce::Colour (0xff121620));
    g.fillRect (bounds);
    g.setColour (juce::Colour (0x20ffffff));
    g.drawHorizontalLine (bounds.getBottom() - 1, (float) bounds.getX(), (float) bounds.getRight());

    g.setFont (uiFont (15.0f, true));
    g.setColour (juce::Colours::white);
    g.drawText ("LiquidSpectra", bounds.getX() + 16, bounds.getY() + 8, 120, 26, juce::Justification::centredLeft);

    g.setFont (uiFont (11.0f, true));
    g.setColour (juce::Colour (0xff06b6d4));
    g.drawText ("ANALYZER", bounds.getX() + 136, bounds.getY() + 9, 100, 26, juce::Justification::centredLeft);

    // EBU R128 readouts (double-click to reset)
    const auto& loudness = audioProcessor.getLoudnessMeter();
    const std::array<std::pair<const char*, juce::String>, 5> readouts { {
        { "M", formatLufs (loudness.getMomentaryLUFS()) },
        { "S", formatLufs (loudness.getShortTermLUFS()) },
        { "I", formatLufs (loudness.getIntegratedLUFS()) },
        { "LRA", juce::String (loudness.getLoudnessRangeLU(), 1) },
        { "TP", formatLufs (loudness.getTruePeakDb()) },
    } };

    auto cells = loudnessArea.reduced (0, 8);
    const int cellWidth = cells.getWidth() / (int) readouts.size();
    for (const auto& [label, value] : readouts)
    {
        auto cell = cells.removeFromLeft (cellWidth);
        g.setFont (uiFont (9.0f, true));
        g.setColour (juce::Colour (0x80ffffff));
        g.drawText (label, cell.removeFromLeft (26), juce::Justification::centredRight);
        g.setFont (uiFont (12.0f, true));
        g.setColour (juce::Colours::white);
        g.drawText (value, cell.withTrimmedLeft (4), juce::Justification::centredLeft);
    }

    // Track identity pill (name / colour come from the DAW when the host reports them)
    const auto colour = audioProcessor.getTrackColour();
    juce::Rectangle<float> trackPill ((float) (bounds.getRight() - 180), (float) (bounds.getY() + 10), 160.0f, 24.0f);
    g.setColour (colour.withAlpha (0.2f));
    g.fillRoundedRectangle (trackPill, 12.0f);
    g.setColour (colour);
    g.drawRoundedRectangle (trackPill, 12.0f, 1.0f);
    g.setFont (uiFont (11.0f, true));
    g.drawText (audioProcessor.getTrackName(), trackPill.toNearestInt(), juce::Justification::centred);
}

void LiquidSpectraAudioProcessorEditor::paintFrequencyGrid (juce::Graphics& g, juce::Rectangle<float> b)
{
    static const float freqs[] = { 30, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 16000 };
    static const char* labels[] = { "30", "50", "100", "250", "500", "1k", "2k", "5k", "10k", "16k" };

    g.setFont (uiFont (10.0f));
    for (size_t i = 0; i < std::size (freqs); ++i)
    {
        const float x = freqToX (freqs[i], b);
        g.setColour (juce::Colour (0x15ffffff));
        g.drawVerticalLine ((int) x, b.getY(), b.getBottom());

        g.setColour (juce::Colour (0x60ffffff));
        g.drawText (labels[i], (int) x - 18, (int) b.getBottom() - 16, 36, 14, juce::Justification::centred);
    }

    static const float dBs[] = { -72.0f, -60.0f, -48.0f, -36.0f, -24.0f, -12.0f, 0.0f };
    for (float db : dBs)
    {
        const float y = dbToY (db, b);
        g.setColour (db == 0.0f ? juce::Colour (0x35ef4444) : juce::Colour (0x12ffffff));
        g.drawHorizontalLine ((int) y, b.getX(), b.getRight());

        g.setColour (juce::Colour (0x50ffffff));
        g.drawText (juce::String ((int) db) + " dB", (int) b.getX() + 6, (int) y - 12, 45, 12, juce::Justification::left);
    }
}

void LiquidSpectraAudioProcessorEditor::paintCollisionRegions (juce::Graphics& g, juce::Rectangle<float> b)
{
    const int myId = audioProcessor.getInstanceId();

    for (const auto& c : collisions)
    {
        if (c.trackAId != myId && c.trackBId != myId)
            continue;

        const int band = c.criticalBandIndex;
        const float x1 = freqToX (barkBandEdgesHz[(size_t) band], b);
        const float x2 = freqToX (barkBandEdgesHz[(size_t) band + 1], b);

        g.setColour (juce::Colour (0xffff0055).withAlpha (0.08f + 0.22f * c.maskingSeverity));
        g.fillRect (juce::Rectangle<float> (x1, b.getY(), juce::jmax (2.0f, x2 - x1), b.getHeight()));

        const auto& other = c.trackAId == myId ? c.trackBName : c.trackAName;
        g.setColour (juce::Colour (0xffff0055));
        g.setFont (uiFont (9.0f, true));
        g.drawFittedText ("CLASH " + juce::String (juce::roundToInt (c.maskingSeverity * 100.0f)) + "%\n" + juce::String (other),
                          juce::Rectangle<float> (x1, b.getY() + 8, juce::jmax (40.0f, x2 - x1), 26.0f).toNearestInt(),
                          juce::Justification::centredTop, 2);
    }
}

void LiquidSpectraAudioProcessorEditor::paintOtherTracks (juce::Graphics& g, juce::Rectangle<float> b)
{
    const auto& centres = barkBandCentresHz();
    const int myId = audioProcessor.getInstanceId();

    for (int t = 0; t < numBusTracks; ++t)
    {
        const auto& track = busTracks[(size_t) t];
        if (track.instanceId == myId)
            continue;

        juce::Path curve;
        for (int band = 0; band < BARK_BANDS_COUNT; ++band)
        {
            const juce::Point<float> pt { freqToX (centres[(size_t) band], b), dbToY (track.barkMagnitudes[band], b) };
            if (band == 0)
                curve.startNewSubPath (pt);
            else
                curve.lineTo (pt);
        }

        g.setColour (juce::Colour (track.colourArgb).withAlpha (0.7f));
        g.strokePath (curve, juce::PathStrokeType (1.4f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
    }
}

void LiquidSpectraAudioProcessorEditor::paintSpectrumCurve (juce::Graphics& g, juce::Rectangle<float> b)
{
    // One point per ~2 px: maximum of the FFT bins that fall under each step (keeps harmonics crisp)
    const double sampleRate = audioProcessor.getSpectralAnalyzer().getSampleRate();
    const float binHz = (float) sampleRate / (float) SpectralAnalyzerDSP::FFT_SIZE;
    const int steps = juce::jmax (2, (int) (b.getWidth() / 2.0f));
    const float logSpan = std::log10 (MAX_FREQ / MIN_FREQ);

    juce::Path curve;
    for (int s = 0; s <= steps; ++s)
    {
        const float f1 = MIN_FREQ * std::pow (10.0f, logSpan * (float) s / (float) steps);
        const float f2 = MIN_FREQ * std::pow (10.0f, logSpan * (float) (s + 1) / (float) steps);
        const int bin1 = juce::jlimit (1, SpectralAnalyzerDSP::NUM_BINS - 1, (int) std::floor (f1 / binHz));
        const int bin2 = juce::jlimit (bin1, SpectralAnalyzerDSP::NUM_BINS - 1, (int) std::floor (f2 / binHz));

        float level = SpectralAnalyzerDSP::FLOOR_DB;
        for (int bin = bin1; bin <= bin2; ++bin)
            level = juce::jmax (level, spectrumDb[(size_t) bin]);

        const juce::Point<float> pt { freqToX (f1, b), dbToY (level, b) };
        if (s == 0)
            curve.startNewSubPath (pt);
        else
            curve.lineTo (pt);
    }

    juce::Path fillPath (curve);
    fillPath.lineTo (b.getRight(), b.getBottom());
    fillPath.lineTo (b.getX(), b.getBottom());
    fillPath.closeSubPath();

    const auto colour = audioProcessor.getTrackColour();
    g.setGradientFill (juce::ColourGradient (colour.withAlpha (0.32f), b.getCentreX(), b.getY(),
                                             colour.withAlpha (0.01f), b.getCentreX(), b.getBottom(), false));
    g.fillPath (fillPath);

    g.setColour (colour);
    g.strokePath (curve, juce::PathStrokeType (2.0f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));
}

void LiquidSpectraAudioProcessorEditor::paintMasterOutputMeter (juce::Graphics& g, juce::Rectangle<int> bounds)
{
    g.setColour (juce::Colour (0xff0d1017));
    g.fillRect (bounds);
    g.setColour (juce::Colour (0x20ffffff));
    g.drawVerticalLine (bounds.getX(), (float) bounds.getY(), (float) bounds.getBottom());

    // Clip indicator (latched on true peak > 0 dBTP, click to reset)
    g.setColour (clipLatched ? juce::Colour (0xffff2244) : juce::Colour (0x30331111));
    g.fillRoundedRectangle (clipBox.toFloat(), 4.0f);
    g.setColour (clipLatched ? juce::Colours::white : juce::Colour (0x60ffffff));
    g.setFont (uiFont (9.0f, true));
    g.drawText ("CLIP", clipBox, juce::Justification::centred);

    auto barArea = bounds.withTrimmedTop (clipBox.getBottom() - bounds.getY() + 10).reduced (14, 0).withTrimmedBottom (30);
    const int barWidth = (barArea.getWidth() - 4) / 2;

    auto heightFor = [] (float db, int maxH)
    {
        const float norm = (juce::jlimit (METER_MIN_DB, 0.0f, db) - METER_MIN_DB) / -METER_MIN_DB;
        return (int) (norm * (float) maxH);
    };

    for (int ch = 0; ch < 2; ++ch)
    {
        const juce::Rectangle<int> bar (barArea.getX() + ch * (barWidth + 4), barArea.getY(), barWidth, barArea.getHeight());
        g.setColour (juce::Colour (0xff05070a));
        g.fillRect (bar);

        const int h = heightFor (meterDb[(size_t) ch], bar.getHeight());
        g.setGradientFill (juce::ColourGradient (juce::Colour (0xffff3355), 0.0f, (float) bar.getY(),
                                                 juce::Colour (0xff10b981), 0.0f, (float) bar.getBottom(), false));
        g.fillRect (bar.getX(), bar.getBottom() - h, bar.getWidth(), h);

        g.setColour (juce::Colours::white);
        g.drawHorizontalLine (bar.getBottom() - heightFor (peakHoldDb[(size_t) ch], bar.getHeight()),
                              (float) bar.getX(), (float) bar.getRight());
    }

    g.setFont (uiFont (10.0f, true));
    g.setColour (juce::Colour (0xff38bdf8));
    const float maxHold = juce::jmax (peakHoldDb[0], peakHoldDb[1]);
    g.drawText (maxHold <= -89.5f ? juce::String ("-inf") : juce::String (maxHold, 1) + " dBTP",
                bounds.getX(), bounds.getBottom() - 26, bounds.getWidth(), 20, juce::Justification::centred);
}

void LiquidSpectraAudioProcessorEditor::mouseDown (const juce::MouseEvent& e)
{
    if (clipBox.contains (e.getPosition()))
    {
        clipLatched = false;
        peakHoldDb = { -90.0f, -90.0f };
        repaint();
    }
}

void LiquidSpectraAudioProcessorEditor::mouseDoubleClick (const juce::MouseEvent& e)
{
    if (loudnessArea.contains (e.getPosition()))
    {
        audioProcessor.getLoudnessMeter().requestReset();
        clipLatched = false;
        peakHoldDb = { -90.0f, -90.0f };
    }
}

} // namespace LiquidAudio
