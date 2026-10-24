#pragma once

#include <atomic>
#include <array>
#include <cstdint>

namespace LiquidAudio {

/**
 * Lock-free stereo history for the Oscilloscope and Stereo views.
 *
 * The audio thread is the only writer. The GUI copies the newest frames and rejects the copy if the
 * writer wrapped over the oldest of them while it was reading, so no lock is ever taken on the audio thread.
 * Every sample is an atomic, so reading while writing is well-defined (at worst a rejected copy).
 */
class StereoSampleRing
{
public:
    static constexpr int CAPACITY = 1 << 17; // ~2.7 s at 48 kHz

    void push (const float* left, const float* right, int numSamples) noexcept
    {
        const auto start = writeIndex.load (std::memory_order_relaxed);
        for (int i = 0; i < numSamples; ++i)
        {
            const auto slot = static_cast<size_t> ((start + i) & (CAPACITY - 1));
            leftSamples[slot].store (left[i], std::memory_order_relaxed);
            rightSamples[slot].store (right[i], std::memory_order_relaxed);
        }
        writeIndex.store (start + numSamples, std::memory_order_release);
    }

    /** Copies the newest `count` frames, oldest first. Returns false if the copy may have been overwritten. */
    bool readNewest (float* outLeft, float* outRight, int count) const noexcept
    {
        const auto end = writeIndex.load (std::memory_order_acquire);
        const auto first = end - count;

        for (int i = 0; i < count; ++i)
        {
            const auto slot = static_cast<size_t> ((first + i) & (CAPACITY - 1));
            outLeft[i] = leftSamples[slot].load (std::memory_order_relaxed);
            outRight[i] = rightSamples[slot].load (std::memory_order_relaxed);
        }

        return writeIndex.load (std::memory_order_acquire) - first <= CAPACITY;
    }

private:
    std::atomic<std::int64_t> writeIndex { 0 };
    std::array<std::atomic<float>, CAPACITY> leftSamples {};
    std::array<std::atomic<float>, CAPACITY> rightSamples {};
};

} // namespace LiquidAudio
