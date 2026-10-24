#include "PluginEditor.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>

namespace LiquidAudio {

namespace
{
    constexpr float MIN_FREQ = 20.0f;
    constexpr float MAX_FREQ = 20000.0f;
    constexpr float MAX_DB = 6.0f;
    constexpr float GRID_STEP_DB = 12.0f;
    constexpr float METER_MIN_DB = -60.0f;
    constexpr float SONOGRAM_SENSITIVITY_DB = -80.0f;
    constexpr float PEAK_HOLD_DECAY_DB = 0.6f; // per timer frame
    constexpr float LUFS_VIEW_MIN = -60.0f;
    constexpr float LUFS_VIEW_MAX = 0.0f;
    constexpr float INV_SQRT2 = 0.70710678f;
    constexpr int TIMER_HZ = 60;
    constexpr int PEAK_HOLD_FRAMES = TIMER_HZ * 3 / 2; // 1.5 s
    constexpr int HEADER_HEIGHT = 44;
    constexpr int MODE_BAR_HEIGHT = 30;
    constexpr int CONTROLS_HEIGHT = 34;
    constexpr int METER_WIDTH = 72;
    constexpr int TRACK_PILL_WIDTH = 160;
    constexpr int TRACK_PILL_HEIGHT = 24;
    constexpr int TRACK_SWATCH_WIDTH = 24;
    constexpr int TRACK_NAME_MAX_LENGTH = 31; // TRACK_NAME_CAPACITY - 1 in MultiInstanceBus
    constexpr int SONOGRAM_COLUMNS = 512;
    constexpr int SONOGRAM_ROWS = 256;
    constexpr int STEREO_WINDOW = 1024;       // samples used for the goniometer and the stats

    constexpr std::array<float, 3> floorChoicesDb { -60.0f, -90.0f, -120.0f };
    constexpr std::array<float, 3> clashChoices { 0.25f, 0.40f, 0.55f };
    constexpr std::array<float, 3> targetChoicesLufs { -14.0f, -16.0f, -23.0f };
    constexpr std::array<float, 4> timebaseMs { 5.0f, 20.0f, 50.0f, 200.0f };
    constexpr std::array<float, 3> scopeGains { 1.0f, 2.0f, 4.0f };
    constexpr std::array<float, 3> persistFades { 1.0f, 0.22f, 0.07f }; // 1 = no persistence
    constexpr std::array<std::uint32_t, 8> trackPalette {
        0xff06b6d4, 0xffa855f7, 0xfff59e0b, 0xff10b981,
        0xffef4444, 0xffec4899, 0xff3b82f6, 0xffe2e8f0
    };

    juce::Font uiFont (float height, bool bold = false)
    {
        return juce::Font (juce::FontOptions (height, bold ? juce::Font::bold : juce::Font::plain));
    }

    juce::String formatLufs (float value)
    {
        return value <= LoudnessMeterEBU::SILENCE_DB + 0.5f ? juce::String ("-inf") : juce::String (value, 1);
    }

    juce::String formatHz (float hz)
    {
        return hz >= 1000.0f ? juce::String (hz / 1000.0f, 1) + " kHz" : juce::String (juce::roundToInt (hz)) + " Hz";
    }

    float toDb (double power)
    {
        return (float) (10.0 * std::log10 (std::max (power, 1.0e-9)));
    }

    template <size_t N>
    int nearestIndex (const std::array<float, N>& choices, float value)
    {
        int best = 0;
        for (int i = 1; i < (int) N; ++i)
            if (std::abs (choices[(size_t) i] - value) < std::abs (choices[(size_t) best] - value))
                best = i;
        return best;
    }

    void styleButton (juce::TextButton& button)
    {
        button.setColour (juce::TextButton::buttonColourId, juce::Colour (0xff1a202c));
        button.setColour (juce::TextButton::buttonOnColourId, juce::Colour (0xff0e7490));
        button.setColour (juce::TextButton::textColourOffId, juce::Colour (0xffcbd5e1));
        button.setColour (juce::TextButton::textColourOnId, juce::Colours::white);
    }

    void styleCombo (juce::ComboBox& box)
    {
        box.setColour (juce::ComboBox::backgroundColourId, juce::Colour (0xff1a202c));
        box.setColour (juce::ComboBox::textColourId, juce::Colour (0xffcbd5e1));
        box.setColour (juce::ComboBox::outlineColourId, juce::Colour (0x40ffffff));
        box.setColour (juce::ComboBox::arrowColourId, juce::Colour (0xff06b6d4));
    }

    // Sonogram colour ramp: deep navy -> track colour -> white
    juce::Colour sonogramColour (float norm, juce::Colour accent)
    {
        const juce::Colour base (0xff050810);
        if (norm <= 0.0f)
            return base;
        if (norm < 0.6f)
            return base.interpolatedWith (accent, norm / 0.6f);
        return accent.interpolatedWith (juce::Colours::white, (norm - 0.6f) / 0.4f);
    }
}

LiquidSpectraAudioProcessorEditor::LiquidSpectraAudioProcessorEditor (LiquidSpectraAudioProcessor& p)
    : AudioProcessorEditor (&p), audioProcessor (p)
{
    spectrumDb.fill (SpectralAnalyzerDSP::FLOOR_DB);
    peakSpectrumDb.fill (SpectralAnalyzerDSP::FLOOR_DB);
    displayFloorDb = p.getDisplayFloorDb();
    sonogramImage = juce::Image (juce::Image::ARGB, SONOGRAM_COLUMNS, SONOGRAM_ROWS, true);
    scratchLeft.resize (StereoSampleRing::CAPACITY, 0.0f);
    scratchRight.resize (StereoSampleRing::CAPACITY, 0.0f);

    // Mode bar -----------------------------------------------------------
    const std::array<const char*, 6> modeLabels { "Spectrum", "Sonogram", "Collisions", "Loudness", "Stereo", "Scope" };
    for (size_t i = 0; i < modeButtons.size(); ++i)
    {
        auto& button = modeButtons[i];
        button.setButtonText (modeLabels[i]);
        button.setRadioGroupId (1);
        button.setClickingTogglesState (true);
        styleButton (button);
        button.onClick = [this, i] { setViewMode ((ViewMode) i); };
        addAndMakeVisible (button);
    }

    // Controls -----------------------------------------------------------
    styleButton (freezeButton);
    styleButton (overlayButton);
    styleButton (peakButton);
    freezeButton.setClickingTogglesState (true);
    overlayButton.setClickingTogglesState (true);
    peakButton.setClickingTogglesState (true);
    overlayButton.setToggleState (p.getShowOverlay(), juce::dontSendNotification);
    overlayButton.onClick = [this]
    {
        audioProcessor.setShowOverlay (overlayButton.getToggleState());
        repaint();
    };

    styleCombo (floorBox);
    floorBox.addItem ("Floor -60 dB", 1);
    floorBox.addItem ("Floor -90 dB", 2);
    floorBox.addItem ("Floor -120 dB", 3);
    floorBox.setSelectedId (nearestIndex (floorChoicesDb, p.getDisplayFloorDb()) + 1, juce::dontSendNotification);
    floorBox.onChange = [this]
    {
        const int index = floorBox.getSelectedItemIndex();
        if (index >= 0)
            audioProcessor.setDisplayFloorDb (floorChoicesDb[(size_t) index]);
    };

    styleCombo (clashBox);
    clashBox.addItem ("Clash 25%", 1);
    clashBox.addItem ("Clash 40%", 2);
    clashBox.addItem ("Clash 55%", 3);
    clashBox.setSelectedId (nearestIndex (clashChoices, p.getClashThreshold()) + 1, juce::dontSendNotification);
    clashBox.onChange = [this]
    {
        const int index = clashBox.getSelectedItemIndex();
        if (index >= 0)
            audioProcessor.setClashThreshold (clashChoices[(size_t) index]);
    };

    styleCombo (targetBox);
    targetBox.addItem ("Target -14 LUFS", 1);
    targetBox.addItem ("Target -16 LUFS", 2);
    targetBox.addItem ("Target -23 LUFS (EBU)", 3);
    targetBox.setSelectedId (3, juce::dontSendNotification);

    styleCombo (timebaseBox);
    timebaseBox.addItem ("Time 5 ms", 1);
    timebaseBox.addItem ("Time 20 ms", 2);
    timebaseBox.addItem ("Time 50 ms", 3);
    timebaseBox.addItem ("Time 200 ms", 4);
    timebaseBox.setSelectedId (2, juce::dontSendNotification);

    styleCombo (gainBox);
    gainBox.addItem ("Gain 1x", 1);
    gainBox.addItem ("Gain 2x", 2);
    gainBox.addItem ("Gain 4x", 3);
    gainBox.setSelectedId (2, juce::dontSendNotification);

    styleCombo (persistBox);
    persistBox.addItem ("Persist Off", 1);
    persistBox.addItem ("Persist Short", 2);
    persistBox.addItem ("Persist Long", 3);
    persistBox.setSelectedId (2, juce::dontSendNotification);

    // Track name editor: hidden until the user double-clicks the name
    nameEditor.setFont (uiFont (11.0f, true));
    nameEditor.setInputRestrictions (TRACK_NAME_MAX_LENGTH);
    nameEditor.setMultiLine (false);
    nameEditor.setColour (juce::TextEditor::backgroundColourId, juce::Colour (0xff121620));
    nameEditor.setColour (juce::TextEditor::textColourId, juce::Colours::white);
    nameEditor.setColour (juce::TextEditor::outlineColourId, p.getTrackColour());
    nameEditor.setColour (juce::TextEditor::focusedOutlineColourId, p.getTrackColour());
    nameEditor.onReturnKey = [this] { commitRename(); };
    nameEditor.onFocusLost = [this] { commitRename(); };
    nameEditor.onEscapeKey = [this]
    {
        nameEditor.setVisible (false);
        repaint();
    };

    addAndMakeVisible (freezeButton);
    addAndMakeVisible (overlayButton);
    addAndMakeVisible (peakButton);
    addAndMakeVisible (floorBox);
    addAndMakeVisible (clashBox);
    addAndMakeVisible (targetBox);
    addAndMakeVisible (timebaseBox);
    addAndMakeVisible (gainBox);
    addAndMakeVisible (persistBox);
    addChildComponent (nameEditor);

    setResizable (true, true);
    setResizeLimits (740, 480, 2560, 1440);
    setSize (980, 600);

    setViewMode (ViewMode::spectrum);
    startTimerHz (TIMER_HZ);
}

LiquidSpectraAudioProcessorEditor::~LiquidSpectraAudioProcessorEditor()
{
    stopTimer();
}

void LiquidSpectraAudioProcessorEditor::setViewMode (ViewMode mode)
{
    viewMode = mode;
    modeButtons[(size_t) mode].setToggleState (true, juce::dontSendNotification);

    // Start the phosphor from black so the previous view does not bleed through
    if (! scopeImage.isNull())
        scopeImage.clear (scopeImage.getBounds(), juce::Colour (0xff05080c));

    updateControlVisibility();
    resized();
    repaint();
}

void LiquidSpectraAudioProcessorEditor::updateControlVisibility()
{
    const bool spectrumLike = viewMode == ViewMode::spectrum || viewMode == ViewMode::sonogram;
    const bool scopeLike = viewMode == ViewMode::stereo || viewMode == ViewMode::oscilloscope;

    freezeButton.setVisible (spectrumLike || scopeLike);
    overlayButton.setVisible (viewMode == ViewMode::spectrum);
    peakButton.setVisible (viewMode == ViewMode::spectrum);
    floorBox.setVisible (spectrumLike);
    clashBox.setVisible (viewMode == ViewMode::spectrum || viewMode == ViewMode::collisions);
    targetBox.setVisible (viewMode == ViewMode::loudness);
    timebaseBox.setVisible (viewMode == ViewMode::oscilloscope);
    gainBox.setVisible (viewMode == ViewMode::oscilloscope);
    persistBox.setVisible (scopeLike);
}

void LiquidSpectraAudioProcessorEditor::resized()
{
    auto area = getLocalBounds();
    headerArea = area.removeFromTop (HEADER_HEIGHT);
    meterArea = area.removeFromRight (METER_WIDTH);
    modeBarArea = area.removeFromTop (MODE_BAR_HEIGHT);

    // Controls sit under the view only; the meter column runs the full height
    controlsArea = area.removeFromBottom (CONTROLS_HEIGHT).reduced (8, 4);
    spectrumArea = area.toFloat().reduced (4.0f);

    auto modes = modeBarArea.reduced (8, 3);
    for (auto& button : modeButtons)
    {
        button.setBounds (modes.removeFromLeft (96));
        modes.removeFromLeft (4);
    }

    // Lay out only the controls that belong to the current view
    auto controls = controlsArea;
    auto place = [&controls] (juce::Component& component, int width)
    {
        if (component.isVisible())
        {
            component.setBounds (controls.removeFromLeft (width));
            controls.removeFromLeft (6);
        }
        else
        {
            component.setBounds ({});
        }
    };
    place (freezeButton, 74);
    place (overlayButton, 84);
    place (peakButton, 66);
    place (floorBox, 120);
    place (clashBox, 120);
    place (targetBox, 190);
    place (timebaseBox, 120);
    place (gainBox, 100);
    place (persistBox, 130);

    clipBox = { meterArea.getX() + 12, meterArea.getY() + 8, meterArea.getWidth() - 24, 16 };
    loudnessArea = headerArea.withTrimmedLeft (250).withTrimmedRight (190);

    auto pill = juce::Rectangle<int> (headerArea.getRight() - 180, headerArea.getY() + 10, TRACK_PILL_WIDTH, TRACK_PILL_HEIGHT);
    trackSwatchArea = pill.removeFromLeft (TRACK_SWATCH_WIDTH);
    trackNameArea = pill;
    nameEditor.setBounds (trackNameArea.reduced (2, 1));

    // Phosphor image follows the view size
    const auto viewBounds = spectrumArea.toNearestInt();
    const int w = juce::jmax (1, viewBounds.getWidth());
    const int h = juce::jmax (1, viewBounds.getHeight());
    if (scopeImage.getWidth() != w || scopeImage.getHeight() != h)
    {
        scopeImage = juce::Image (juce::Image::RGB, w, h, true);
        scopeImage.clear (scopeImage.getBounds(), juce::Colour (0xff05080c));
    }
}

void LiquidSpectraAudioProcessorEditor::timerCallback()
{
    // Keep the controls in step with settings that may have changed under us (preset load, state restore)
    const int floorId = nearestIndex (floorChoicesDb, audioProcessor.getDisplayFloorDb()) + 1;
    if (floorBox.getSelectedId() != floorId)
        floorBox.setSelectedId (floorId, juce::dontSendNotification);
    const int clashId = nearestIndex (clashChoices, audioProcessor.getClashThreshold()) + 1;
    if (clashBox.getSelectedId() != clashId)
        clashBox.setSelectedId (clashId, juce::dontSendNotification);
    if (overlayButton.getToggleState() != audioProcessor.getShowOverlay())
        overlayButton.setToggleState (audioProcessor.getShowOverlay(), juce::dontSendNotification);
    displayFloorDb = audioProcessor.getDisplayFloorDb();

    const auto& loudness = audioProcessor.getLoudnessMeter();

    // Loudness history keeps running while the spectrum is frozen
    momentaryHistory[(size_t) loudnessWrite] = loudness.getMomentaryLUFS();
    shortTermHistory[(size_t) loudnessWrite] = loudness.getShortTermLUFS();
    loudnessWrite = (loudnessWrite + 1) % LOUDNESS_HISTORY;

    // Analysis is paused while frozen; meters keep running
    if (! freezeButton.getToggleState())
    {
        // 1. Spectrum of this instance (consistent copy via the analyser's sequence lock)
        audioProcessor.getSpectralAnalyzer().readSpectrum (spectrumDb);
        updatePeakHold();
        pushSonogramColumn();

        // 2. Every instance on the shared bus, then cross-track masking for this one
        numBusTracks = LiquidSpectraAudioProcessor::getSharedBus().snapshot (busTracks);
        collisions = CollisionDetector::analyzeCollisions (busTracks.data(), numBusTracks, audioProcessor.getClashThreshold());

        // 3. Waveform and stereo phosphor for the scope views
        if (viewMode == ViewMode::stereo || viewMode == ViewMode::oscilloscope)
            renderScopeFrame();
    }

    // 4. Per-channel true-peak meters with peak hold and clip latch
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
            hold = juce::jmax (LoudnessMeterEBU::SILENCE_DB, hold - 0.4f);
        }

        if (target > 0.0f)
            clipLatched = true;
    }

    repaint();
}

void LiquidSpectraAudioProcessorEditor::updatePeakHold()
{
    for (size_t bin = 0; bin < peakSpectrumDb.size(); ++bin)
        peakSpectrumDb[bin] = juce::jmax (spectrumDb[bin], peakSpectrumDb[bin] - PEAK_HOLD_DECAY_DB);
}

void LiquidSpectraAudioProcessorEditor::pushSonogramColumn()
{
    const juce::Colour accent = audioProcessor.getTrackColour();
    const double sampleRate = audioProcessor.getSpectralAnalyzer().getSampleRate();
    const float binHz = (float) sampleRate / (float) SpectralAnalyzerDSP::FFT_SIZE;

    juce::Image::BitmapData data (sonogramImage, juce::Image::BitmapData::readWrite);

    // Scroll everything one column to the left (memmove per row, no per-pixel work)
    for (int y = 0; y < SONOGRAM_ROWS; ++y)
    {
        auto* line = data.getLinePointer (y);
        std::memmove (line, line + data.pixelStride, (size_t) (data.pixelStride * (SONOGRAM_COLUMNS - 1)));
    }

    // Newest column on the right; image row 0 is the top (highest frequency)
    for (int y = 0; y < SONOGRAM_ROWS; ++y)
    {
        const float t = 1.0f - (float) y / (float) (SONOGRAM_ROWS - 1);
        const float freq = MIN_FREQ * std::pow (MAX_FREQ / MIN_FREQ, t);
        const int bin = juce::jlimit (1, SpectralAnalyzerDSP::NUM_BINS - 1, juce::roundToInt (freq / binHz));
        const float norm = juce::jlimit (0.0f, 1.0f, (spectrumDb[(size_t) bin] - SONOGRAM_SENSITIVITY_DB) / -SONOGRAM_SENSITIVITY_DB);
        data.setPixelColour (SONOGRAM_COLUMNS - 1, y, sonogramColour (norm, accent));
    }
}

void LiquidSpectraAudioProcessorEditor::renderScopeFrame()
{
    const double sampleRate = audioProcessor.getSpectralAnalyzer().getSampleRate();
    if (sampleRate <= 0.0 || scopeImage.isNull())
        return;

    const bool isScope = viewMode == ViewMode::oscilloscope;
    const int timebaseIndex = juce::jmax (0, timebaseBox.getSelectedItemIndex());
    const int window = isScope
        ? juce::jlimit (64, StereoSampleRing::CAPACITY / 2, juce::roundToInt (timebaseMs[(size_t) timebaseIndex] * (float) sampleRate / 1000.0f))
        : STEREO_WINDOW;
    // The scope looks back half a window further so the trigger has room to find a rising edge
    const int span = isScope ? juce::jmin (window + window / 2, StereoSampleRing::CAPACITY) : window;

    if (! audioProcessor.getSampleRing().readNewest (scratchLeft.data(), scratchRight.data(), span))
        return; // the audio thread overran the copy: keep the previous frame

    const int persistence = juce::jmax (0, persistBox.getSelectedItemIndex());
    const float fade = persistFades[(size_t) persistence];
    const auto accent = audioProcessor.getTrackColour();
    const auto secondary = juce::Colour (0xff34d399);

    const int width = scopeImage.getWidth();
    const int height = scopeImage.getHeight();
    juce::Graphics g (scopeImage);

    // Phosphor: fade the previous frame toward the background, then draw on top
    g.setColour (juce::Colour (0xff05080c).withAlpha (fade));
    g.fillAll();

    const float gain = scopeGains[(size_t) juce::jmax (0, gainBox.getSelectedItemIndex())];

    if (isScope)
    {
        // Graticule: 10 x 8 divisions with a centre line
        g.setColour (juce::Colour (0x14ffffff));
        for (int i = 1; i < 10; ++i)
            g.drawVerticalLine (juce::roundToInt ((float) width * (float) i / 10.0f), 0.0f, (float) height);
        for (int i = 1; i < 8; ++i)
            g.drawHorizontalLine (juce::roundToInt ((float) height * (float) i / 8.0f), 0.0f, (float) width);
        g.setColour (juce::Colour (0x30ffffff));
        g.drawHorizontalLine (height / 2, 0.0f, (float) width);

        // Rising zero-crossing of the left channel in the first half of the span; otherwise roll
        int start = span - window;
        for (int i = 1; i < span - window; ++i)
        {
            if (scratchLeft[(size_t) i - 1] < 0.0f && scratchLeft[(size_t) i] >= 0.0f)
            {
                start = i;
                break;
            }
        }

        // Min/max envelope per pixel column keeps dense waveforms readable at long timebases
        const float samplesPerColumn = (float) window / (float) width;
        const float halfHeight = (float) height * 0.5f * 0.92f;
        auto yOf = [&] (float v) { return (float) height * 0.5f - v * gain * halfHeight; };

        juce::Path leftPath;
        juce::Path rightPath;
        for (int col = 0; col < width; ++col)
        {
            const int from = juce::jmin (start + juce::roundToInt ((float) col * samplesPerColumn), start + window - 1);
            const int to = juce::jmin (start + window, juce::jmax (from + 1, start + juce::roundToInt ((float) (col + 1) * samplesPerColumn)));

            float lMin = scratchLeft[(size_t) from], lMax = lMin;
            float rMin = scratchRight[(size_t) from], rMax = rMin;
            for (int i = from; i < to; ++i)
            {
                const float l = scratchLeft[(size_t) i];
                const float r = scratchRight[(size_t) i];
                lMin = juce::jmin (lMin, l);
                lMax = juce::jmax (lMax, l);
                rMin = juce::jmin (rMin, r);
                rMax = juce::jmax (rMax, r);
            }

            const float x = (float) col + 0.5f;
            if (col == 0)
            {
                leftPath.startNewSubPath (x, yOf (lMin));
                rightPath.startNewSubPath (x, yOf (rMin));
            }
            else
            {
                leftPath.lineTo (x, yOf (lMin));
                rightPath.lineTo (x, yOf (rMin));
            }
            leftPath.lineTo (x, yOf (lMax));
            rightPath.lineTo (x, yOf (rMax));
        }

        // Glow pass under a crisp core line
        g.setColour (accent.withAlpha (0.22f));
        g.strokePath (leftPath, juce::PathStrokeType (4.0f));
        g.setColour (secondary.withAlpha (0.22f));
        g.strokePath (rightPath, juce::PathStrokeType (4.0f));
        g.setColour (accent);
        g.strokePath (leftPath, juce::PathStrokeType (1.2f));
        g.setColour (secondary);
        g.strokePath (rightPath, juce::PathStrokeType (1.2f));
    }
    else
    {
        // Goniometer: L-R on the x axis, L+R on the y axis (mono sits on the vertical)
        const float side = (float) juce::jmax (60, juce::jmin (height - 24, width - 200));
        const float left = 16.0f;
        const float top = ((float) height - side) * 0.5f;
        const float cx = left + side * 0.5f;
        const float cy = top + side * 0.5f;
        const float half = side * 0.5f * 0.92f;

        g.setColour (juce::Colour (0x14ffffff));
        g.drawEllipse (left, top, side, side, 1.0f);
        g.drawLine (cx, top, cx, top + side, 1.0f);
        g.drawLine (left, cy, left + side, cy, 1.0f);
        g.setColour (juce::Colour (0x0cffffff));
        g.drawLine (left, top, left + side, top + side, 1.0f);
        g.drawLine (left, top + side, left + side, top, 1.0f);

        double sLL = 0.0, sRR = 0.0, sLR = 0.0, sMid = 0.0, sSide = 0.0;
        for (int i = 0; i < span; ++i)
        {
            const float l = scratchLeft[(size_t) i];
            const float r = scratchRight[(size_t) i];

            sLL += (double) l * l;
            sRR += (double) r * r;
            sLR += (double) l * r;
            const double mid = (l + r) * INV_SQRT2;
            const double side2 = (l - r) * INV_SQRT2;
            sMid += mid * mid;
            sSide += side2 * side2;

            const float x = cx + (l - r) * INV_SQRT2 * half * gain;
            const float y = cy - (l + r) * INV_SQRT2 * half * gain;
            g.setColour (accent.withAlpha (0.7f));
            g.fillRect (juce::Rectangle<float> (x - 0.75f, y - 0.75f, 1.5f, 1.5f));
        }

        const double denom = std::sqrt (sLL * sRR);
        stereoStats.correlation = denom > 1.0e-12 ? (float) (sLR / denom) : 0.0f;
        stereoStats.midDb = toDb (sMid / span);
        stereoStats.sideDb = toDb (sSide / span);
    }
}

float LiquidSpectraAudioProcessorEditor::freqToX (float freqHz, juce::Rectangle<float> b) const noexcept
{
    const float norm = std::log10 (juce::jlimit (MIN_FREQ, MAX_FREQ, freqHz) / MIN_FREQ) / std::log10 (MAX_FREQ / MIN_FREQ);
    return b.getX() + norm * b.getWidth();
}

float LiquidSpectraAudioProcessorEditor::freqToY (float freqHz, juce::Rectangle<float> b) const noexcept
{
    const float norm = std::log10 (juce::jlimit (MIN_FREQ, MAX_FREQ, freqHz) / MIN_FREQ) / std::log10 (MAX_FREQ / MIN_FREQ);
    return b.getBottom() - norm * b.getHeight();
}

float LiquidSpectraAudioProcessorEditor::dbToY (float db, juce::Rectangle<float> b) const noexcept
{
    const float norm = (juce::jlimit (displayFloorDb, MAX_DB, db) - displayFloorDb) / (MAX_DB - displayFloorDb);
    return b.getBottom() - norm * b.getHeight();
}

float LiquidSpectraAudioProcessorEditor::lufsToY (float lufs, juce::Rectangle<float> b) const noexcept
{
    const float norm = (juce::jlimit (LUFS_VIEW_MIN, LUFS_VIEW_MAX, lufs) - LUFS_VIEW_MIN) / (LUFS_VIEW_MAX - LUFS_VIEW_MIN);
    return b.getBottom() - norm * b.getHeight();
}

void LiquidSpectraAudioProcessorEditor::paint (juce::Graphics& g)
{
    g.fillAll (juce::Colour (0xff090b10));

    paintHeader (g, headerArea);

    g.setColour (juce::Colour (0xff0c0f15));
    g.fillRect (modeBarArea);

    switch (viewMode)
    {
        case ViewMode::spectrum:     paintSpectrumView (g, spectrumArea); break;
        case ViewMode::sonogram:     paintSonogramView (g, spectrumArea); break;
        case ViewMode::collisions:   paintCollisionsView (g, spectrumArea); break;
        case ViewMode::loudness:     paintLoudnessView (g, spectrumArea); break;
        case ViewMode::stereo:       paintStereoView (g, spectrumArea); break;
        case ViewMode::oscilloscope: paintOscilloscopeView (g, spectrumArea); break;
    }

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

    // EBU R128 readouts
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

    // Track identity pill: swatch (click to cycle colour) + name (double-click to rename)
    const auto colour = audioProcessor.getTrackColour();
    const auto pill = trackSwatchArea.getUnion (trackNameArea).toFloat();
    g.setColour (colour.withAlpha (0.2f));
    g.fillRoundedRectangle (pill, 12.0f);
    g.setColour (colour);
    g.drawRoundedRectangle (pill, 12.0f, 1.0f);
    g.fillEllipse (trackSwatchArea.toFloat().withSizeKeepingCentre (10.0f, 10.0f));

    if (! nameEditor.isVisible())
    {
        g.setFont (uiFont (11.0f, true));
        g.setColour (colour);
        g.drawText (audioProcessor.getTrackName(), trackNameArea, juce::Justification::centredLeft);
    }
}

void LiquidSpectraAudioProcessorEditor::paintFrozenBadge (juce::Graphics& g, juce::Rectangle<float> b)
{
    if (! freezeButton.getToggleState())
        return;

    g.setColour (juce::Colour (0xff38bdf8));
    g.setFont (uiFont (9.0f, true));
    auto badge = b.toNearestInt().removeFromTop (16);
    g.drawText ("FROZEN", badge.removeFromRight (80), juce::Justification::centredRight);
}

void LiquidSpectraAudioProcessorEditor::paintSpectrumView (juce::Graphics& g, juce::Rectangle<float> b)
{
    paintFrequencyGrid (g, b);
    paintLevelGrid (g, b);
    paintCollisionRegions (g, b);
    paintOtherTracks (g, b);
    if (peakButton.getToggleState())
        paintPeakHold (g, b);
    paintSpectrumCurve (g, b);
    paintFrozenBadge (g, b);
}

void LiquidSpectraAudioProcessorEditor::paintSonogramView (juce::Graphics& g, juce::Rectangle<float> b)
{
    // Image spans the view; frequency axis labels run down the left edge
    const auto target = b.toNearestInt();
    g.drawImage (sonogramImage, target.getX(), target.getY(), target.getWidth(), target.getHeight(), 0, 0, SONOGRAM_COLUMNS, SONOGRAM_ROWS, false);

    static const float freqs[] = { 30, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 16000 };
    static const char* labels[] = { "30", "50", "100", "250", "500", "1k", "2k", "5k", "10k", "16k" };

    g.setFont (uiFont (10.0f));
    for (size_t i = 0; i < std::size (freqs); ++i)
    {
        const float y = freqToY (freqs[i], b);
        g.setColour (juce::Colour (0x20ffffff));
        g.drawHorizontalLine ((int) y, b.getX(), b.getRight());
        g.setColour (juce::Colour (0x90ffffff));
        g.drawText (labels[i], (int) b.getX() + 4, (int) y - 7, 40, 14, juce::Justification::left);
    }

    paintFrozenBadge (g, b);
}

void LiquidSpectraAudioProcessorEditor::paintCollisionsView (juce::Graphics& g, juce::Rectangle<float> b)
{
    auto area = b.reduced (12.0f, 8.0f);
    g.setFont (uiFont (9.0f, true));
    g.setColour (juce::Colour (0x80ffffff));
    g.drawText ("TRACK PAIR  \xc2\xb7  BAND  \xc2\xb7  RECOMMENDED CUT", area.removeFromTop (16.0f).toNearestInt(), juce::Justification::left);

    if (collisions.empty())
    {
        g.setColour (juce::Colour (0x80ffffff));
        g.setFont (uiFont (13.0f));
        g.drawText ("No clashes above " + juce::String (juce::roundToInt (audioProcessor.getClashThreshold() * 100.0f)) + "% threshold",
                    b.toNearestInt(), juce::Justification::centred);
        return;
    }

    // Strongest clashes first
    std::vector<const CollisionResult*> sorted;
    sorted.reserve (collisions.size());
    for (const auto& c : collisions)
        sorted.push_back (&c);
    std::sort (sorted.begin(), sorted.end(), [] (auto* a, auto* b2) { return a->maskingSeverity > b2->maskingSeverity; });

    const int myId = audioProcessor.getInstanceId();
    const float rowHeight = 44.0f;
    int row = 0;
    for (const auto* c : sorted)
    {
        const auto rowArea = area.withY (area.getY() + 20.0f + (float) row * rowHeight).withHeight (rowHeight - 6.0f);
        if (rowArea.getBottom() > b.getBottom())
            break;
        ++row;

        const bool involvesMe = c->trackAId == myId || c->trackBId == myId;
        g.setColour (juce::Colour (0xff121620));
        g.fillRoundedRectangle (rowArea, 6.0f);

        auto text = rowArea.reduced (10.0f, 4.0f);
        g.setColour (involvesMe ? juce::Colours::white : juce::Colour (0xffcbd5e1));
        g.setFont (uiFont (12.0f, true));
        g.drawText (juce::String (c->trackAName) + "  vs  " + juce::String (c->trackBName),
                    text.removeFromTop (18.0f).removeFromLeft (360.0f), juce::Justification::centredLeft);

        g.setFont (uiFont (10.0f));
        g.setColour (juce::Colour (0x90ffffff));
        g.drawText ("Band " + juce::String (c->criticalBandIndex + 1) + " \xc2\xb7 " + formatHz (c->centerFrequencyHz)
                        + "  \xc2\xb7  cut " + juce::String (c->recommendedCutGainDb, 1) + " dB  Q " + juce::String (c->recommendedQ, 1),
                    text.removeFromBottom (14.0f), juce::Justification::centredLeft);

        // Severity bar on the right of the row
        auto bar = rowArea.reduced (10.0f, 0.0f).removeFromRight (150.0f).withSizeKeepingCentre (150.0f, 8.0f);
        g.setColour (juce::Colour (0xff05070a));
        g.fillRoundedRectangle (bar, 4.0f);
        g.setColour (juce::Colour (0xffff0055));
        g.fillRoundedRectangle (bar.withWidth (bar.getWidth() * juce::jlimit (0.0f, 1.0f, c->maskingSeverity)), 4.0f);
        g.setFont (uiFont (10.0f, true));
        g.setColour (juce::Colour (0xffff0055));
        g.drawText (juce::String (juce::roundToInt (c->maskingSeverity * 100.0f)) + "% CLASH",
                    bar.translated (0.0f, -14.0f).withHeight (12.0f), juce::Justification::centredRight);
    }
}

void LiquidSpectraAudioProcessorEditor::paintLoudnessView (juce::Graphics& g, juce::Rectangle<float> b)
{
    const auto plot = b.withTrimmedLeft (44.0f).reduced (8.0f, 16.0f);
    const float selectedTarget = targetChoicesLufs[(size_t) juce::jmax (0, targetBox.getSelectedItemIndex())];

    // Grid, 10 LU steps
    g.setFont (uiFont (10.0f));
    for (float lufs = LUFS_VIEW_MIN; lufs <= LUFS_VIEW_MAX; lufs += 10.0f)
    {
        const float y = lufsToY (lufs, plot);
        g.setColour (juce::Colour (0x12ffffff));
        g.drawHorizontalLine ((int) y, plot.getX(), plot.getRight());
        g.setColour (juce::Colour (0x60ffffff));
        g.drawText (juce::String ((int) lufs), (int) b.getX() + 4, (int) y - 7, 34, 14, juce::Justification::right);
    }

    // Selected target band (+/- 1 LU) and the reference line
    const float bandTop = lufsToY (selectedTarget + 1.0f, plot);
    const float bandBottom = lufsToY (selectedTarget - 1.0f, plot);
    g.setColour (juce::Colour (0x18f59e0b));
    g.fillRect (juce::Rectangle<float> (plot.getX(), bandTop, plot.getWidth(), bandBottom - bandTop));
    g.setColour (juce::Colour (0x80f59e0b));
    g.drawHorizontalLine ((int) lufsToY (selectedTarget, plot), plot.getX(), plot.getRight());

    // History: momentary (faint) and short-term (accent), oldest on the left
    const auto accent = audioProcessor.getTrackColour();
    auto historyPath = [this, &plot] (const std::array<float, LOUDNESS_HISTORY>& values)
    {
        juce::Path path;
        for (int i = 0; i < LOUDNESS_HISTORY; ++i)
        {
            const int idx = (loudnessWrite + i) % LOUDNESS_HISTORY;
            const float x = plot.getX() + plot.getWidth() * (float) i / (float) (LOUDNESS_HISTORY - 1);
            const juce::Point<float> pt { x, lufsToY (values[(size_t) idx], plot) };
            if (i == 0)
                path.startNewSubPath (pt);
            else
                path.lineTo (pt);
        }
        return path;
    };

    g.setColour (juce::Colour (0x50ffffff));
    g.strokePath (historyPath (momentaryHistory), juce::PathStrokeType (1.0f));
    g.setColour (accent);
    g.strokePath (historyPath (shortTermHistory), juce::PathStrokeType (2.0f, juce::PathStrokeType::curved, juce::PathStrokeType::rounded));

    // Integrated loudness as a horizontal reference
    const float integrated = audioProcessor.getLoudnessMeter().getIntegratedLUFS();
    if (integrated > LoudnessMeterEBU::SILENCE_DB + 0.5f)
    {
        g.setColour (juce::Colour (0xff10b981));
        g.drawHorizontalLine ((int) lufsToY (integrated, plot), plot.getX(), plot.getRight());
    }

    g.setFont (uiFont (9.0f, true));
    g.setColour (juce::Colour (0x80ffffff));
    auto legend = plot.toNearestInt().removeFromTop (14);
    g.drawText ("S (short-term)", legend.removeFromRight (120), juce::Justification::centredRight);
}

void LiquidSpectraAudioProcessorEditor::paintStereoView (juce::Graphics& g, juce::Rectangle<float> b)
{
    const auto target = b.toNearestInt();
    g.drawImage (scopeImage, target.getX(), target.getY(), target.getWidth(), target.getHeight(), 0, 0, scopeImage.getWidth(), scopeImage.getHeight(), false);

    // Stats panel on the right: correlation bar plus mid and side levels
    auto panel = b.removeFromRight (180.0f).reduced (14.0f, 16.0f);

    g.setFont (uiFont (9.0f, true));
    g.setColour (juce::Colour (0x80ffffff));
    g.drawText ("CORRELATION", panel.removeFromTop (14.0f), juce::Justification::left);

    auto bar = panel.removeFromTop (10.0f);
    g.setColour (juce::Colour (0xff05070a));
    g.fillRoundedRectangle (bar, 4.0f);
    const float centre = bar.getCentreX();
    const float tip = centre + stereoStats.correlation * bar.getWidth() * 0.5f;
    g.setColour (stereoStats.correlation >= 0.0f ? juce::Colour (0xff10b981) : juce::Colour (0xffff3355));
    g.fillRoundedRectangle (juce::Rectangle<float> (juce::jmin (centre, tip), bar.getY(), std::abs (tip - centre), bar.getHeight()), 4.0f);

    g.setColour (juce::Colours::white);
    g.setFont (uiFont (18.0f, true));
    g.drawText (juce::String (stereoStats.correlation, 2), panel.removeFromTop (28.0f), juce::Justification::left);

    panel.removeFromTop (12.0f);
    g.setFont (uiFont (9.0f, true));
    g.setColour (juce::Colour (0x80ffffff));
    g.drawText ("MID", panel.removeFromTop (14.0f), juce::Justification::left);
    g.setFont (uiFont (14.0f, true));
    g.setColour (juce::Colours::white);
    g.drawText (juce::String (stereoStats.midDb, 1) + " dB", panel.removeFromTop (20.0f), juce::Justification::left);

    panel.removeFromTop (8.0f);
    g.setFont (uiFont (9.0f, true));
    g.setColour (juce::Colour (0x80ffffff));
    g.drawText ("SIDE", panel.removeFromTop (14.0f), juce::Justification::left);
    g.setFont (uiFont (14.0f, true));
    g.setColour (juce::Colours::white);
    g.drawText (juce::String (stereoStats.sideDb, 1) + " dB", panel.removeFromTop (20.0f), juce::Justification::left);

    paintFrozenBadge (g, b);
}

void LiquidSpectraAudioProcessorEditor::paintOscilloscopeView (juce::Graphics& g, juce::Rectangle<float> b)
{
    const auto target = b.toNearestInt();
    g.drawImage (scopeImage, target.getX(), target.getY(), target.getWidth(), target.getHeight(), 0, 0, scopeImage.getWidth(), scopeImage.getHeight(), false);

    g.setFont (uiFont (9.0f, true));
    g.setColour (juce::Colour (0x80ffffff));
    g.drawText (timebaseBox.getText() + "  \xc2\xb7  " + gainBox.getText(), b.toNearestInt().removeFromBottom (16).removeFromLeft (240),
                juce::Justification::left);

    paintFrozenBadge (g, b);
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
}

void LiquidSpectraAudioProcessorEditor::paintLevelGrid (juce::Graphics& g, juce::Rectangle<float> b)
{
    // dB grid follows the selected floor
    g.setFont (uiFont (10.0f));
    for (float db = 0.0f; db >= displayFloorDb; db -= GRID_STEP_DB)
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
    if (! overlayButton.getToggleState())
        return;

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

juce::Path LiquidSpectraAudioProcessorEditor::buildSpectrumCurve (const std::array<float, SpectralAnalyzerDSP::NUM_BINS>& data, juce::Rectangle<float> b) const
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
            level = juce::jmax (level, data[(size_t) bin]);

        const juce::Point<float> pt { freqToX (f1, b), dbToY (level, b) };
        if (s == 0)
            curve.startNewSubPath (pt);
        else
            curve.lineTo (pt);
    }
    return curve;
}

void LiquidSpectraAudioProcessorEditor::paintPeakHold (juce::Graphics& g, juce::Rectangle<float> b)
{
    g.setColour (juce::Colour (0x90ffffff));
    g.strokePath (buildSpectrumCurve (peakSpectrumDb, b), juce::PathStrokeType (1.0f));
}

void LiquidSpectraAudioProcessorEditor::paintSpectrumCurve (juce::Graphics& g, juce::Rectangle<float> b)
{
    const auto curve = buildSpectrumCurve (spectrumDb, b);

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
    g.drawText (maxHold <= LoudnessMeterEBU::SILENCE_DB + 0.5f ? juce::String ("-inf") : juce::String (maxHold, 1) + " dBTP",
                bounds.getX(), bounds.getBottom() - 26, bounds.getWidth(), 20, juce::Justification::centred);
}

void LiquidSpectraAudioProcessorEditor::beginRename()
{
    nameEditor.setText (audioProcessor.getTrackName(), false);
    nameEditor.setColour (juce::TextEditor::outlineColourId, audioProcessor.getTrackColour());
    nameEditor.setColour (juce::TextEditor::focusedOutlineColourId, audioProcessor.getTrackColour());
    nameEditor.setVisible (true);
    nameEditor.grabKeyboardFocus();
    nameEditor.selectAll();
    repaint();
}

void LiquidSpectraAudioProcessorEditor::commitRename()
{
    // Return, focus loss and Escape can all fire for one edit: only the first one that finds the editor open applies
    if (! nameEditor.isVisible())
        return;

    const auto name = nameEditor.getText().trim();
    if (name.isNotEmpty())
        audioProcessor.setTrackName (name);

    nameEditor.setVisible (false);
    repaint();
}

void LiquidSpectraAudioProcessorEditor::cycleTrackColour()
{
    const auto current = audioProcessor.getTrackColour().getARGB();

    size_t next = 0;
    for (size_t i = 0; i < trackPalette.size(); ++i)
        if (trackPalette[i] == current)
            next = (i + 1) % trackPalette.size();

    audioProcessor.setTrackColour (juce::Colour (trackPalette[next]));
    repaint();
}

void LiquidSpectraAudioProcessorEditor::mouseDown (const juce::MouseEvent& e)
{
    if (clipBox.contains (e.getPosition()))
    {
        clipLatched = false;
        peakHoldDb = { LoudnessMeterEBU::SILENCE_DB, LoudnessMeterEBU::SILENCE_DB };
        repaint();
    }
    else if (trackSwatchArea.contains (e.getPosition()))
    {
        cycleTrackColour();
    }
}

void LiquidSpectraAudioProcessorEditor::mouseDoubleClick (const juce::MouseEvent& e)
{
    if (loudnessArea.contains (e.getPosition()))
    {
        audioProcessor.getLoudnessMeter().requestReset();
        clipLatched = false;
        peakHoldDb = { LoudnessMeterEBU::SILENCE_DB, LoudnessMeterEBU::SILENCE_DB };
    }
    else if (trackNameArea.contains (e.getPosition()))
    {
        beginRename();
    }
}

} // namespace LiquidAudio
