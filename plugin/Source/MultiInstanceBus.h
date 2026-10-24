#pragma once

#include <array>
#include <atomic>
#include <cstdint>

#include <algorithm>

#include "BarkScale.h"
#include "SampleRing.h"
#include "SeqLock.h"

namespace LiquidAudio {

constexpr int MAX_SIMULTANEOUS_TRACKS = 32;
constexpr int TRACK_NAME_CAPACITY = 32;
constexpr int BUS_SPECTRUM_BINS = 2048; // FFT 4096 / 2

/** Plain, copyable view of one instance's published state (built on the reader side). */
struct TrackSnapshot
{
    int instanceId { -1 };
    char name[TRACK_NAME_CAPACITY] {};
    std::uint32_t colourArgb { 0 };
    float barkMagnitudes[BARK_BANDS_COUNT] {};
};

/**
 * Process-wide bus through which plugin instances in the same host process share their
 * critical-band spectra.
 *  - publishSpectrum(): audio thread, lock-free and allocation-free (single writer per slot)
 *  - setTrackInfo():    message thread (single writer per slot, guarded by the caller)
 *  - snapshot():        any non-audio thread, retries instead of blocking writers
 * Note: hosts that sandbox plugins in separate processes will not share one bus.
 */
class MultiInstanceBus
{
public:
    MultiInstanceBus() = default;

    int registerInstance (void* owner) noexcept
    {
        for (int i = 0; i < MAX_SIMULTANEOUS_TRACKS; ++i)
        {
            void* expected = nullptr;
            if (slots[(size_t) i].owner.compare_exchange_strong (expected, owner, std::memory_order_acq_rel))
            {
                std::array<float, BARK_BANDS_COUNT> silence;
                silence.fill (-120.0f);
                slots[(size_t) i].bark.write (silence.data(), silence.size());

                std::array<float, BUS_SPECTRUM_BINS> silentSpectrum;
                silentSpectrum.fill (-120.0f);
                slots[(size_t) i].spectrum.write (silentSpectrum.data(), silentSpectrum.size());
                return i;
            }
        }
        return -1; // bus full: this instance analyses locally but is not shared
    }

    void unregisterInstance (int slotIndex) noexcept
    {
        if (isValid (slotIndex))
            slots[(size_t) slotIndex].owner.store (nullptr, std::memory_order_release);
    }

    void setTrackInfo (int slotIndex, const char* utf8Name, std::uint32_t colourArgb) noexcept
    {
        if (! isValid (slotIndex))
            return;

        // Bounded copy, always NUL-terminated (long names are truncated)
        char buffer[TRACK_NAME_CAPACITY] {};
        if (utf8Name != nullptr)
            for (int i = 0; i < TRACK_NAME_CAPACITY - 1 && utf8Name[i] != '\0'; ++i)
                buffer[i] = utf8Name[i];

        auto& slot = slots[(size_t) slotIndex];
        slot.name.write (buffer, TRACK_NAME_CAPACITY);
        slot.colourArgb.store (colourArgb, std::memory_order_relaxed);
    }

    void publishSpectrum (int slotIndex, const float* barkData, int numBands) noexcept
    {
        if (! isValid (slotIndex) || barkData == nullptr)
            return;

        slots[(size_t) slotIndex].bark.write (barkData, (std::size_t) (numBands < BARK_BANDS_COUNT ? numBands : BARK_BANDS_COUNT));
    }

    /** Full-resolution spectrum (dB) of one instance for the web UI. Single writer per slot (audio thread). */
    void publishFullSpectrum (int slotIndex, const float* spectrumDb, int numBins) noexcept
    {
        if (! isValid (slotIndex) || spectrumDb == nullptr)
            return;

        slots[(size_t) slotIndex].spectrum.write (spectrumDb, (std::size_t) std::min (numBins, BUS_SPECTRUM_BINS));
    }

    bool readFullSpectrum (int slotIndex, float* out, int numBins) const noexcept
    {
        if (! isValid (slotIndex) || out == nullptr)
            return false;

        return slots[(size_t) slotIndex].spectrum.read (out, (std::size_t) std::min (numBins, BUS_SPECTRUM_BINS));
    }

    /** Stereo samples of one instance (audio thread writes, any thread reads with readWaveform). */
    void pushWaveform (int slotIndex, const float* left, const float* right, int numSamples) noexcept
    {
        if (isValid (slotIndex) && left != nullptr && right != nullptr)
            slots[(size_t) slotIndex].waveform.push (left, right, numSamples);
    }

    bool readWaveform (int slotIndex, float* outLeft, float* outRight, int count, std::int64_t& endOut) const noexcept
    {
        if (! isValid (slotIndex) || count <= 0 || count > (int) BusWaveformRing::CAPACITY)
            return false;

        return slots[(size_t) slotIndex].waveform.readNewest (outLeft, outRight, count, endOut);
    }

    /** Fills `out` with every registered instance; returns how many were written. Never call from the audio thread. */
    int snapshot (std::array<TrackSnapshot, MAX_SIMULTANEOUS_TRACKS>& out) const noexcept
    {
        int count = 0;
        for (int i = 0; i < MAX_SIMULTANEOUS_TRACKS; ++i)
        {
            const auto& slot = slots[(size_t) i];
            if (slot.owner.load (std::memory_order_acquire) == nullptr)
                continue;

            auto& dst = out[(size_t) count];
            dst.instanceId = i;
            if (! slot.bark.read (dst.barkMagnitudes, BARK_BANDS_COUNT))
                continue;
            slot.name.read (dst.name, TRACK_NAME_CAPACITY);
            dst.name[TRACK_NAME_CAPACITY - 1] = '\0';
            dst.colourArgb = slot.colourArgb.load (std::memory_order_relaxed);
            ++count;
        }
        return count;
    }

private:
    static bool isValid (int slotIndex) noexcept { return slotIndex >= 0 && slotIndex < MAX_SIMULTANEOUS_TRACKS; }

    struct Slot
    {
        std::atomic<void*> owner { nullptr };
        std::atomic<std::uint32_t> colourArgb { 0 };
        SeqLockArray<char, TRACK_NAME_CAPACITY> name;
        SeqLockArray<float, BARK_BANDS_COUNT> bark;
        SeqLockArray<float, BUS_SPECTRUM_BINS> spectrum;
        BusWaveformRing waveform;
    };

    std::array<Slot, MAX_SIMULTANEOUS_TRACKS> slots;
};

} // namespace LiquidAudio
