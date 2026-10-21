import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScopeRing, findTriggerCrossing, acquireTrace } from './scope.ts';

const SR = 48000;

function writeSine(ring: ScopeRing, freq: number, amp: number, startSample: number, length: number, block = 1024, phase = 0) {
  for (let s = startSample; s < startSample + length; s += block) {
    const n = Math.min(block, startSample + length - s);
    const chunk = new Float32Array(n);
    for (let i = 0; i < n; i++) chunk[i] = amp * Math.sin((2 * Math.PI * freq * (s + i)) / SR + phase);
    ring.write(chunk, s, 0);
  }
}

test('trigger resolves the crossing to a fraction of a sample', () => {
  // 997 Hz never lines up with the sample grid, so crossings fall between samples
  const ring = new ScopeRing(1, SR);
  writeSine(ring, 997, 0.5, 0, SR / 2);
  const t = findTriggerCrossing(ring, 1000, SR / 2 - 1000, 0, 'rising', 0.01);
  assert.ok(t !== null);
  // Exact rising zero crossings of sin(2π f n / SR) are at n = k · SR / f
  const period = SR / 997;
  const k = Math.round(t! / period);
  assert.ok(Math.abs(t! - k * period) < 0.01, `error ${t! - k * period} samples`);
});

test('trigger finds slow low-frequency edges', () => {
  // 40 Hz at -20 dBFS: the old two-sample comparison never fired on this
  const ring = new ScopeRing(1, SR);
  writeSine(ring, 40, 0.1, 0, SR / 2);
  assert.ok(findTriggerCrossing(ring, 0, SR / 2, 0.02, 'rising', 0.012) !== null);
  assert.ok(findTriggerCrossing(ring, 0, SR / 2, 0.02, 'falling', 0.012) !== null);
});

test('no trigger on a signal that never reaches the level', () => {
  const ring = new ScopeRing(1, SR);
  writeSine(ring, 440, 0.05, 0, SR / 4);
  assert.equal(findTriggerCrossing(ring, 0, SR / 4, 0.2, 'rising', 0.01), null);
});

test('channels written at different moments stay aligned on the shared timeline', () => {
  const a = new ScopeRing(1, SR);
  const b = new ScopeRing(1, SR);
  // Same signal, but delivered in differently sized / offset blocks
  writeSine(a, 220, 0.4, 0, 20000, 1024);
  writeSine(b, 220, 0.4, 0, 512, 512);
  writeSine(b, 220, 0.4, 512, 19488, 2048);
  const ta = acquireTrace(a, 15000.37, 480, 300);
  const tb = acquireTrace(b, 15000.37, 480, 300);
  for (let c = 0; c < 300; c++) assert.ok(Math.abs(ta.min[c] - tb.min[c]) < 1e-6);
});

test('line mode interpolates smoothly between samples', () => {
  const ring = new ScopeRing(1, SR);
  writeSine(ring, 1000, 0.8, 0, 4096);
  // 1 ms window over 400 columns: under one sample per column
  const trace = acquireTrace(ring, 2000.25, 48, 400);
  assert.ok(trace.isLine);
  const step = 48 / 399;
  let maxErr = 0;
  for (let c = 0; c < 400; c++) {
    const exact = 0.8 * Math.sin((2 * Math.PI * 1000 * (2000.25 + c * step)) / SR);
    maxErr = Math.max(maxErr, Math.abs(trace.min[c] - exact));
  }
  assert.ok(maxErr < 0.01, `max interpolation error ${maxErr}`);
});

test('envelope mode keeps the true peaks of every column', () => {
  const ring = new ScopeRing(2, SR);
  writeSine(ring, 3000, 0.6, 0, SR);
  // 500 ms over 500 columns: 48 samples (9 cycles) per column
  const trace = acquireTrace(ring, 10000, SR / 2, 500);
  assert.ok(!trace.isLine);
  for (let c = 0; c < 500; c++) {
    assert.ok(trace.max[c] > 0.59 && trace.min[c] < -0.59, `column ${c}: ${trace.min[c]}..${trace.max[c]}`);
  }
  assert.ok(Math.abs(trace.peak - 0.6) < 0.01);
  assert.ok(Math.abs(trace.rms - 0.6 / Math.SQRT2) < 0.01);
});

test('block acceleration matches a brute-force min/max on long windows', () => {
  const ring = new ScopeRing(4, SR);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let s = 0; s < 3 * SR; s += 1024) ring.write(Float32Array.from({ length: 1024 }, rand), s, 0);
  const start = 1234.5;
  const length = 2 * SR;
  const columns = 97;
  const trace = acquireTrace(ring, start, length, columns);
  const per = length / columns;
  for (let c = 0; c < columns; c++) {
    let lo = Infinity, hi = -Infinity;
    for (let s = Math.ceil(start + c * per); s <= Math.floor(start + (c + 1) * per); s++) {
      lo = Math.min(lo, ring.sample(s));
      hi = Math.max(hi, ring.sample(s));
    }
    assert.ok(trace.min[c] <= lo + 1e-6 && trace.max[c] >= hi - 1e-6, `column ${c}`);
  }
});

test('ring wraps and forgets samples older than its capacity', () => {
  const ring = new ScopeRing(0.1, SR);
  writeSine(ring, 100, 0.5, 0, SR);
  assert.equal(ring.endSample, SR);
  assert.equal(ring.sample(0), 0);
  assert.ok(ring.startSample > 0);
});
