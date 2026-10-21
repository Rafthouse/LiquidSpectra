#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <thread>

namespace LiquidAudio {

/**
 * Single-writer / multi-reader sequence lock over a fixed array.
 * The writer (typically the audio thread) never blocks or allocates; readers retry
 * while a write is in flight. Elements are relaxed atomics, so concurrent access is
 * free of data races in the C++ memory model.
 */
template <typename T, std::size_t N>
class SeqLockArray
{
public:
    static constexpr std::size_t size = N;

    SeqLockArray() noexcept
    {
        for (auto& v : values)
            v.store (T {}, std::memory_order_relaxed);
    }

    void write (const T* source, std::size_t count) noexcept
    {
        const auto s = sequence.load (std::memory_order_relaxed);
        sequence.store (s + 1, std::memory_order_relaxed);
        std::atomic_thread_fence (std::memory_order_release);

        const auto n = count < N ? count : N;
        for (std::size_t i = 0; i < n; ++i)
            values[i].store (source[i], std::memory_order_relaxed);

        sequence.store (s + 2, std::memory_order_release);
    }

    /** Copies a consistent snapshot; returns false only if a writer kept interfering. */
    bool read (T* destination, std::size_t count, int maxAttempts = 64) const noexcept
    {
        const auto n = count < N ? count : N;
        for (int attempt = 0; attempt < maxAttempts; ++attempt)
        {
            const auto before = sequence.load (std::memory_order_acquire);
            if ((before & 1u) != 0)
            {
                std::this_thread::yield();
                continue;
            }

            for (std::size_t i = 0; i < n; ++i)
                destination[i] = values[i].load (std::memory_order_relaxed);

            std::atomic_thread_fence (std::memory_order_acquire);
            if (sequence.load (std::memory_order_relaxed) == before)
                return true;
        }
        return false;
    }

    /** Even number that advances with every completed write (0 = never written). */
    std::uint32_t version() const noexcept { return sequence.load (std::memory_order_acquire) & ~1u; }

private:
    std::atomic<std::uint32_t> sequence { 0 };
    std::array<std::atomic<T>, N> values;
};

} // namespace LiquidAudio
