#pragma once

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>
#include "BarkScale.h"
#include "MultiInstanceBus.h"

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

/** Cross-track masking detection over critical-band spectra. GUI / message thread only (allocates). */
class CollisionDetector
{
public:
    static constexpr float ACTIVITY_FLOOR_DB = -55.0f;

    /** Overlap coefficient C = 2·A·B / (A² + B²) on a compressed amplitude proxy (1 at equal levels). */
    static float overlapCoefficient (float dbA, float dbB) noexcept
    {
        const float ampA = std::pow (10.0f, (dbA + 60.0f) / 40.0f);
        const float ampB = std::pow (10.0f, (dbB + 60.0f) / 40.0f);
        return (2.0f * ampA * ampB) / (ampA * ampA + ampB * ampB);
    }

    static std::vector<CollisionResult> analyzeCollisions (const TrackSnapshot* tracks, int numTracks, float clashThreshold = 0.40f)
    {
        std::vector<CollisionResult> collisions;
        if (tracks == nullptr || numTracks < 2)
            return collisions;

        const auto& centres = barkBandCentresHz();

        for (int i = 0; i < numTracks; ++i)
        {
            for (int j = i + 1; j < numTracks; ++j)
            {
                const auto& tA = tracks[i];
                const auto& tB = tracks[j];

                for (int b = 0; b < BARK_BANDS_COUNT; ++b)
                {
                    const float magA = tA.barkMagnitudes[b];
                    const float magB = tB.barkMagnitudes[b];
                    if (magA <= ACTIVITY_FLOOR_DB || magB <= ACTIVITY_FLOOR_DB)
                        continue;

                    const float overlap = overlapCoefficient (magA, magB);
                    if (overlap <= clashThreshold)
                        continue;

                    CollisionResult res;
                    res.trackAId = tA.instanceId;
                    res.trackBId = tB.instanceId;
                    res.trackAName = tA.name;
                    res.trackBName = tB.name;
                    res.criticalBandIndex = b;
                    res.centerFrequencyHz = centres[(size_t) b];
                    res.maskingSeverity = std::min (0.99f, overlap);
                    res.recommendedCutGainDb = -2.5f - overlap * 4.5f;
                    res.recommendedQ = (b < 4) ? 2.6f : 1.8f;
                    collisions.push_back (std::move (res));
                }
            }
        }
        return collisions;
    }
};

} // namespace LiquidAudio
