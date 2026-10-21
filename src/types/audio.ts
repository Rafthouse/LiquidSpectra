/**
 * LiquidSpectra Audio Types & Data Structures
 */

export type ModuleMode = 
  | 'spectrum'
  | 'sonogram'
  | 'collisions'
  | 'loudness'
  | 'stereo'
  | 'oscilloscope'
  | 'cpp_export';

export type FrequencyScale = 'log' | 'linear' | 'bark' | 'mel';

export type SmoothingMode = 'none' | '1/48' | '1/24' | '1/12' | '1/6' | '1/3' | '1/1';

export type SpectralTilt = '0dB' | '+3dB' | '+4.5dB';

export type SonogramPalette = 'liquid' | 'magma' | 'viridis' | 'cyber' | 'grayscale';

export interface AudioTrack {
  id: string;
  name: string;
  color: string;
  glowColor: string;
  volume: number; // 0 to 1
  pan: number; // -1 (L) to +1 (R)
  isMuted: boolean;
  isSolo: boolean;
  isVisible: boolean;
  isSidechainActive: boolean;
  sidechainTargetId?: string;
  type: 'kick' | 'bass' | 'vocal' | 'synth' | 'custom' | 'mic';
  // Corrective filter state
  filterEnabled: boolean;
  filterFreq: number;
  filterGain: number; // dB
  filterQ: number;
  // Live analysis cache
  peakLevelDb: number;
  rmsLevelDb: number;
  dominantFrequency: number;
}

export interface CollisionEvent {
  trackAId: string;
  trackBId: string;
  trackAName: string;
  trackBName: string;
  trackAColor?: string;
  trackBColor?: string;
  frequencyHz: number;
  bandwidthHz: number;
  maskingSeverity: number; // 0 to 1 (0% to 100%)
  criticalBand: 'Sub' | 'Bass' | 'Low-Mid' | 'Mid' | 'High-Mid' | 'Presence';
  description: string;
  suggestedAction: {
    targetTrackId: string;
    targetTrackName: string;
    filterType: 'bell' | 'notch' | 'lowcut';
    frequencyHz: number;
    recommendedGainDb: number;
    q: number;
    duckingDb?: number;
  };
}

export interface PersistentCollision extends CollisionEvent {
  key: string;
  occurrenceCount: number;
  recentHits: number;
  isFrequent: boolean;
  isPinned: boolean;
  peakSeverity: number;
  smoothedSeverity: number;
  lastSeenTime: number;
  isCurrentlyActive: boolean;
}

export interface LoudnessMetrics {
  momentaryLufs: number;
  shortTermLufs: number;
  integratedLufs: number;
  truePeakDb: number;
  crestFactorDb: number;
  loudnessRangeLu: number;
}

export interface StereoMetrics {
  correlation: number; // -1 to +1
  widthPercent: number; // 0 to 200%
  midLevelDb: number;
  sideLevelDb: number;
  balance: number; // -1 to +1
}

export interface AnalyzerSettings {
  fftSize: 1024 | 2048 | 4096 | 8192;
  smoothing: SmoothingMode;
  frequencyScale: FrequencyScale;
  tilt: SpectralTilt;
  decaySpeed: 'slow' | 'medium' | 'fast' | 'hold';
  minDb: number; // e.g. -96
  maxDb: number; // e.g. 0
  sonogramPalette: SonogramPalette;
  sonogramSpeed: number; // 1 to 5
  oscilloscopeTimebaseMs: number; // 1 to 50
  oscilloscopeTriggerMode: 'auto' | 'norm' | 'freeze';
  collisionThreshold: number; // 0 to 1
  spectrumStyle?: 'curve' | 'bars' | 'stepped';
  octaveBandResolution?: '1/1' | '1/3';
  showPianoRoll?: boolean;
  spectrumGrab?: boolean;
  showCollisionOverlay?: boolean;
  displayRange?: '30dB' | '60dB' | '90dB' | '120dB';
  rangeDb?: number;
  isFrozen?: boolean;
  peakHold?: boolean;
}

export interface DSPTestResult {
  name: string;
  category: 'FFT' | 'Psychoacoustics' | 'EBU-R128' | 'RingBuffer' | 'SIMD';
  durationMicroseconds: number;
  passed: boolean;
  message: string;
  benchmarkScore?: string;
}
