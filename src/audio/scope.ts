/**
 * Oscilloscope acquisition core (pure, no Web Audio dependencies).
 *
 * Every channel is stored on one absolute sample timeline, so all traces of a frame read
 * exactly the same instant even though each track's ScriptProcessor callback lands at a
 * slightly different moment. Triggering is resolved to a fraction of a sample, which keeps
 * periodic waveforms perfectly still on fast timebases.
 */

const BLOCK_SHIFT = 6; // 64-sample min/max blocks for long timebases
const BLOCK = 1 << BLOCK_SHIFT;

export class ScopeRing {
  readonly size: number;
  readonly buffer: Float32Array;
  private readonly blockMin: Float32Array;
  private readonly blockMax: Float32Array;
  /** Absolute index (on the shared timeline) one past the newest stored sample. */
  endSample = 0;
  /** performance.now() of the latest write, used for smooth roll mode. */
  lastWriteMs = 0;
  /** Samples delivered per callback (for roll-mode interpolation). */
  lastBlockLength = 0;

  constructor(seconds: number, sampleRate: number) {
    const wanted = Math.max(BLOCK * 4, Math.round(seconds * sampleRate));
    this.size = Math.ceil(wanted / BLOCK) * BLOCK;
    this.buffer = new Float32Array(this.size);
    this.blockMin = new Float32Array(this.size >> BLOCK_SHIFT);
    this.blockMax = new Float32Array(this.size >> BLOCK_SHIFT);
  }

  /** Stores a block that starts at absolute sample `startSample`. */
  write(samples: ArrayLike<number>, startSample: number, nowMs: number): void {
    const len = samples.length;
    // A gap on the timeline (e.g. the context was suspended) reads as silence
    if (startSample > this.endSample) {
      for (let s = Math.max(this.endSample, startSample - this.size); s < startSample; s++) this.store(s, 0);
    }
    // Only the newest `size` samples of an oversized block can be kept
    let abs = Math.max(startSample, startSample + len - this.size);
    for (let i = abs - startSample; i < len; i++, abs++) this.store(abs, samples[i]);
    this.endSample = Math.max(this.endSample, startSample + len);
    this.lastWriteMs = nowMs;
    this.lastBlockLength = len;
  }

  private store(abs: number, v: number): void {
    const idx = ((abs % this.size) + this.size) % this.size;
    this.buffer[idx] = v;
    const b = idx >> BLOCK_SHIFT;
    if ((idx & (BLOCK - 1)) === 0) {
      this.blockMin[b] = v;
      this.blockMax[b] = v;
    } else {
      if (v < this.blockMin[b]) this.blockMin[b] = v;
      if (v > this.blockMax[b]) this.blockMax[b] = v;
    }
  }

  /** Oldest absolute sample still held. */
  get startSample(): number {
    return Math.max(0, this.endSample - this.size);
  }

  sample(abs: number): number {
    if (abs < this.startSample || abs >= this.endSample) return 0;
    return this.buffer[abs % this.size];
  }

  /** Catmull-Rom interpolated value at a fractional absolute position. */
  valueAt(pos: number): number {
    const i = Math.floor(pos);
    const t = pos - i;
    const p0 = this.sample(i - 1);
    const p1 = this.sample(i);
    const p2 = this.sample(i + 1);
    const p3 = this.sample(i + 2);
    return (
      p1 +
      0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
    );
  }

  private linearAt(pos: number): number {
    const i = Math.floor(pos);
    const t = pos - i;
    return this.sample(i) * (1 - t) + this.sample(i + 1) * t;
  }

  /** Min / max over the absolute range [from, to) using 64-sample blocks for the interior. */
  rangeMinMax(from: number, to: number, out: { min: number; max: number }): void {
    let lo = this.linearAt(from);
    let hi = lo;
    const end = this.linearAt(to);
    if (end < lo) lo = end;
    if (end > hi) hi = end;

    let s = Math.ceil(from);
    const last = Math.floor(to);
    while (s <= last) {
      const idx = ((s % this.size) + this.size) % this.size;
      if ((idx & (BLOCK - 1)) === 0 && s + BLOCK - 1 <= last && s >= this.startSample && s + BLOCK <= this.endSample) {
        const b = idx >> BLOCK_SHIFT;
        if (this.blockMin[b] < lo) lo = this.blockMin[b];
        if (this.blockMax[b] > hi) hi = this.blockMax[b];
        s += BLOCK;
      } else {
        const v = this.sample(s);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        s++;
      }
    }
    out.min = lo;
    out.max = hi;
  }
}

/**
 * Most recent edge crossing `level` inside the absolute window [from, to], resolved to a
 * fraction of a sample. A Schmitt trigger (arm beyond the hysteresis band, fire on the
 * crossing) rejects noise without needing a steep slope.
 */
export function findTriggerCrossing(
  ring: ScopeRing,
  from: number,
  to: number,
  level: number,
  edge: 'rising' | 'falling',
  hysteresis: number
): number | null {
  const start = Math.max(Math.ceil(from), ring.startSample + 1);
  const end = Math.min(Math.floor(to), ring.endSample - 1);
  const sign = edge === 'rising' ? 1 : -1;
  const lvl = level * sign;
  let armed = false;
  let found: number | null = null;

  for (let s = start; s <= end; s++) {
    const v = ring.sample(s) * sign;
    if (v <= lvl - hysteresis) {
      armed = true;
    } else if (armed && v >= lvl) {
      const prev = ring.sample(s - 1) * sign;
      const frac = v !== prev ? (lvl - prev) / (v - prev) : 0;
      found = s - 1 + Math.min(1, Math.max(0, frac));
      armed = false;
    }
  }
  return found;
}

export interface ScopeTrace {
  /** Per display column: lowest and highest value (equal when drawn as a line). */
  min: Float32Array;
  max: Float32Array;
  /** True when the timebase is short enough to draw an interpolated line. */
  isLine: boolean;
  peak: number;
  rms: number;
}

/** Samples a window of `length` samples starting at absolute `start` into `columns` columns. */
export function acquireTrace(ring: ScopeRing, start: number, length: number, columns: number): ScopeTrace {
  const min = new Float32Array(columns);
  const max = new Float32Array(columns);
  const perColumn = length / columns;
  const isLine = perColumn <= 1.5;
  let peak = 0;

  if (isLine) {
    const step = columns > 1 ? length / (columns - 1) : 0;
    for (let c = 0; c < columns; c++) {
      const v = ring.valueAt(start + c * step);
      min[c] = v;
      max[c] = v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
  } else {
    const mm = { min: 0, max: 0 };
    for (let c = 0; c < columns; c++) {
      const a = start + c * perColumn;
      ring.rangeMinMax(a, a + perColumn, mm);
      min[c] = mm.min;
      max[c] = mm.max;
      const p = Math.max(Math.abs(mm.min), Math.abs(mm.max));
      if (p > peak) peak = p;
    }
  }

  // RMS from at most 8192 evenly spaced samples (cheap even on 10 s windows)
  const probes = Math.min(8192, Math.max(1, Math.floor(length)));
  const stride = length / probes;
  let sumSq = 0;
  for (let i = 0; i < probes; i++) {
    const v = ring.sample(Math.floor(start + i * stride));
    sumSq += v * v;
  }

  return { min, max, isLine, peak, rms: Math.sqrt(sumSq / probes) };
}
