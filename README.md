# LiquidSpectra — Multi-Track Audio Analyzer

A next-generation multitrack spectral analysis suite shipped as an audio plug-in (**VST3 / AU / Standalone**) for **Windows** and **macOS**.

LiquidSpectra gives you calibrated real-time spectrum analysis across multiple tracks, with intelligent cross-track masking (collision) detection, EBU R128 loudness metering, a stereo goniometer, and a synchronized oscilloscope — all behind an Apple Liquid Glass-inspired interface.

## Features

- Calibrated 4096-point spectrum analyser (50% overlap) with 24 critical (Bark) bands
- Lock-free bus between plug-in instances in the same host process
- Cross-track masking (collision) detection with EQ suggestions
- ITU-R BS.1770-4 / EBU R128 loudness (M / S / I / LRA) with 4× oversampled true peak
- Stereo goniometer and synchronized oscilloscope
- Real-time safe audio thread (no allocations, no locks)
- Self-contained web-based editor (no external files or browser needed)

## Download

Prebuilt installers are on the [Releases](https://github.com/Rafthouse/LiquidSpectra/releases/tag/v1.2.0) page.

| Platform | Installer | Contents |
| --- | --- | --- |
| Windows x64 | [LiquidSpectra-1.2.0-win-x64.exe](https://github.com/Rafthouse/LiquidSpectra/releases/download/v1.2.0/LiquidSpectra-1.2.0-win-x64.exe) | VST3 + Standalone |
| macOS Universal | [LiquidSpectra-1.2.0.pkg](https://github.com/Rafthouse/LiquidSpectra/releases/download/v1.2.0/LiquidSpectra-1.2.0.pkg) | VST3 + AU |
| macOS Universal | [LiquidSpectra-1.2.0.dmg](https://github.com/Rafthouse/LiquidSpectra/releases/download/v1.2.0/LiquidSpectra-1.2.0.dmg) | Standalone app |

## Installation

**Windows** — run the `.exe` installer. It installs the VST3 to `C:\Program Files\Common Files\VST3\` and the standalone app to `Program Files\LiquidSpectra\`.

**macOS** — the `.pkg` installs the VST3/AU components; the `.dmg` holds the standalone app (drag to `/Applications`). The build is **unsigned**, so on first launch right-click the app or installer and choose **Open**.

## Formats

- **Windows:** VST3, Standalone (x64)
- **macOS:** VST3, AU, Standalone (Universal — arm64 + x86_64)

## Building from source

Requirements: CMake 3.22+, a C++20 toolchain, and JUCE 8.0.15 (fetched automatically by CMake).

```bash
cmake -S plugin -B build -A x64
cmake --build build --config Release --parallel
ctest --test-dir build -C Release --output-on-failure
```

On macOS add `-G Xcode -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"`. Full guide: [`plugin/BUILD_GUIDE.md`](plugin/BUILD_GUIDE.md).
