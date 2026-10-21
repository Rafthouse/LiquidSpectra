import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BS1770Meter } from './loudness.ts';

const SR = 48000;

function sine(freq: number, dbfs: number, seconds: number, phase = 0, sampleRate = SR): Float32Array {
  const amp = Math.pow(10, dbfs / 20);
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate + phase);
  return out;
}

function feed(meter: BS1770Meter, left: Float32Array, right: Float32Array = left, block = 1024): void {
  for (let i = 0; i < left.length; i += block) {
    meter.process([left.subarray(i, i + block), right.subarray(i, i + block)]);
  }
}

test('EBU Tech 3341 case 1: stereo 1 kHz sine at -23 dBFS reads -23 LUFS', () => {
  const meter = new BS1770Meter(SR);
  feed(meter, sine(1000, -23, 20));
  const r = meter.read();
  assert.ok(Math.abs(r.momentaryLufs + 23) <= 0.1, `M=${r.momentaryLufs}`);
  assert.ok(Math.abs(r.shortTermLufs + 23) <= 0.1, `S=${r.shortTermLufs}`);
  assert.ok(Math.abs(r.integratedLufs + 23) <= 0.1, `I=${r.integratedLufs}`);
});

test('K-weighting is sample-rate independent (44.1 kHz)', () => {
  const meter = new BS1770Meter(44100);
  feed(meter, sine(1000, -23, 10, 0, 44100));
  assert.ok(Math.abs(meter.read().integratedLufs + 23) <= 0.1);
});

test('EBU Tech 3341 case 3: relative gate ignores the quiet section', () => {
  // 10 s @ -36, 60 s @ -23, 10 s @ -36 dBFS  -> integrated -23.0 LUFS
  const meter = new BS1770Meter(SR);
  feed(meter, sine(1000, -36, 10));
  feed(meter, sine(1000, -23, 60));
  feed(meter, sine(1000, -36, 10));
  const r = meter.read();
  assert.ok(Math.abs(r.integratedLufs + 23) <= 0.1, `I=${r.integratedLufs}`);
});

test('absolute gate: silence never lowers integrated loudness', () => {
  const meter = new BS1770Meter(SR);
  feed(meter, sine(1000, -20, 10));
  feed(meter, new Float32Array(SR * 10));
  assert.ok(Math.abs(meter.read().integratedLufs + 20) <= 0.1);
});

test('EBU Tech 3342 case 1: LRA of -20/-30 dBFS steps is 10 LU', () => {
  const meter = new BS1770Meter(SR);
  feed(meter, sine(1000, -20, 20));
  feed(meter, sine(1000, -30, 20));
  const lra = meter.read().loudnessRangeLu;
  assert.ok(Math.abs(lra - 10) <= 1, `LRA=${lra}`);
});

test('true peak catches inter-sample overs that sample peak misses', () => {
  // fs/4 sine with 45 degree phase: every sample sits at 0.707 of the real peak
  const meter = new BS1770Meter(SR);
  const s = sine(SR / 4, 0, 1, Math.PI / 4);
  let samplePeak = 0;
  for (const v of s) samplePeak = Math.max(samplePeak, Math.abs(v));
  feed(meter, s);
  const tp = meter.read().truePeakDb;
  assert.ok(20 * Math.log10(samplePeak) < -2.9);
  assert.ok(tp > -0.6 && tp < 0.3, `TP=${tp}`);
});

test('true peak of a 1 kHz sine equals its amplitude', () => {
  const meter = new BS1770Meter(SR);
  feed(meter, sine(1000, -6, 1));
  const tp = meter.read().truePeakDb;
  assert.ok(Math.abs(tp + 6) <= 0.2, `TP=${tp}`);
});

test('reset clears every reading', () => {
  const meter = new BS1770Meter(SR);
  feed(meter, sine(1000, -10, 5));
  meter.reset();
  const r = meter.read();
  assert.equal(r.integratedLufs, -90);
  assert.equal(r.momentaryLufs, -90);
  assert.equal(r.truePeakDb, -90);
});
