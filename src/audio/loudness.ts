/**
 * ITU-R BS.1770-4 / EBU R128 Loudness Meter
 * - K-weighting (pre-filter shelf + RLB high-pass), coefficients derived for any sample rate
 * - Momentary (400 ms), Short-Term (3 s) and gated Integrated loudness
 * - Loudness Range (EBU Tech 3342) and 4x oversampled True Peak
 * Pure DSP class without Web Audio dependencies so it can be unit-tested in Node.
 */

const ABSOLUTE_GATE_LUFS = -70;
const INTEGRATED_RELATIVE_GATE_LU = -10;
const LRA_RELATIVE_GATE_LU = -20;
const SILENCE_LUFS = -90;

const TRUE_PEAK_OVERSAMPLING = 4;
const TRUE_PEAK_TAPS_PER_PHASE = 12;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

// Same derivation as libebur128: exact BS.1770 coefficients at 48 kHz, matched response elsewhere
function makeKWeightingFilters(sampleRate: number): [Biquad, Biquad] {
  // Stage 1: high-frequency shelf (+4 dB above ~1.7 kHz, head acoustics)
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };

  // Stage 2: RLB high-pass (~38 Hz)
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highPass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };

  return [shelf, highPass];
}

// Windowed-sinc polyphase interpolator for inter-sample (true) peak estimation
function makeTruePeakPhases(): Float64Array[] {
  const factor = TRUE_PEAK_OVERSAMPLING;
  const length = factor * TRUE_PEAK_TAPS_PER_PHASE;
  const center = (length - 1) / 2;
  const proto = new Float64Array(length);
  for (let n = 0; n < length; n++) {
    const x = (n - center) / factor;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    // Blackman window
    const w =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * (n + 0.5)) / length) +
      0.08 * Math.cos((4 * Math.PI * (n + 0.5)) / length);
    proto[n] = sinc * w;
  }

  const phases: Float64Array[] = [];
  for (let p = 0; p < factor; p++) {
    const taps = new Float64Array(TRUE_PEAK_TAPS_PER_PHASE);
    let sum = 0;
    for (let k = 0; k < TRUE_PEAK_TAPS_PER_PHASE; k++) {
      taps[k] = proto[k * factor + p];
      sum += taps[k];
    }
    // Unity DC gain per phase
    for (let k = 0; k < TRUE_PEAK_TAPS_PER_PHASE; k++) taps[k] /= sum;
    phases.push(taps);
  }
  return phases;
}

function powerToLufs(power: number): number {
  return power > 0 ? -0.691 + 10 * Math.log10(power) : SILENCE_LUFS;
}

function meanPower(values: number[], start: number, count: number): number {
  let sum = 0;
  for (let i = start; i < start + count; i++) sum += values[i];
  return sum / count;
}

export interface LoudnessReading {
  momentaryLufs: number;
  shortTermLufs: number;
  integratedLufs: number;
  loudnessRangeLu: number;
  truePeakDb: number; // running maximum since reset (dBTP)
  shortTermTruePeakDb: number; // maximum over the last ~400 ms
}

export class BS1770Meter {
  private readonly numChannels: number;
  private readonly filters: [Biquad, Biquad];
  // Per channel filter states: [shelf z1, shelf z2, hp z1, hp z2]
  private readonly filterState: Float64Array[];
  private readonly subBlockSize: number;
  private subBlockFill = 0;
  private subBlockEnergy = 0;

  // Mean-square power of each completed 100 ms sub-block (ring of 30 = 3 s)
  private readonly recentSubBlocks: number[] = [];
  // Gating block powers (400 ms blocks, 75 % overlap) for integrated loudness
  private readonly gatingBlocks: number[] = [];
  // Short-term powers sampled every 100 ms for loudness range
  private readonly shortTermBlocks: number[] = [];

  private readonly tpPhases = makeTruePeakPhases();
  private readonly tpHistory: Float64Array[];
  private tpHistoryPos = 0;
  private truePeakMax = 0;
  private readonly recentTruePeaks: number[] = [];
  private currentSubBlockTruePeak = 0;

  private readonly measureTruePeak: boolean;

  constructor(sampleRate: number, numChannels = 2, options: { truePeak?: boolean } = {}) {
    this.numChannels = numChannels;
    this.measureTruePeak = options.truePeak ?? true;
    this.filters = makeKWeightingFilters(sampleRate);
    this.filterState = Array.from({ length: numChannels }, () => new Float64Array(4));
    this.subBlockSize = Math.max(1, Math.round(sampleRate * 0.1));
    this.tpHistory = Array.from({ length: numChannels }, () => new Float64Array(TRUE_PEAK_TAPS_PER_PHASE));
  }

  public reset(): void {
    this.filterState.forEach((s) => s.fill(0));
    this.tpHistory.forEach((h) => h.fill(0));
    this.tpHistoryPos = 0;
    this.subBlockFill = 0;
    this.subBlockEnergy = 0;
    this.recentSubBlocks.length = 0;
    this.gatingBlocks.length = 0;
    this.shortTermBlocks.length = 0;
    this.recentTruePeaks.length = 0;
    this.truePeakMax = 0;
    this.currentSubBlockTruePeak = 0;
  }

  /** Feeds one block of planar audio; all channels must have equal length. */
  public process(channels: ArrayLike<number>[]): void {
    const length = channels[0]?.length ?? 0;
    const chCount = Math.min(this.numChannels, channels.length);
    const [s, h] = this.filters;
    const taps = TRUE_PEAK_TAPS_PER_PHASE;

    for (let i = 0; i < length; i++) {
      let energy = 0;
      for (let ch = 0; ch < chCount; ch++) {
        const x = channels[ch][i];

        // True peak: push sample into history and evaluate all polyphase outputs
        const hist = this.tpHistory[ch];
        hist[this.tpHistoryPos] = x;
        for (let p = 0; this.measureTruePeak && p < this.tpPhases.length; p++) {
          const phase = this.tpPhases[p];
          let acc = 0;
          let idx = this.tpHistoryPos;
          for (let k = 0; k < taps; k++) {
            acc += phase[k] * hist[idx];
            idx = idx === 0 ? taps - 1 : idx - 1;
          }
          const abs = Math.abs(acc);
          if (abs > this.currentSubBlockTruePeak) this.currentSubBlockTruePeak = abs;
        }
        const absX = Math.abs(x);
        if (absX > this.currentSubBlockTruePeak) this.currentSubBlockTruePeak = absX;

        // K-weighting (transposed direct form II)
        const st = this.filterState[ch];
        const y1 = s.b0 * x + st[0];
        st[0] = s.b1 * x - s.a1 * y1 + st[1];
        st[1] = s.b2 * x - s.a2 * y1;
        const y2 = h.b0 * y1 + st[2];
        st[2] = h.b1 * y1 - h.a1 * y2 + st[3];
        st[3] = h.b2 * y1 - h.a2 * y2;

        energy += y2 * y2; // all channel weights are 1.0 for L/R/C
      }
      this.tpHistoryPos = (this.tpHistoryPos + 1) % taps;

      this.subBlockEnergy += energy;
      this.subBlockFill++;
      if (this.subBlockFill >= this.subBlockSize) {
        this.completeSubBlock();
      }
    }
  }

  private completeSubBlock(): void {
    this.recentSubBlocks.push(this.subBlockEnergy / this.subBlockFill);
    if (this.recentSubBlocks.length > 30) this.recentSubBlocks.shift();
    this.subBlockEnergy = 0;
    this.subBlockFill = 0;

    this.recentTruePeaks.push(this.currentSubBlockTruePeak);
    if (this.recentTruePeaks.length > 4) this.recentTruePeaks.shift();
    if (this.currentSubBlockTruePeak > this.truePeakMax) this.truePeakMax = this.currentSubBlockTruePeak;
    this.currentSubBlockTruePeak = 0;

    const n = this.recentSubBlocks.length;
    if (n >= 4) {
      this.gatingBlocks.push(meanPower(this.recentSubBlocks, n - 4, 4));
    }
    if (n >= 30) {
      this.shortTermBlocks.push(meanPower(this.recentSubBlocks, 0, 30));
    }
  }

  private windowLufs(subBlocks: number): number {
    const n = this.recentSubBlocks.length;
    if (n === 0) return SILENCE_LUFS;
    const count = Math.min(subBlocks, n);
    return powerToLufs(meanPower(this.recentSubBlocks, n - count, count));
  }

  private integratedLufs(): number {
    const absGated = this.gatingBlocks.filter((p) => powerToLufs(p) > ABSOLUTE_GATE_LUFS);
    if (absGated.length === 0) return SILENCE_LUFS;
    const relativeGate = powerToLufs(meanPower(absGated, 0, absGated.length)) + INTEGRATED_RELATIVE_GATE_LU;
    const relGated = absGated.filter((p) => powerToLufs(p) > relativeGate);
    if (relGated.length === 0) return SILENCE_LUFS;
    return powerToLufs(meanPower(relGated, 0, relGated.length));
  }

  private loudnessRange(): number {
    const absGated = this.shortTermBlocks.filter((p) => powerToLufs(p) > ABSOLUTE_GATE_LUFS);
    if (absGated.length < 2) return 0;
    const relativeGate = powerToLufs(meanPower(absGated, 0, absGated.length)) + LRA_RELATIVE_GATE_LU;
    const values = absGated
      .filter((p) => powerToLufs(p) > relativeGate)
      .map(powerToLufs)
      .sort((a, b) => a - b);
    if (values.length < 2) return 0;
    const percentile = (q: number) => values[Math.min(values.length - 1, Math.round(q * (values.length - 1)))];
    return Math.max(0, percentile(0.95) - percentile(0.1));
  }

  public read(): LoudnessReading {
    const toDb = (lin: number) => (lin > 1e-6 ? 20 * Math.log10(lin) : SILENCE_LUFS);
    return {
      momentaryLufs: this.windowLufs(4),
      shortTermLufs: this.windowLufs(30),
      integratedLufs: this.integratedLufs(),
      loudnessRangeLu: this.loudnessRange(),
      truePeakDb: toDb(this.truePeakMax),
      shortTermTruePeakDb: toDb(Math.max(this.currentSubBlockTruePeak, ...this.recentTruePeaks)),
    };
  }
}
