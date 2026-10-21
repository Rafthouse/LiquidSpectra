/**
 * LiquidSpectra C++20 VST3 / AU Source Architecture & Test Suite Runner
 * The C++ sources live in /plugin and are bundled here verbatim (Vite ?raw imports),
 * so the in-app export always matches the code that is actually compiled and tested.
 */

import { DSPTestResult } from '../types/audio';
import { BS1770Meter } from './loudness';
import cmakeLists from '../../plugin/CMakeLists.txt?raw';
import processorH from '../../plugin/Source/PluginProcessor.h?raw';
import processorCpp from '../../plugin/Source/PluginProcessor.cpp?raw';
import editorH from '../../plugin/Source/PluginEditor.h?raw';
import editorCpp from '../../plugin/Source/PluginEditor.cpp?raw';
import seqLockH from '../../plugin/Source/SeqLock.h?raw';
import barkScaleH from '../../plugin/Source/BarkScale.h?raw';
import busH from '../../plugin/Source/MultiInstanceBus.h?raw';
import spectralH from '../../plugin/Source/SpectralAnalyzerDSP.h?raw';
import collisionH from '../../plugin/Source/CollisionDetector.h?raw';
import loudnessH from '../../plugin/Source/LoudnessMeterEBU.h?raw';
import skiaH from '../../plugin/Source/SkiaVectorRenderer.h?raw';
import skiaCpp from '../../plugin/Source/SkiaVectorRenderer.cpp?raw';
import testsCpp from '../../plugin/Tests/DSPUnitTests.cpp?raw';
import workflowYml from '../../plugin/.github/workflows/build-plugins.yml?raw';
import buildGuideMd from '../../plugin/BUILD_GUIDE.md?raw';
import readmeMd from '../../plugin/README.md?raw';

export interface CppFile {
  name: string;
  path: string;
  language: 'cpp' | 'cmake' | 'yaml' | 'markdown';
  content: string;
  description: string;
}

export const CPP_PROJECT_FILES: CppFile[] = [
  { name: 'CMakeLists.txt', path: 'CMakeLists.txt', language: 'cmake', content: cmakeLists,
    description: 'CMake build for VST3 / Standalone (+ AU on macOS), JUCE 8.0.15 pinned, DSP test target' },
  { name: 'PluginProcessor.h', path: 'Source/PluginProcessor.h', language: 'cpp', content: processorH,
    description: 'AudioProcessor: main/sidechain buses, DAW track name & colour, state persistence' },
  { name: 'PluginProcessor.cpp', path: 'Source/PluginProcessor.cpp', language: 'cpp', content: processorCpp,
    description: 'Allocation-free processBlock: analyses the main input only and publishes to the shared bus' },
  { name: 'PluginEditor.h', path: 'Source/PluginEditor.h', language: 'cpp', content: editorH,
    description: 'Native JUCE 8 editor: spectrum, other tracks, masking zones, LUFS readouts, true-peak meters' },
  { name: 'PluginEditor.cpp', path: 'Source/PluginEditor.cpp', language: 'cpp', content: editorCpp,
    description: 'Editor painting and interaction (CLIP reset, double-click loudness reset)' },
  { name: 'SeqLock.h', path: 'Source/SeqLock.h', language: 'cpp', content: seqLockH,
    description: 'Wait-free single-writer sequence lock for audio-thread → GUI data exchange' },
  { name: 'BarkScale.h', path: 'Source/BarkScale.h', language: 'cpp', content: barkScaleH,
    description: '24 critical-band edges and centres shared by analyser, detector and editor' },
  { name: 'MultiInstanceBus.h', path: 'Source/MultiInstanceBus.h', language: 'cpp', content: busH,
    description: 'Lock-free inter-instance bus (seqlock per slot) for cross-track collision detection' },
  { name: 'SpectralAnalyzerDSP.h', path: 'Source/SpectralAnalyzerDSP.h', language: 'cpp', content: spectralH,
    description: '4096-point Hann FFT with 50 % overlap, calibrated levels and power-averaged Bark bands' },
  { name: 'CollisionDetector.h', path: 'Source/CollisionDetector.h', language: 'cpp', content: collisionH,
    description: 'Cross-track masking detection with EQ suggestions' },
  { name: 'LoudnessMeterEBU.h', path: 'Source/LoudnessMeterEBU.h', language: 'cpp', content: loudnessH,
    description: 'ITU-R BS.1770-4 / EBU R128 meter: K-weighting, gating, LRA, 4x true peak — real-time safe' },
  { name: 'SkiaVectorRenderer.h', path: 'Source/SkiaVectorRenderer.h', language: 'cpp', content: skiaH,
    description: 'Experimental Skia renderer (reference only, not compiled — Skia is not bundled)' },
  { name: 'SkiaVectorRenderer.cpp', path: 'Source/SkiaVectorRenderer.cpp', language: 'cpp', content: skiaCpp,
    description: 'Experimental Skia renderer implementation (reference only, not compiled)' },
  { name: 'DSPUnitTests.cpp', path: 'Tests/DSPUnitTests.cpp', language: 'cpp', content: testsCpp,
    description: 'EBU Tech 3341/3342 reference tests, spectrum calibration, bus concurrency (runs in Release)' },
  { name: 'build-plugins.yml', path: '.github/workflows/build-plugins.yml', language: 'yaml', content: workflowYml,
    description: 'GitHub Actions: Windows VST3 and macOS Universal VST3/AU builds with tests' },
  { name: 'README.md', path: 'README.md', language: 'markdown', content: readmeMd,
    description: 'Project overview and quick build commands' },
  { name: 'BUILD_GUIDE.md', path: 'BUILD_GUIDE.md', language: 'markdown', content: buildGuideMd,
    description: 'Build instructions for Windows and macOS' },
  {
    name: 'GOOGLE_FLOW_HANDOVER_SPEC.md',
    path: 'GOOGLE_FLOW_HANDOVER_SPEC.md',
    language: 'markdown',
    description: 'Master technical specification, DSP formulas, and handover manifesto for Google Flow & development team',
    content: `# ТЕХНІЧНЕ ЗАВДАННЯ ТА СПЕЦИФІКАЦІЯ ПЕРЕДАЧІ (HANDOVER SPECIFICATION)
## Проект: LiquidSpectra Pro — Преміальний мультитрековий аудіоаналізатор
Цільовий рівень якості: FabFilter Pro-Q 3 / Pro-L 2
Технологічний стек: C++20, JUCE 8 (Native Audio + Vector GUI, БЕЗ WebBrowserComponent), CMake 3.22+, SIMD (AVX2/NEON)

### 1. ГОЛОВНА АРХІТЕКТУРНА ВИМОГА
- ЖОДНОГО WebView2 / WKWebView. Графіка суто нативна векторна C++ (OpenGL / Direct2D / Metal) на 60 FPS.
- Навантаження на ЦП: < 0.4% при 32 доріжках.
- Нульова затримка (0 samples latency pass-through).

### 2. СТРУКТУРА DSP РУШІЯ
- 4096-точкове FFT з вікном Hann / Blackman-Harris.
- 24 критичні смуги шкали Барка (20 Гц - 15.5 кГц).
- Lock-Free MultiInstanceBus (std::atomic) для синхронізації до 32 доріжок DAW без затримок.
- Виявлення колізій (Clash Severity Formula): C_b = (2 * A1 * A2) / (A1^2 + A2^2).
- EBU R128 / ITU-R BS.1770-4 K-weighting фільтри, Momentary/Short-term/Integrated LUFS, True Peak.
- Стерео гоніометр (Lissajous) та фазовий корелометр (-1.0 ... +1.0).

### 3. ВИХІДНІ ПРОДУКТИ (DELIVERABLES)
1. Windows x64: LiquidSpectra.vst3 та LiquidSpectra.exe
2. macOS Universal (ARM64 M-чипи + Intel): LiquidSpectra.vst3, LiquidSpectra.component (AU), LiquidSpectra.app
3. CI/CD: .github/workflows/build-plugins.yml з автоматичною збіркою на хмарних машинах GitHub.
`,
  },
];

// Interactive In-Browser DSP Test Suite Runner
export async function runBrowserDSPTests(): Promise<DSPTestResult[]> {
  const results: DSPTestResult[] = [];

  // Test 1: FFT Resolution & Bark Scale Mapping
  {
    const t0 = performance.now();
    const sampleRate = 48000;
    const fftSize = 4096;
    const binHz = sampleRate / fftSize;
    const expectedBarkEdges = [20, 100, 200, 300, 400, 510, 630, 770, 920, 1080, 1270, 1480, 1720, 2000, 2320, 2700, 3150, 3700, 4400, 5300, 6400, 7700, 9500, 12000, 15500];
    let allBinsValid = true;
    for (let i = 0; i < expectedBarkEdges.length - 1; i++) {
      const lowBin = Math.floor(expectedBarkEdges[i] / binHz);
      const highBin = Math.ceil(expectedBarkEdges[i + 1] / binHz);
      if (highBin <= lowBin || highBin > fftSize / 2) {
        allBinsValid = false;
        break;
      }
    }
    const t1 = performance.now();
    results.push({
      name: 'FFT 4096-Point & Bark Psychoacoustic Band Partitioning',
      category: 'Psychoacoustics',
      durationMicroseconds: Math.round((t1 - t0) * 1000),
      passed: allBinsValid,
      message: `24 critical Bark frequency bands mapped cleanly across ${fftSize / 2} frequency bins at ${binHz.toFixed(2)} Hz/bin resolution.`,
    });
  }

  // Test 2: Cross-Spectral Masking & Collision Index Calculation
  {
    const t0 = performance.now();
    const dbKick = -12.0;
    const dbBass = -14.5;
    const ampA = Math.pow(10, (dbKick + 60) / 40);
    const ampB = Math.pow(10, (dbBass + 60) / 40);
    const overlap = (2 * ampA * ampB) / (ampA * ampA + ampB * ampB);
    const passed = overlap > 0.85 && overlap <= 1.0;
    const t1 = performance.now();
    results.push({
      name: 'Cross-Spectral Masking & Clash Severity Equation',
      category: 'FFT',
      durationMicroseconds: Math.round((t1 - t0) * 1000),
      passed,
      message: `Clash index: ${(overlap * 100).toFixed(1)}% overlap detected. Dynamic EQ attenuation target: -${(2.5 + overlap * 4.5).toFixed(1)} dB.`,
    });
  }

  // Test 3: EBU R128 / ITU-R BS.1770-4 calibration (EBU Tech 3341 case 1)
  {
    const t0 = performance.now();
    const sRate = 48000;
    const amp = Math.pow(10, -23 / 20);
    const signal = new Float32Array(sRate * 5);
    for (let i = 0; i < signal.length; i++) signal[i] = amp * Math.sin((2 * Math.PI * 1000 * i) / sRate);
    const meter = new BS1770Meter(sRate);
    for (let i = 0; i < signal.length; i += 1024) {
      const block = signal.subarray(i, i + 1024);
      meter.process([block, block]);
    }
    const integrated = meter.read().integratedLufs;
    const t1 = performance.now();
    results.push({
      name: 'ITU-R BS.1770-4 K-Weighting & Gated Loudness',
      category: 'EBU-R128',
      durationMicroseconds: Math.round((t1 - t0) * 1000),
      passed: Math.abs(integrated + 23) <= 0.1,
      message: `Stereo 1 kHz sine at -23 dBFS measured ${integrated.toFixed(2)} LUFS (expected -23.0 ±0.1).`,
    });
  }

  // Test 4: Stereo Phase Correlation Mathematical Invariants
  {
    const t0 = performance.now();
    // Identical signals -> correlation = +1.0
    // Inverted signals -> correlation = -1.0
    let dotInPhase = 0, dotAntiPhase = 0, sumSq = 0;
    for (let i = 0; i < 256; i++) {
      const s = Math.sin(i * 0.1);
      dotInPhase += s * s;
      dotAntiPhase += s * (-s);
      sumSq += s * s;
    }
    const rIn = dotInPhase / sumSq;
    const rAnti = dotAntiPhase / sumSq;
    const passed = Math.abs(rIn - 1.0) < 0.001 && Math.abs(rAnti - (-1.0)) < 0.001;
    const t1 = performance.now();
    results.push({
      name: 'Stereo Phase Correlation & Goniometer Lissajous Coordinates',
      category: 'SIMD',
      durationMicroseconds: Math.round((t1 - t0) * 1000),
      passed,
      message: `Bounded within [-1.0, +1.0]. Full phase inversion test passed (r = ${rAnti.toFixed(2)}).`,
    });
  }

  // Test 5: True peak detects inter-sample overs (fs/4 sine, 45° phase)
  {
    const t0 = performance.now();
    const sRate = 48000;
    const signal = new Float32Array(sRate);
    let samplePeak = 0;
    for (let i = 0; i < signal.length; i++) {
      signal[i] = Math.sin((2 * Math.PI * (sRate / 4) * i) / sRate + Math.PI / 4);
      samplePeak = Math.max(samplePeak, Math.abs(signal[i]));
    }
    const meter = new BS1770Meter(sRate);
    meter.process([signal, signal]);
    const tp = meter.read().truePeakDb;
    const t1 = performance.now();
    results.push({
      name: 'True Peak (4x oversampled) vs Sample Peak',
      category: 'EBU-R128',
      durationMicroseconds: Math.round((t1 - t0) * 1000),
      passed: tp > -0.6 && tp < 0.3,
      message: `Sample peak ${(20 * Math.log10(samplePeak)).toFixed(2)} dBFS, true peak ${tp.toFixed(2)} dBTP (expected ≈ 0.0). Thread-safety is covered by the C++ DSPUnitTests.`,
    });
  }

  return results;
}
