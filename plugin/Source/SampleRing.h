#pragma once

#include <atomic>
#include <array>
#include <cstdint>

namespace LiquidAudio {

/**
 * Lock-free stereo history.
 *
 * The audio thread is the only writer. The reader copies the newest frames and rejects the copy if the
 * writer wrapped over the oldest of them while it was reading, so no lock is ever taken on the audio thread.
 * Every sample is an atomic, so reading while writing is well-defined (at worst a rejected copy).
 */
template <std::size_t Capacity>
class StereoSampleRingT
{
    static_assert ((Capacity & (Capacity - 1)) == 0, "Capacity must be a power of two");

public:
    static constexpr std::size_t CAPACITY = Capacity;

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

    /** Total frames pushed so far (absolute index of the next frame). */
    std::int64_t written() const noexcept { return writeIndex.load (std::memory_order_acquire); }

    /**
     * Copies the newest `count` frames, oldest first. `endOut` receives the absolute index one past the
     * newest copied frame. Returns false if the copy may have been overwritten while it was read.
     */
    bool readNewest (float* outLeft, float* outRight, int count, std::int64_t& endOut) const noexcept
    {
        const auto end = writeIndex.load (std::memory_order_acquire);
        const auto first = end - count;
        endOut = end;

        for (int i = 0; i < count; ++i)
        {
            const auto slot = static_cast<size_t> ((first + i) & (CAPACITY - 1));
            outLeft[i] = leftSamples[slot].load (std::memory_order_relaxed);
            outRight[i] = rightSamples[slot].load (std::memory_order_relaxed);
        }

        return writeIndex.load (std::memory_order_acquire) - first <= (std::int64_t) CAPACITY;
    }

private:
    std::atomic<std::int64_t> writeIndex { 0 };
    std::array<std::atomic<float>, CAPACITY> leftSamples {};
    std::array<std::atomic<float>, CAPACITY> rightSamples {};
};

/** Per-instance history used by the processor's own analysis (about 2.7 s at 48 kHz). */
using StereoSampleRing = StereoSampleRingT<(1 << 17)>;

/** Per-slot history kept in the shared bus (about 0.7 s at 48 kHz; the web UI keeps its own longer history). */
using BusWaveformRing = StereoSampleRingT<(1 << 15)>;

} // namespace LiquidAudio
