#pragma once

#include <array>
#include <atomic>
#include <vector>
#include <cstring>
#include <juce_core/juce_core.h>

namespace LiquidAudio {

constexpr int MAX_SIMULTANEOUS_TRACKS = 32;
constexpr int BARK_BANDS_COUNT = 24;

struct TrackSpectrumFrame {
    int instanceId { -1 };
    char name[32] { 0 };
    uint32_t colourArgb { 0 };
    float barkMagnitudes[BARK_BANDS_COUNT] { 0 };
    std::atomic<uint64_t> sequenceNumber { 0 };
};

class MultiInstanceBus
{
public:
    MultiInstanceBus() = default;

    int registerInstance(void* processorPtr)
    {
        for (int i = 0; i < MAX_SIMULTANEOUS_TRACKS; ++i)
        {
            void* expected = nullptr;
            if (activeSlots[i].compare_exchange_strong(expected, processorPtr))
            {
                frames[i].instanceId = i;
                return i;
            }
        }
        return -1;
    }

    void unregisterInstance(int instanceId)
    {
        if (instanceId >= 0 && instanceId < MAX_SIMULTANEOUS_TRACKS)
        {
            activeSlots[instanceId].store(nullptr);
            frames[instanceId].instanceId = -1;
        }
    }

    void publishSpectrum(int slotIndex, const juce::String& trackName, juce::Colour col, const float* barkData, int numBands)
    {
        if (slotIndex < 0 || slotIndex >= MAX_SIMULTANEOUS_TRACKS) return;

        auto& frame = frames[slotIndex];
        std::strncpy(frame.name, trackName.toRawUTF8(), sizeof(frame.name) - 1);
        frame.colourArgb = col.getARGB();

        const int copyCount = std::min(numBands, BARK_BANDS_COUNT);
        for (int b = 0; b < copyCount; ++b)
        {
            frame.barkMagnitudes[b] = barkData[b];
        }

        frame.sequenceNumber.fetch_add(1, std::memory_order_release);
    }

    std::vector<TrackSpectrumFrame> snapshotActiveTracks() const
    {
        std::vector<TrackSpectrumFrame> result;
        result.reserve(MAX_SIMULTANEOUS_TRACKS);

        for (int i = 0; i < MAX_SIMULTANEOUS_TRACKS; ++i)
        {
            if (activeSlots[i].load() != nullptr && frames[i].instanceId >= 0)
            {
                result.push_back(frames[i]);
            }
        }
        return result;
    }

private:
    std::array<std::atomic<void*>, MAX_SIMULTANEOUS_TRACKS> activeSlots { nullptr };
    std::array<TrackSpectrumFrame, MAX_SIMULTANEOUS_TRACKS> frames;
};

} // namespace LiquidAudio
