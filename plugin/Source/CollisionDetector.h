#pragma once

#include "MultiInstanceBus.h"
#include <vector>
#include <string>

namespace LiquidAudio {

struct CollisionResult {
    int trackAId;
    int trackBId;
    std::string trackAName;
    std::string trackBName;
    int criticalBandIndex;
    float centerFrequencyHz;
    float maskingSeverity; // 0.0 to 1.0 (100%)
    float recommendedCutGainDb;
    float recommendedQ;
};

class CollisionDetector
{
public:
    static std::vector<CollisionResult> analyzeCollisions(const std::vector<TrackSpectrumFrame>& tracks, float clashThreshold = 0.40f)
    {
        std::vector<CollisionResult> collisions;
        if (tracks.size() < 2) return collisions;

        // Band center frequencies in Hz
        static const float bandCenters[BARK_BANDS_COUNT] = {
            50.0f, 150.0f, 250.0f, 350.0f, 450.0f, 570.0f, 700.0f, 840.0f,
            1000.0f, 1170.0f, 1370.0f, 1600.0f, 1850.0f, 2150.0f, 2500.0f,
            2900.0f, 3400.0f, 4000.0f, 4800.0f, 5800.0f, 7000.0f, 8500.0f,
            10500.0f, 13500.0f
        };

        for (size_t i = 0; i < tracks.size(); ++i)
        {
            for (size_t j = i + 1; j < tracks.size(); ++j)
            {
                const auto& tA = tracks[i];
                const auto& tB = tracks[j];

                for (int b = 0; b < BARK_BANDS_COUNT; ++b)
                {
                    float magA = tA.barkMagnitudes[b];
                    float magB = tB.barkMagnitudes[b];

                    if (magA > -55.0f && magB > -55.0f)
                    {
                        // Cross-spectral overlap coefficient
                        float ampA = std::pow(10.0f, (magA + 60.0f) / 40.0f);
                        float ampB = std::pow(10.0f, (magB + 60.0f) / 40.0f);
                        float overlap = (2.0f * ampA * ampB) / (ampA * ampA + ampB * ampB);

                        if (overlap > clashThreshold)
                        {
                            CollisionResult res;
                            res.trackAId = tA.instanceId;
                            res.trackBId = tB.instanceId;
                            res.trackAName = tA.name;
                            res.trackBName = tB.name;
                            res.criticalBandIndex = b;
                            res.centerFrequencyHz = bandCenters[b];
                            res.maskingSeverity = std::min(0.99f, overlap);

                            // Smart dynamic EQ recommendations
                            res.recommendedCutGainDb = -2.5f - (overlap * 4.5f);
                            res.recommendedQ = (b < 4) ? 2.6f : 1.8f;

                            collisions.push_back(res);
                        }
                    }
                }
            }
        }
        return collisions;
    }
};

} // namespace LiquidAudio
