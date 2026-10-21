#pragma once

#include <array>
#include <cmath>

namespace LiquidAudio {

constexpr int BARK_BANDS_COUNT = 24;

// 24 critical-band edges in Hz (Zwicker & Fastl), first band starts at 20 Hz
inline constexpr std::array<float, BARK_BANDS_COUNT + 1> barkBandEdgesHz {
    20.0f,   100.0f,  200.0f,  300.0f,  400.0f,  510.0f,  630.0f,  770.0f,
    920.0f,  1080.0f, 1270.0f, 1480.0f, 1720.0f, 2000.0f, 2320.0f, 2700.0f,
    3150.0f, 3700.0f, 4400.0f, 5300.0f, 6400.0f, 7700.0f, 9500.0f, 12000.0f,
    15500.0f
};

/** Geometric centre of each critical band (where a band's value is drawn / reported). */
inline const std::array<float, BARK_BANDS_COUNT>& barkBandCentresHz() noexcept
{
    static const auto centres = []
    {
        std::array<float, BARK_BANDS_COUNT> c {};
        for (int b = 0; b < BARK_BANDS_COUNT; ++b)
            c[(size_t) b] = std::sqrt (barkBandEdgesHz[(size_t) b] * barkBandEdgesHz[(size_t) b + 1]);
        return c;
    }();
    return centres;
}

} // namespace LiquidAudio
