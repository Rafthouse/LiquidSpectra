# LiquidSpectra Multi-Track Analyzer (VST3 / AU / Standalone)

C++20 / JUCE 8.0.15 audio analyzer plugin with a native JUCE editor.

## Features
- Calibrated 4096-point spectrum analyser (50 % overlap) with 24 critical (Bark) bands
- Lock-free bus between plug-in instances in the same host process
- Cross-track masking (collision) detection with EQ suggestions
- ITU-R BS.1770-4 / EBU R128 loudness (M / S / I / LRA) and 4x oversampled true peak
- Real-time safe audio thread (no allocations, no locks)

## Build
Full instructions: `BUILD_GUIDE.md`. Quick start:

```bash
cmake -B build
cmake --build build --config Release --parallel
ctest --test-dir build -C Release --output-on-failure
```

On macOS add `-G Xcode -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"` to the first command.
Or push this folder to GitHub: `.github/workflows/build-plugins.yml` builds Windows and macOS binaries.
