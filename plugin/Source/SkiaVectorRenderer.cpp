#include "SkiaVectorRenderer.h"
#include <algorithm>

namespace LiquidSpectra {

float SkiaVectorRenderer::freqToPixelX(float freqHz, float startX, float width) noexcept {
    const float minF = 20.0f;
    const float maxF = 20000.0f;
    const float norm = std::log10(std::clamp(freqHz, minF, maxF) / minF) / std::log10(maxF / minF);
    return startX + norm * width;
}

float SkiaVectorRenderer::pixelXToFreq(float pixelX, float startX, float width) noexcept {
    const float minF = 20.0f;
    const float maxF = 20000.0f;
    const float norm = std::clamp((pixelX - startX) / width, 0.0f, 1.0f);
    return minF * std::pow(maxF / minF, norm);
}

float SkiaVectorRenderer::dbToPixelY(float db, float topY, float height) noexcept {
    const float minDb = -90.0f;
    const float maxDb = 12.0f;
    const float norm = (std::clamp(db, minDb, maxDb) - minDb) / (maxDb - minDb);
    return (topY + height) - norm * height;
}

float SkiaVectorRenderer::pixelYToDb(float pixelY, float topY, float height) noexcept {
    const float minDb = -90.0f;
    const float maxDb = 12.0f;
    const float norm = std::clamp(1.0f - ((pixelY - topY) / height), 0.0f, 1.0f);
    return minDb + norm * (maxDb - minDb);
}

// Steffen Monotone Cubic Spline Algorithm (No overshoot in audio spectrum curves)
void SkiaVectorRenderer::buildMonotoneCubicSpline(SkPath& path, const std::vector<SkPoint>& pts) {
    const size_t n = pts.size();
    if (n < 2) return;

    std::vector<float> h(n - 1);
    std::vector<float> delta(n - 1);
    for (size_t i = 0; i < n - 1; ++i) {
        h[i] = pts[i + 1].fX - pts[i].fX;
        delta[i] = (h[i] > 1e-5f) ? ((pts[i + 1].fY - pts[i].fY) / h[i]) : 0.0f;
    }

    std::vector<float> d(n, 0.0f);
    d[0] = delta[0];
    d[n - 1] = delta[n - 2];

    for (size_t i = 1; i < n - 1; ++i) {
        if (delta[i - 1] * delta[i] <= 0.0f) {
            d[i] = 0.0f;
        } else {
            float p = (delta[i - 1] * h[i] + delta[i] * h[i - 1]) / (h[i - 1] + h[i]);
            float s = (delta[i - 1] > 0.0f) ? 1.0f : -1.0f;
            d[i] = s * std::min({ std::abs(p), 2.0f * std::abs(delta[i - 1]), 2.0f * std::abs(delta[i]) });
        }
    }

    path.moveTo(pts[0].fX, pts[0].fY);
    for (size_t i = 0; i < n - 1; ++i) {
        const float dx = pts[i + 1].fX - pts[i].fX;
        const SkPoint c1 = SkPoint::Make(pts[i].fX + dx / 3.0f, pts[i].fY + (d[i] * dx) / 3.0f);
        const SkPoint c2 = SkPoint::Make(pts[i + 1].fX - dx / 3.0f, pts[i + 1].fY - (d[i + 1] * dx) / 3.0f);
        path.cubicTo(c1.fX, c1.fY, c2.fX, c2.fY, pts[i + 1].fX, pts[i + 1].fY);
    }
}

void SkiaVectorRenderer::renderFrame(
    SkCanvas* canvas,
    int width,
    int height,
    const std::vector<float>& mainSpectrumDb,
    const std::vector<float>& sidechainSpectrumDb,
    const std::vector<FloatingNode>& floatingNodes,
    float masterVolume,
    float peakL, float peakR,
    bool isClip
) {
    // 1. Deep OLED Obsidian Background
    SkPaint bgPaint;
    bgPaint.setColor(SkColorSetRGB(8, 10, 15));
    canvas->drawRect(SkRect::MakeWH(width, height), bgPaint);

    const float meterWidth = 64.0f;
    const float headerHeight = 44.0f;
    const float specX = 0.0f;
    const float specY = headerHeight;
    const float specW = width - meterWidth;
    const float specH = height - headerHeight;

    // 2. Frequency Grid & Amplitude Scale
    drawGridAndScales(canvas, specX, specY, specW, specH);

    // 3. Sidechain / Collision spectrum (if present)
    if (!sidechainSpectrumDb.empty()) {
        std::vector<SkPoint> scPoints;
        scPoints.reserve(sidechainSpectrumDb.size());
        for (size_t i = 0; i < sidechainSpectrumDb.size(); ++i) {
            float f = 20.0f * std::pow(1000.0f, (float)i / (float)sidechainSpectrumDb.size());
            scPoints.push_back(SkPoint::Make(freqToPixelX(f, specX, specW), dbToPixelY(sidechainSpectrumDb[i], specY, specH)));
        }
        drawSpectrumLayer(canvas, scPoints, SkColorSetARGB(180, 244, 63, 94), specY + specH);
    }

    // 4. Main Track Vector Spectrum Curve with Neon Glow & Liquid Fill
    if (!mainSpectrumDb.empty()) {
        std::vector<SkPoint> mainPoints;
        mainPoints.reserve(mainSpectrumDb.size());
        for (size_t i = 0; i < mainSpectrumDb.size(); ++i) {
            float f = 20.0f * std::pow(1000.0f, (float)i / (float)mainSpectrumDb.size());
            mainPoints.push_back(SkPoint::Make(freqToPixelX(f, specX, specW), dbToPixelY(mainSpectrumDb[i], specY, specH)));
        }
        drawSpectrumLayer(canvas, mainPoints, SkColorSetRGB(34, 211, 238), specY + specH);
    }

    // 5. Interactive Floating Nodes (FabFilter tactile physics)
    drawFloatingNodes(canvas, floatingNodes, specX, specY, specW, specH);

    // 6. Right-Edge Master Meter Strip
    drawMasterMeterStrip(canvas, specW, 0.0f, meterWidth, height, masterVolume, peakL, peakR, isClip);
}

void SkiaVectorRenderer::drawSpectrumLayer(SkCanvas* canvas, const std::vector<SkPoint>& points, SkColor neonColor, float bottomY) {
    if (points.size() < 2) return;

    SkPath curvePath;
    buildMonotoneCubicSpline(curvePath, points);

    // Liquid gradient fill beneath curve
    SkPath fillPath = curvePath;
    fillPath.lineTo(points.back().fX, bottomY);
    fillPath.lineTo(points.front().fX, bottomY);
    fillPath.close();

    SkPoint gradPts[2] = { SkPoint::Make(0, bottomY - 300), SkPoint::Make(0, bottomY) };
    SkColor gradColors[2] = { SkColorSetA(neonColor, 55), SkColorSetA(neonColor, 0) };
    sk_sp<SkShader> fillShader = SkGradientShader::MakeLinear(gradPts, gradColors, nullptr, 2, SkTileMode::kClamp);

    SkPaint fillPaint;
    fillPaint.setShader(fillShader);
    fillPaint.setAntiAlias(true);
    canvas->drawPath(fillPath, fillPaint);

    // Outer neon bloom stroke
    SkPaint glowPaint;
    glowPaint.setColor(SkColorSetA(neonColor, 90));
    glowPaint.setStrokeWidth(4.5f);
    glowPaint.setStyle(SkPaint::kStroke_Style);
    glowPaint.setMaskFilter(SkMaskFilter::MakeBlur(kSolid_SkBlurStyle, 2.5f));
    glowPaint.setAntiAlias(true);
    canvas->drawPath(curvePath, glowPaint);

    // Crisp vector core stroke
    SkPaint corePaint;
    corePaint.setColor(neonColor);
    corePaint.setStrokeWidth(2.0f);
    corePaint.setStyle(SkPaint::kStroke_Style);
    corePaint.setAntiAlias(true);
    canvas->drawPath(curvePath, corePaint);
}

void SkiaVectorRenderer::drawGridAndScales(SkCanvas* canvas, float x, float y, float w, float h) {
    SkPaint gridPaint;
    gridPaint.setColor(SkColorSetARGB(18, 255, 255, 255));
    gridPaint.setStrokeWidth(1.0f);

    static const float freqs[] = { 30, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 16000 };
    for (float f : freqs) {
        float px = freqToPixelX(f, x, w);
        canvas->drawLine(px, y, px, y + h, gridPaint);
    }

    static const float dbs[] = { 0, -12, -24, -36, -60 };
    for (float db : dbs) {
        float py = dbToPixelY(db, y, h);
        canvas->drawLine(x, py, x + w, py, gridPaint);
    }
}

void SkiaVectorRenderer::drawFloatingNodes(SkCanvas* canvas, const std::vector<FloatingNode>& nodes, float x, float y, float w, float h) {
    for (const auto& node : nodes) {
        float px = freqToPixelX(node.freqHz, x, w);
        float py = dbToPixelY(node.gainDb, y, h);

        // Hover / Active Focus Halo
        if (node.isHovered || node.isDragging) {
            SkPaint haloPaint;
            haloPaint.setColor(SkColorSetA(node.color, 45));
            haloPaint.setStyle(SkPaint::kFill_Style);
            haloPaint.setAntiAlias(true);
            canvas->drawCircle(px, py, 14.0f, haloPaint);
        }

        // Inner solid core
        SkPaint corePaint;
        corePaint.setColor(node.color);
        corePaint.setStyle(SkPaint::kFill_Style);
        corePaint.setAntiAlias(true);
        canvas->drawCircle(px, py, 4.5f, corePaint);

        // White border ring
        SkPaint ringPaint;
        ringPaint.setColor(SK_ColorWHITE);
        ringPaint.setStrokeWidth(1.5f);
        ringPaint.setStyle(SkPaint::kStroke_Style);
        ringPaint.setAntiAlias(true);
        canvas->drawCircle(px, py, 4.5f, ringPaint);
    }
}

void SkiaVectorRenderer::drawMasterMeterStrip(SkCanvas* canvas, float x, float y, float w, float h, float vol, float pL, float pR, bool clip) {
    SkPaint stripBg;
    stripBg.setColor(SkColorSetRGB(12, 14, 20));
    canvas->drawRect(SkRect::MakeXYWH(x, y, w, h), stripBg);

    // Clip Indicator Box
    SkPaint clipPaint;
    clipPaint.setColor(clip ? SkColorSetRGB(255, 34, 68) : SkColorSetRGB(40, 20, 20));
    canvas->drawRoundRect(SkRect::MakeXYWH(x + 10, y + 8, w - 20, 16), 4, 4, clipPaint);

    // Meter Columns
    float barW = (w - 30) / 2.0f;
    float meterTop = y + 36.0f;
    float meterH = h - 80.0f;

    auto computeH = [&](float db) {
        float norm = (std::clamp(db, -60.0f, 0.0f) + 60.0f) / 60.0f;
        return norm * meterH;
    };

    float hL = computeH(pL);
    float hR = computeH(pR);

    SkPaint barPaint;
    barPaint.setColor(SkColorSetRGB(16, 185, 129));
    canvas->drawRect(SkRect::MakeXYWH(x + 12, meterTop + (meterH - hL), barW, hL), barPaint);
    canvas->drawRect(SkRect::MakeXYWH(x + 16 + barW, meterTop + (meterH - hR), barW, hR), barPaint);
}

} // namespace LiquidSpectra
