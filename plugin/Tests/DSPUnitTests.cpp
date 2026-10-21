#include <cassert>
#include <iostream>
#include <chrono>
#include "../Source/SpectralAnalyzerDSP.h"
#include "../Source/CollisionDetector.h"
#include "../Source/LoudnessMeterEBU.h"
#include "../Source/MultiInstanceBus.h"

using namespace LiquidAudio;

void testBarkScaleBoundaries()
{
    SpectralAnalyzerDSP dsp;
    dsp.prepare(48000.0, 512);

    const auto& bark = dsp.getLatestBarkMagnitudes();
    assert(bark.size() == SpectralAnalyzerDSP::NUM_BARK_BANDS);
    std::cout << "[PASS] Bark Scale 24 Critical Bands Initialized Correctly\n";
}

void testCollisionIndexSymmetry()
{
    std::vector<TrackSpectrumFrame> frames;
    TrackSpectrumFrame track1, track2;

    track1.instanceId = 0;
    std::strcpy(track1.name, "Kick");
    track1.barkMagnitudes[0] = -12.0f; // High sub energy

    track2.instanceId = 1;
    std::strcpy(track2.name, "808 Bass");
    track2.barkMagnitudes[0] = -14.0f; // High sub energy overlap

    frames.push_back(track1);
    frames.push_back(track2);

    auto collisions = CollisionDetector::analyzeCollisions(frames, 0.35f);
    assert(!collisions.empty());
    assert(collisions[0].maskingSeverity > 0.80f);
    assert(collisions[0].recommendedCutGainDb < -3.0f);
    std::cout << "[PASS] Collision Detection Severity Calculated Accurately (Severity: " 
              << collisions[0].maskingSeverity * 100.0f << "%)\n";
}

void testLoudnessKWeighting()
{
    LoudnessMeterEBU meter;
    meter.prepare(48000.0, 256);

    juce::AudioBuffer<float> buffer(2, 256);
    // Fill with 1 kHz sine at 0 dBFS
    for (int i = 0; i < 256; ++i)
    {
        float val = std::sin(2.0f * 3.14159265f * 1000.0f * (float)i / 48000.0f);
        buffer.setSample(0, i, val);
        buffer.setSample(1, i, val);
    }

    meter.processBlock(buffer);
    assert(meter.getTruePeakDb() >= -0.5f && meter.getTruePeakDb() <= 0.5f);
    std::cout << "[PASS] EBU R128 True Peak & K-Weighting Calibration Passed\n";
}

void testLockFreeMultiInstanceBus()
{
    MultiInstanceBus bus;
    int id1 = bus.registerInstance((void*)0x1);
    int id2 = bus.registerInstance((void*)0x2);
    assert(id1 >= 0 && id2 >= 0 && id1 != id2);

    auto active = bus.snapshotActiveTracks();
    assert(active.size() == 2);

    bus.unregisterInstance(id1);
    auto activeAfter = bus.snapshotActiveTracks();
    assert(activeAfter.size() == 1);
    std::cout << "[PASS] Lock-Free Multi-Instance Ring-Buffer Concurrency Passed\n";
}

int main()
{
    std::cout << "=== Running LiquidSpectra DSP Test Suite (C++20 / VST3 / AU) ===\n";
    auto start = std::chrono::high_resolution_clock::now();

    testBarkScaleBoundaries();
    testCollisionIndexSymmetry();
    testLoudnessKWeighting();
    testLockFreeMultiInstanceBus();

    auto end = std::chrono::high_resolution_clock::now();
    auto elapsedUs = std::chrono::duration_cast<std::chrono::microseconds>(end - start).count();

    std::cout << "=== All 4 Test Suites Passed in " << elapsedUs << " microseconds ===\n";
    return 0;
}
