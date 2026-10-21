#pragma once

#include <include/core/SkCanvas.h>
#include <include/core/SkPath.h>
#include <include/core/SkPaint.h>
#include <include/core/SkColor.h>
#include <include/core/SkPoint.h>
#include <include/core/SkMaskFilter.h>
#include <include/effects/SkGradientShader.h>
#include <vector>
#include <string>
#include <cmath>

namespace LiquidSpectra {

// Interactive Floating Node (FabFilter Pro-Q style band handle)
struct FloatingNode {
    int id { 0 };
    float freqHz { 1000.0f };
    float gainDb { 0.0f };
    float qFactor { 1.414f };
    SkColor color { 0xFF22D3EE };
    bool isHovered { false };
    bool isDragging { false };
    bool isSoloed { false };
};

class SkiaVectorRenderer {
public:
    SkiaVectorRenderer() = default;

    // Main frame vector render pass (60-120 FPS GPU-accelerated)
    void renderFrame(
        SkCanvas* canvas,
        int width,
        int height,
        const std::vector<float>& mainSpectrumDb,
        const std::vector<float>& sidechainSpectrumDb,
        const std::vector<FloatingNode>& floatingNodes,
        float masterVolume,
        float peakL, float peakR,
        bool isClip
    );

    // Monotone Cubic Spline (Steffen / Fritsch-Carlson) without overshoot
    static void buildMonotoneCubicSpline(SkPath& path, const std::vector<SkPoint>& pts);

    // Coordinate space projections
    static float freqToPixelX(float freqHz, float startX, float width) noexcept;
    static float pixelXToFreq(float pixelX, float startX, float width) noexcept;
    static float dbToPixelY(float db, float topY, float height) noexcept;
    static float pixelYToDb(float pixelY, float topY, float height) noexcept;

private:
    void drawGridAndScales(SkCanvas* canvas, float x, float y, float w, float h);
    void drawSpectrumLayer(SkCanvas* canvas, const std::vector<SkPoint>& points, SkColor neonColor, float bottomY);
    void drawCollisionZones(SkCanvas* canvas, const std::vector<SkPoint>& ptsA, const std::vector<SkPoint>& ptsB, float bottomY);
    void drawFloatingNodes(SkCanvas* canvas, const std::vector<FloatingNode>& nodes, float x, float y, float w, float h);
    void drawMasterMeterStrip(SkCanvas* canvas, float x, float y, float w, float h, float vol, float pL, float pR, bool clip);
};

} // namespace LiquidSpectra
