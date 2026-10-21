/**
 * OscilloscopeView - Digital-phosphor multitrack oscilloscope
 * Rendering modelled on high-end DPO instruments:
 * - Every channel sampled on one absolute timeline with a sub-sample trigger and pre-trigger view,
 *   so periodic signals stand perfectly still instead of jittering
 * - Per-pixel min/max acquisition: no aliasing, no "averaged" scribble on long timebases
 * - Phosphor persistence with intensity grading (stable traces glow solid, unstable ones fade softly)
 * - Soft bloom from a down-sampled copy instead of per-path shadow blur
 * - Cached instrument graticule, auto vertical scale in 1-2-5 steps, calm on-screen readouts
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { AudioTrack, AnalyzerSettings } from '../../types/audio';
import { audioEngine, ScopeFrame } from '../../audio/AudioEngine';
import type { ScopeTrace } from '../../audio/scope';
import {
  Layers,
  Columns,
  Snowflake,
  Crosshair,
  Wand2,
  MoveVertical,
  Activity,
  AlertOctagon,
  Sparkles,
} from 'lucide-react';

interface OscilloscopeViewProps {
  tracks: AudioTrack[];
  settings: AnalyzerSettings;
}

type TriggerMode = 'trigger' | 'roll' | 'freeze';
type Persistence = 'off' | 'short' | 'medium' | 'long';
type VoltsPerDiv = 'auto' | number;

// Phosphor time constants (seconds)
const PERSISTENCE_TAU: Record<Persistence, number> = { off: 0, short: 0.06, medium: 0.18, long: 0.6 };

// Instrument graticule: 10 x 8 divisions, 5 minor ticks per division
const H_DIVS = 10;
const V_DIVS = 8;
const MINOR_TICKS = 5;
const PRE_TRIGGER = 0.1; // trigger point sits one division from the left edge

const VOLT_STEPS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1];

const TIMEBASE_PRESETS = [
  { ms: 1, label: '1ms' },
  { ms: 2, label: '2ms' },
  { ms: 5, label: '5ms' },
  { ms: 10, label: '10ms' },
  { ms: 25, label: '25ms' },
  { ms: 50, label: '50ms' },
  { ms: 100, label: '100ms' },
  { ms: 250, label: '250ms' },
  { ms: 500, label: '500ms' },
  { ms: 1000, label: '1.0s' },
  { ms: 2000, label: '2.0s' },
  { ms: 5000, label: '5.0s' },
  { ms: 10000, label: '10s' },
];

const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';

function formatVolts(v: number): string {
  const a = Math.abs(v);
  if (a >= 1) return `${v.toFixed(a >= 10 ? 0 : 2)} V`;
  if (a >= 0.001) return `${(v * 1000).toFixed(a >= 0.1 ? 0 : 1)} mV`;
  return '0 mV';
}

function formatTimePerDiv(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s/div`;
  if (ms >= 1) return `${ms.toFixed(ms >= 10 ? 0 : 1)} ms/div`;
  return `${(ms * 1000).toFixed(0)} µs/div`;
}

/** Smallest 1-2-5 step that keeps `peak` within ~85 % of the half-screen (4 divisions). */
function pickVoltStep(peak: number, current: number): number {
  const fits = (step: number) => peak <= step * 3.4;
  let idx = VOLT_STEPS.findIndex(fits);
  if (idx < 0) idx = VOLT_STEPS.length - 1;
  const curIdx = VOLT_STEPS.indexOf(current);
  // Hysteresis: zoom in only when the signal clearly fits a finer step
  if (curIdx > idx && peak > VOLT_STEPS[idx] * 2.6) return current;
  return VOLT_STEPS[idx];
}

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  const n = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colour lifted towards white for the hot beam core. */
function coreColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (v: number) => Math.round(v + (255 - v) * 0.55);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

interface PlotLane {
  trackId: string;
  color: string;
  name: string;
  top: number;
  height: number;
  centerY: number;
  pxPerVolt: number;
  voltsPerDiv: number;
}

interface Geometry {
  plotX: number;
  plotY: number;
  plotW: number;
  plotH: number;
  centerY: number;
  pxPerVolt: number;
}

/** Draws one trace in CSS-pixel coordinates (context already scaled by devicePixelRatio). */
function drawTrace(
  ctx: CanvasRenderingContext2D,
  trace: ScopeTrace,
  color: string,
  x0: number,
  width: number,
  centerY: number,
  pxPerVolt: number,
  alpha: number,
  minThickness: number
) {
  const columns = trace.min.length;
  if (columns < 2) return;
  const step = width / (columns - 1);

  ctx.globalAlpha = alpha;

  if (trace.isLine) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, centerY - trace.min[0] * pxPerVolt);
    for (let c = 1; c < columns; c++) ctx.lineTo(x0 + c * step, centerY - trace.min[c] * pxPerVolt);
    ctx.stroke();
    return;
  }

  // Min/max envelope as one vertical span per display column (digital-phosphor style).
  // Neighbouring columns share their boundary sample, so the spans join into a continuous
  // trace; axis-aligned rectangles also rasterise far faster than one self-intersecting band.
  ctx.fillStyle = color;
  ctx.beginPath();
  const half = step / 2;
  for (let c = 0; c < columns; c++) {
    let top = centerY - trace.max[c] * pxPerVolt;
    let height = (trace.max[c] - trace.min[c]) * pxPerVolt;
    if (height < minThickness) {
      top -= (minThickness - height) / 2;
      height = minThickness;
    }
    ctx.rect(x0 + c * step - half, top, step + 0.35, height);
  }
  ctx.fill();
}

export const OscilloscopeView: React.FC<OscilloscopeViewProps> = ({ tracks, settings }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [displayMode, setDisplayMode] = useState<'overlay' | 'lanes'>('overlay');
  const [timebaseMs, setTimebaseMs] = useState<number>(settings.oscilloscopeTimebaseMs || 10);
  const [triggerMode, setTriggerMode] = useState<TriggerMode>('trigger');
  const [triggerTrackId, setTriggerTrackId] = useState<string>(tracks[0]?.id ?? 'track_kick');
  const [triggerLevel, setTriggerLevel] = useState<number>(0.02);
  const [triggerEdge, setTriggerEdge] = useState<'rising' | 'falling'>('rising');
  const [showWaveClashes, setShowWaveClashes] = useState<boolean>(false);
  const [persistence, setPersistence] = useState<Persistence>('medium');
  const [voltsPerDiv, setVoltsPerDiv] = useState<VoltsPerDiv>('auto');

  const [isHoveringTrigger, setIsHoveringTrigger] = useState<boolean>(false);
  const [isDraggingTrigger, setIsDraggingTrigger] = useState<boolean>(false);
  const isDraggingTriggerRef = useRef<boolean>(false);

  const [phaseCoherence, setPhaseCoherence] = useState<number>(1);

  // Everything the long-lived render loop needs, without tearing it down on every change
  const paramsRef = useRef({
    tracks,
    displayMode,
    timebaseMs,
    triggerMode,
    triggerTrackId,
    triggerLevel,
    triggerEdge,
    showWaveClashes,
    persistence,
    voltsPerDiv,
    highlightTrigger: false,
  });
  paramsRef.current = {
    tracks,
    displayMode,
    timebaseMs,
    triggerMode,
    triggerTrackId,
    triggerLevel,
    triggerEdge,
    showWaveClashes,
    persistence,
    voltsPerDiv,
    highlightTrigger: isHoveringTrigger || isDraggingTrigger,
  };

  // Last drawn geometry, used by the pointer handlers to map Y <-> volts
  const geometryRef = useRef<Geometry>({ plotX: 0, plotY: 0, plotW: 1, plotH: 1, centerY: 0, pxPerVolt: 1 });

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (triggerMode !== 'freeze') {
        setPhaseCoherence(audioEngine.calculatePhaseAlignmentScore('track_kick', 'track_bass', 0));
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [triggerMode]);

  // ── Render loop (created once) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Off-screen layers: cached graticule, phosphor accumulation and a low-res bloom buffer
    const gridLayer = document.createElement('canvas');
    const phosphor = document.createElement('canvas');
    const glow = document.createElement('canvas');
    const gridCtx = gridLayer.getContext('2d')!;
    const phosphorCtx = phosphor.getContext('2d')!;
    const glowCtx = glow.getContext('2d')!;
    const supportsFilter = typeof glowCtx.filter === 'string';

    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    let gridKey = '';
    let lastTime = performance.now();
    let lastFrame: ScopeFrame | null = null;
    let lastPhosphorKey = '';

    // Vertical scale per lane: discrete 1-2-5 step chosen from a slowly decaying peak
    const scaleState = new Map<string, { step: number; peak: number }>();

    const resize = () => {
      const rect = container.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      cssW = Math.max(1, Math.floor(rect.width));
      cssH = Math.max(1, Math.floor(rect.height));
      const w = Math.round(cssW * dpr);
      const h = Math.round(cssH * dpr);
      for (const c of [canvas, gridLayer, phosphor]) {
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
      }
      const gw = Math.max(1, Math.round(w / 4));
      const gh = Math.max(1, Math.round(h / 4));
      if (glow.width !== gw || glow.height !== gh) {
        glow.width = gw;
        glow.height = gh;
      }
      gridKey = '';
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const drawGraticule = (plot: Geometry, lanes: PlotLane[]) => {
      gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gridCtx.clearRect(0, 0, cssW, cssH);

      // Deep screen with a faint centre lift, like a backlit instrument display
      const bg = gridCtx.createRadialGradient(cssW / 2, cssH / 2, 0, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.75);
      bg.addColorStop(0, '#0B1019');
      bg.addColorStop(1, '#04060A');
      gridCtx.fillStyle = bg;
      gridCtx.fillRect(0, 0, cssW, cssH);

      const { plotX, plotY, plotW, plotH } = plot;
      const divW = plotW / H_DIVS;
      const crisp = (v: number) => Math.round(v * dpr) / dpr + 0.5 / dpr;

      // Major divisions
      gridCtx.lineWidth = 1 / dpr;
      gridCtx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
      gridCtx.beginPath();
      for (let i = 1; i < H_DIVS; i++) {
        const x = crisp(plotX + i * divW);
        gridCtx.moveTo(x, plotY);
        gridCtx.lineTo(x, plotY + plotH);
      }
      for (const lane of lanes) {
        const divH = lane.height / V_DIVS;
        for (let i = 1; i < V_DIVS; i++) {
          if (i === V_DIVS / 2) continue;
          const y = crisp(lane.top + i * divH);
          gridCtx.moveTo(plotX, y);
          gridCtx.lineTo(plotX + plotW, y);
        }
      }
      gridCtx.stroke();

      // Centre axes with minor ticks
      gridCtx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
      gridCtx.beginPath();
      const midX = crisp(plotX + plotW / 2);
      gridCtx.moveTo(midX, plotY);
      gridCtx.lineTo(midX, plotY + plotH);
      for (const lane of lanes) {
        const y = crisp(lane.centerY);
        gridCtx.moveTo(plotX, y);
        gridCtx.lineTo(plotX + plotW, y);
        for (let i = 0; i <= H_DIVS * MINOR_TICKS; i++) {
          const x = crisp(plotX + (i * divW) / MINOR_TICKS);
          const len = i % MINOR_TICKS === 0 ? 5 : 3;
          gridCtx.moveTo(x, y - len);
          gridCtx.lineTo(x, y + len);
        }
        const divH = lane.height / V_DIVS;
        for (let i = 0; i <= V_DIVS * MINOR_TICKS; i++) {
          const yy = crisp(lane.top + (i * divH) / MINOR_TICKS);
          const len = i % MINOR_TICKS === 0 ? 5 : 3;
          gridCtx.moveTo(midX - len, yy);
          gridCtx.lineTo(midX + len, yy);
        }
      }
      gridCtx.stroke();

      // Lane separators and outer frame
      gridCtx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
      gridCtx.beginPath();
      for (let i = 1; i < lanes.length; i++) {
        const y = crisp(lanes[i].top);
        gridCtx.moveTo(plotX, y);
        gridCtx.lineTo(plotX + plotW, y);
      }
      gridCtx.stroke();
      gridCtx.strokeStyle = 'rgba(148, 163, 184, 0.26)';
      gridCtx.strokeRect(crisp(plotX), crisp(plotY), Math.round(plotW), Math.round(plotH));
    };

    const render = (now: number) => {
      const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      const p = paramsRef.current;

      // ── Layout ──
      const padX = 14;
      const padTop = 30;
      const padBottom = 34;
      const plot: Geometry = {
        plotX: padX,
        plotY: padTop,
        plotW: Math.max(10, cssW - padX * 2),
        plotH: Math.max(10, cssH - padTop - padBottom),
        centerY: padTop + Math.max(10, cssH - padTop - padBottom) / 2,
        pxPerVolt: 1,
      };

      const visible = p.tracks.filter((t) => t.isVisible);
      const laneCount = p.displayMode === 'lanes' ? Math.max(1, visible.length) : 1;
      const laneH = plot.plotH / laneCount;

      // ── Acquisition ──
      const frozen = p.triggerMode === 'freeze';
      if (!frozen) {
        lastFrame = audioEngine.getScopeFrame({
          trackIds: visible.map((t) => t.id),
          timebaseMs: p.timebaseMs,
          columns: Math.min(2048, Math.round(plot.plotW * dpr)),
          mode: p.triggerMode === 'trigger' ? 'trigger' : 'roll',
          triggerTrackId: p.triggerTrackId,
          triggerLevel: p.triggerLevel,
          triggerEdge: p.triggerEdge,
          preTrigger: PRE_TRIGGER,
        });
      }
      const frame = lastFrame;

      // ── Vertical scale (auto 1-2-5 with hysteresis; steps switch instantly like a real scope) ──
      const scaleFor = (key: string, peak: number): number => {
        let st = scaleState.get(key);
        if (!st) {
          st = { step: 0.1, peak: 0 };
          scaleState.set(key, st);
        }
        if (!frozen) st.peak = Math.max(peak, st.peak * Math.exp(-dt / 1.2));
        st.step = p.voltsPerDiv === 'auto' ? pickVoltStep(st.peak, st.step) : p.voltsPerDiv;
        return st.step;
      };

      const lanes: PlotLane[] = [];
      if (p.displayMode === 'lanes') {
        visible.forEach((t, i) => {
          const vpd = scaleFor(t.id, frame?.traces.get(t.id)?.peak ?? 0);
          const top = plot.plotY + i * laneH;
          lanes.push({
            trackId: t.id,
            color: t.color,
            name: t.name,
            top,
            height: laneH,
            centerY: top + laneH / 2,
            pxPerVolt: laneH / V_DIVS / vpd,
            voltsPerDiv: vpd,
          });
        });
      } else {
        let peak = 0;
        frame?.traces.forEach((tr) => (peak = Math.max(peak, tr.peak)));
        const vpd = scaleFor('overlay', peak);
        visible.forEach((t) =>
          lanes.push({
            trackId: t.id,
            color: t.color,
            name: t.name,
            top: plot.plotY,
            height: plot.plotH,
            centerY: plot.centerY,
            pxPerVolt: plot.plotH / V_DIVS / vpd,
            voltsPerDiv: vpd,
          })
        );
      }
      if (lanes.length === 0) {
        lanes.push({
          trackId: '',
          color: '#64748B',
          name: '',
          top: plot.plotY,
          height: plot.plotH,
          centerY: plot.centerY,
          pxPerVolt: plot.plotH / V_DIVS / 0.1,
          voltsPerDiv: 0.1,
        });
      }
      plot.pxPerVolt = lanes[0].pxPerVolt;
      geometryRef.current = plot;

      // ── Graticule (re-rendered only when the layout changes) ──
      const laneKey = `${p.displayMode}|${lanes.length}`;
      const key = `${cssW}x${cssH}@${dpr}|${laneKey}`;
      // Old light drawn at another scale or timebase would be misleading: start a fresh screen
      const phosphorKey = `${key}|${p.timebaseMs}|${p.triggerMode}|${lanes.map((l) => l.voltsPerDiv).join(',')}`;
      if (key !== gridKey) {
        drawGraticule(plot, p.displayMode === 'lanes' ? lanes : [lanes[0]]);
        gridKey = key;
      }
      if (phosphorKey !== lastPhosphorKey && !frozen) {
        phosphorCtx.setTransform(1, 0, 0, 1, 0, 0);
        phosphorCtx.clearRect(0, 0, phosphor.width, phosphor.height);
        lastPhosphorKey = phosphorKey;
      }

      // ── Phosphor layer: fade old light, add the new acquisition ──
      // A scrolling (roll) display would smear under persistence, so it always draws fresh
      const tau = p.triggerMode === 'roll' ? 0 : PERSISTENCE_TAU[p.persistence];
      phosphorCtx.setTransform(1, 0, 0, 1, 0, 0);
      if (!frozen) {
        if (tau === 0) {
          phosphorCtx.clearRect(0, 0, phosphor.width, phosphor.height);
        } else {
          phosphorCtx.globalCompositeOperation = 'destination-out';
          phosphorCtx.globalAlpha = 1;
          phosphorCtx.fillStyle = `rgba(0, 0, 0, ${1 - Math.exp(-dt / tau)})`;
          phosphorCtx.fillRect(0, 0, phosphor.width, phosphor.height);
        }

        if (frame) {
          const drawAlpha = tau === 0 ? 1 : Math.min(1, Math.max(0.07, 1.8 * (1 - Math.exp(-dt / tau))));
          phosphorCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          // Normal "over" blending: repeated passes of a stable trace build up to full brightness
          // (intensity grading), while overlapping channels keep their own colour instead of
          // summing to white as additive blending would
          phosphorCtx.globalCompositeOperation = 'source-over';
          phosphorCtx.save();
          phosphorCtx.beginPath();
          phosphorCtx.rect(plot.plotX, plot.plotY, plot.plotW, plot.plotH);
          phosphorCtx.clip();
          for (const lane of lanes) {
            const trace = frame.traces.get(lane.trackId);
            if (!trace) continue;
            drawTrace(phosphorCtx, trace, lane.color, plot.plotX, plot.plotW, lane.centerY, lane.pxPerVolt, drawAlpha, 1.4);
          }
          phosphorCtx.restore();
          phosphorCtx.globalAlpha = 1;
          phosphorCtx.globalCompositeOperation = 'source-over';
        }
      }

      // ── Compose: graticule → bloom → phosphor → hot beam core ──
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(gridLayer, 0, 0);

      glowCtx.setTransform(1, 0, 0, 1, 0, 0);
      glowCtx.clearRect(0, 0, glow.width, glow.height);
      if (supportsFilter) glowCtx.filter = 'blur(2px)';
      glowCtx.imageSmoothingQuality = 'high';
      glowCtx.drawImage(phosphor, 0, 0, glow.width, glow.height);
      if (supportsFilter) glowCtx.filter = 'none';

      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingQuality = 'high';
      ctx.globalAlpha = 0.6;
      ctx.drawImage(glow, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(phosphor, 0, 0);
      ctx.globalCompositeOperation = 'lighter';

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (frame) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(plot.plotX, plot.plotY, plot.plotW, plot.plotH);
        ctx.clip();
        for (const lane of lanes) {
          const trace = frame.traces.get(lane.trackId);
          if (!trace || !trace.isLine) continue;
          ctx.strokeStyle = coreColor(lane.color);
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 0.75;
          ctx.lineJoin = 'round';
          const columns = trace.min.length;
          const step = plot.plotW / (columns - 1);
          ctx.beginPath();
          ctx.moveTo(plot.plotX, lane.centerY - trace.max[0] * lane.pxPerVolt);
          for (let c = 1; c < columns; c++) ctx.lineTo(plot.plotX + c * step, lane.centerY - trace.max[c] * lane.pxPerVolt);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      // ── Waveform clash markers (overlay mode, first two channels) ──
      if (p.showWaveClashes && frame && p.displayMode === 'overlay' && lanes.length >= 2) {
        const a = frame.traces.get(lanes[0].trackId);
        const b = frame.traces.get(lanes[1].trackId);
        if (a && b) {
          const columns = a.max.length;
          const step = plot.plotW / (columns - 1);
          const stride = Math.max(1, Math.round(columns / 90));
          for (let c = stride; c < columns - stride; c += stride) {
            const va = (a.min[c] + a.max[c]) / 2;
            const vb = (b.min[c] + b.max[c]) / 2;
            const strong = Math.abs(va) > 0.6 * lanes[0].voltsPerDiv && Math.abs(vb) > 0.6 * lanes[0].voltsPerDiv;
            if (!strong) continue;
            const opposing = va * vb < 0;
            const meeting = Math.abs(va - vb) < 0.15 * lanes[0].voltsPerDiv;
            if (!opposing && !meeting) continue;
            ctx.strokeStyle = opposing ? 'rgba(244, 63, 94, 0.75)' : 'rgba(245, 158, 11, 0.75)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(plot.plotX + c * step, plot.centerY - ((va + vb) / 2) * plot.pxPerVolt, 4.5, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }

      // ── Ground reference tabs ──
      ctx.font = `600 9px ${MONO_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tabs = p.displayMode === 'lanes' ? lanes : lanes.slice(0, 1);
      tabs.forEach((lane, i) => {
        const y = lane.centerY;
        ctx.fillStyle = p.displayMode === 'lanes' ? lane.color : '#94A3B8';
        ctx.beginPath();
        ctx.moveTo(plot.plotX - 12, y - 6);
        ctx.lineTo(plot.plotX - 4, y - 6);
        ctx.lineTo(plot.plotX, y);
        ctx.lineTo(plot.plotX - 4, y + 6);
        ctx.lineTo(plot.plotX - 12, y + 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#05070D';
        ctx.fillText(p.displayMode === 'lanes' ? String(i + 1) : '0', plot.plotX - 7, y + 0.5);
        if (p.displayMode === 'lanes') {
          ctx.textAlign = 'left';
          ctx.font = `600 10px ${MONO_FONT}`;
          ctx.fillStyle = lane.color;
          ctx.fillText(lane.name, plot.plotX + 8, lane.top + 12);
          ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
          ctx.fillText(`${formatVolts(lane.voltsPerDiv)}/div`, plot.plotX + 8, lane.top + 26);
          ctx.textAlign = 'center';
          ctx.font = `600 9px ${MONO_FONT}`;
        }
      });

      // ── Trigger: position pennant on top, level line with handle on the right ──
      if (p.triggerMode === 'trigger') {
        const tx = plot.plotX + plot.plotW * PRE_TRIGGER;
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.moveTo(tx - 6, plot.plotY - 12);
        ctx.lineTo(tx + 6, plot.plotY - 12);
        ctx.lineTo(tx + 6, plot.plotY - 5);
        ctx.lineTo(tx, plot.plotY);
        ctx.lineTo(tx - 6, plot.plotY - 5);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#05070D';
        ctx.fillText('T', tx, plot.plotY - 8);

        if (p.displayMode === 'overlay') {
          const ty = plot.centerY - p.triggerLevel * plot.pxPerVolt;
          if (ty >= plot.plotY && ty <= plot.plotY + plot.plotH) {
            ctx.strokeStyle = p.highlightTrigger ? 'rgba(251, 191, 36, 0.85)' : 'rgba(245, 158, 11, 0.38)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 5]);
            ctx.beginPath();
            ctx.moveTo(plot.plotX, Math.round(ty) + 0.5);
            ctx.lineTo(plot.plotX + plot.plotW, Math.round(ty) + 0.5);
            ctx.stroke();
            ctx.setLineDash([]);

            const hx = plot.plotX + plot.plotW;
            ctx.fillStyle = p.highlightTrigger ? '#FBBF24' : '#F59E0B';
            ctx.beginPath();
            ctx.moveTo(hx + 12, ty - 6);
            ctx.lineTo(hx + 4, ty - 6);
            ctx.lineTo(hx, ty);
            ctx.lineTo(hx + 4, ty + 6);
            ctx.lineTo(hx + 12, ty + 6);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#05070D';
            ctx.fillText('T', hx + 7.5, ty + 0.5);
          }
        }
      }

      // ── Status and scale readouts (top) ──
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const status = frozen
        ? { text: 'STOP', color: '#F43F5E' }
        : p.triggerMode === 'roll'
        ? { text: 'ROLL', color: '#38BDF8' }
        : frame?.triggered
        ? { text: "TRIG'D", color: '#34D399' }
        : { text: 'AUTO', color: '#F59E0B' };
      ctx.font = `700 9.5px ${MONO_FONT}`;
      const statusW = ctx.measureText(status.text).width + 14;
      ctx.fillStyle = `${status.color}22`;
      ctx.strokeStyle = `${status.color}88`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(plot.plotX, 8, statusW, 16, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = status.color;
      ctx.fillText(status.text, plot.plotX + 7, 16.5);

      ctx.font = `500 10px ${MONO_FONT}`;
      ctx.fillStyle = 'rgba(203, 213, 225, 0.85)';
      ctx.textAlign = 'right';
      const sr = audioEngine.getSampleRate();
      ctx.fillText(
        `${formatTimePerDiv(p.timebaseMs / H_DIVS)}   ${(sr / 1000).toFixed(1)} kSa/s`,
        plot.plotX + plot.plotW,
        16.5
      );

      // ── Channel readouts (bottom strip) ──
      ctx.textAlign = 'left';
      let cx = plot.plotX;
      const by = cssH - padBottom / 2 + 1;
      visible.forEach((t, i) => {
        const trace = frame?.traces.get(t.id);
        const lane = lanes.find((l) => l.trackId === t.id);
        const vpp = trace ? Math.max(...trace.max) - Math.min(...trace.min) : 0;
        const label = `${i + 1}  ${t.name}`;
        const value = `${formatVolts(lane?.voltsPerDiv ?? 0)}/div  ${formatVolts(vpp)}pp`;
        ctx.font = `600 10px ${MONO_FONT}`;
        const lw = ctx.measureText(label).width;
        ctx.font = `500 10px ${MONO_FONT}`;
        const vw = ctx.measureText(value).width;
        const w = lw + vw + 26;
        if (cx + w > plot.plotX + plot.plotW) return;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
        ctx.beginPath();
        ctx.roundRect(cx, by - 10, w, 20, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = t.color;
        ctx.fillRect(cx, by - 10, 3, 20);
        ctx.font = `600 10px ${MONO_FONT}`;
        ctx.fillText(label, cx + 10, by + 0.5);
        ctx.font = `500 10px ${MONO_FONT}`;
        ctx.fillStyle = 'rgba(203, 213, 225, 0.8)';
        ctx.fillText(value, cx + 18 + lw, by + 0.5);
        cx += w + 8;
      });

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);
    return () => {
      observer.disconnect();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // ── Trigger level interaction (overlay mode) ──
  const yToVoltage = useCallback((y: number): number => {
    const g = geometryRef.current;
    const v = (g.centerY - y) / g.pxPerVolt;
    const limit = (g.plotH / 2) / g.pxPerVolt;
    return Math.max(-limit, Math.min(limit, v));
  }, []);

  const isNearTrigger = (e: React.PointerEvent<HTMLCanvasElement>): boolean => {
    if (triggerMode !== 'trigger' || displayMode !== 'overlay') return false;
    const rect = e.currentTarget.getBoundingClientRect();
    const g = geometryRef.current;
    const y = e.clientY - rect.top;
    const x = e.clientX - rect.left;
    const ty = g.centerY - triggerLevel * g.pxPerVolt;
    return Math.abs(y - ty) <= 8 || (x >= g.plotX + g.plotW - 24 && Math.abs(y - ty) <= 14);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isNearTrigger(e)) return;
    isDraggingTriggerRef.current = true;
    setIsDraggingTrigger(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDraggingTriggerRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      setTriggerLevel(yToVoltage(e.clientY - rect.top));
    } else {
      const near = isNearTrigger(e);
      if (near !== isHoveringTrigger) setIsHoveringTrigger(near);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingTriggerRef.current) return;
    isDraggingTriggerRef.current = false;
    setIsDraggingTrigger(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Capture already released
    }
  };

  const handleAutoTriggerLevel = () => {
    const peak = audioEngine.getTrackPeak(triggerTrackId);
    const target =
      triggerEdge === 'rising'
        ? Math.max(0.002, peak.peakPos * 0.5)
        : Math.min(-0.002, peak.peakNeg * 0.5);
    setTriggerLevel(Math.round(target * 1000) / 1000);
  };

  const segmentClass = (active: boolean, activeClass: string) =>
    `px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-all cursor-pointer ${
      active ? activeClass : 'text-slate-400 hover:text-white'
    }`;

  return (
    <div className="w-full h-full flex flex-col gap-2 select-none overflow-hidden">
      {/* Control ribbon */}
      <div className="p-2.5 rounded-xl bg-slate-950/85 backdrop-blur-xl border border-white/10 shadow-sm flex flex-col gap-2 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-0.5 bg-slate-900 p-0.5 rounded-lg border border-white/10">
              <button onClick={() => setDisplayMode('overlay')} className={segmentClass(displayMode === 'overlay', 'bg-slate-700 text-cyan-400 shadow-sm font-bold')}>
                <Layers className="w-3.5 h-3.5" />
                Overlay
              </button>
              <button onClick={() => setDisplayMode('lanes')} className={segmentClass(displayMode === 'lanes', 'bg-slate-700 text-cyan-400 shadow-sm font-bold')}>
                <Columns className="w-3.5 h-3.5" />
                Lanes
              </button>
            </div>

            <div className="flex items-center gap-0.5 bg-slate-900 p-0.5 rounded-lg border border-white/10">
              <button onClick={() => setTriggerMode('trigger')} className={segmentClass(triggerMode === 'trigger', 'bg-amber-500 text-black font-bold shadow-sm')}>
                <Crosshair className="w-3.5 h-3.5" />
                Sync (Edge)
              </button>
              <button onClick={() => setTriggerMode('roll')} className={segmentClass(triggerMode === 'roll', 'bg-cyan-500 text-slate-950 font-bold shadow-sm')}>
                Roll
              </button>
              <button onClick={() => setTriggerMode('freeze')} className={segmentClass(triggerMode === 'freeze', 'bg-rose-500 text-white font-bold shadow-sm')}>
                <Snowflake className="w-3.5 h-3.5" />
                Stop
              </button>
            </div>

            <button
              onClick={() => setShowWaveClashes(!showWaveClashes)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer border ${
                showWaveClashes
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                  : 'bg-slate-900 text-slate-400 border-white/10 hover:text-white'
              }`}
              title="Позначати точки, де дві перші доріжки зустрічаються або йдуть у протифазі"
            >
              <AlertOctagon className="w-3.5 h-3.5 text-amber-400" />
              <span>{showWaveClashes ? 'Конфлікти хвиль: УВІМК' : 'Оригінальна хвиля'}</span>
            </button>
          </div>

          {triggerMode === 'trigger' && (
            <div className="flex items-center gap-2 flex-wrap bg-amber-500/10 px-2.5 py-1 rounded-xl border border-amber-500/20">
              <div className="flex items-center gap-1 text-xs">
                <span className="text-[10px] uppercase font-mono font-bold text-amber-500">Source:</span>
                <select
                  value={triggerTrackId}
                  onChange={(e) => setTriggerTrackId(e.target.value)}
                  className="w-32 px-2 py-1 text-xs font-semibold rounded-lg bg-slate-800 text-white border border-white/10 outline-none cursor-pointer truncate"
                >
                  {tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => setTriggerEdge(triggerEdge === 'rising' ? 'falling' : 'rising')}
                className={`w-24 justify-center px-2 py-1 text-xs font-mono font-bold rounded-lg flex items-center gap-1 transition-colors cursor-pointer shrink-0 ${
                  triggerEdge === 'rising' ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-300'
                }`}
                title="Фронт тригера: наростання ↗ або спад ↘"
              >
                {triggerEdge === 'rising' ? 'Rising ↗' : 'Falling ↘'}
              </button>
              <div className="flex items-center gap-1.5 pl-1 border-l border-amber-500/20 shrink-0">
                <span className="text-[10px] uppercase font-mono font-bold text-amber-500">Level:</span>
                <span className="w-16 text-center font-mono text-xs font-bold text-amber-400 tabular-nums inline-block">
                  {formatVolts(triggerLevel)}
                </span>
              </div>
              <button
                onClick={handleAutoTriggerLevel}
                className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 transition-all flex items-center gap-1 cursor-pointer shrink-0"
                title="Рівень тригера = 50 % піку джерела"
              >
                <Wand2 className="w-3 h-3" />
                Auto 50%
              </button>
              <button
                onClick={() => setTriggerLevel(0)}
                className="px-1.5 py-1 text-[10px] font-mono rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer shrink-0"
                title="Тригер на перетині нуля"
              >
                0 V
              </button>
            </div>
          )}

          <div className="w-52 flex items-center gap-2.5 shrink-0 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-white/10 shadow-lg">
            <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[9px] uppercase font-mono font-bold text-slate-400 tracking-wider truncate">Kick/Bass Phase</span>
              <div className="flex items-center gap-2">
                <span
                  className={`w-14 inline-block font-mono text-xs font-bold tabular-nums shrink-0 ${
                    phaseCoherence > 0.6 ? 'text-emerald-400' : phaseCoherence > 0.2 ? 'text-amber-400' : 'text-rose-400'
                  }`}
                >
                  {phaseCoherence > 0 ? '+' : ''}
                  {(phaseCoherence * 100).toFixed(0)}%
                </span>
                <span className="w-24 inline-block text-left text-[10px] font-semibold text-slate-400 truncate shrink-0">
                  {phaseCoherence > 0.6 ? 'In Phase' : phaseCoherence > 0.2 ? 'Partial' : 'Phase Cancel!'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5 mr-1">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              Timebase
            </span>
            {TIMEBASE_PRESETS.map((p) => {
              const isSelected = Math.abs(timebaseMs - p.ms) < 0.5;
              return (
                <button
                  key={p.ms}
                  onClick={() => setTimebaseMs(p.ms)}
                  className={`px-2 py-1 text-[11px] font-mono rounded-md transition-all cursor-pointer border ${
                    isSelected
                      ? 'bg-cyan-500 text-slate-950 font-bold border-cyan-400'
                      : 'bg-slate-900 text-slate-400 border-white/5 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 flex-wrap shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase font-mono font-bold text-slate-500">V/div</span>
              <select
                value={voltsPerDiv === 'auto' ? 'auto' : String(voltsPerDiv)}
                onChange={(e) => setVoltsPerDiv(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}
                className="px-2 py-1 text-xs font-mono font-semibold rounded-lg bg-slate-900 text-white border border-white/10 outline-none cursor-pointer"
                title="Вертикальна шкала: Auto підбирає крок 1-2-5 під сигнал"
              >
                <option value="auto">Auto</option>
                {VOLT_STEPS.map((v) => (
                  <option key={v} value={String(v)}>
                    {formatVolts(v)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase font-mono font-bold text-slate-500">Persistence</span>
              <div className="flex items-center gap-0.5 bg-slate-900 p-0.5 rounded-lg border border-white/10">
                {(['off', 'short', 'medium', 'long'] as Persistence[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setPersistence(mode)}
                    className={`px-2 py-0.5 text-[11px] font-mono rounded-md transition-all cursor-pointer ${
                      persistence === mode ? 'bg-slate-700 text-cyan-300 font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                    title="Післясвічення люмінофора: довше = м'якше, стабільні сигнали світяться яскравіше"
                  >
                    {mode === 'off' ? 'Off' : mode === 'short' ? 'Short' : mode === 'medium' ? 'Med' : 'Long'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Display */}
      <div
        ref={containerRef}
        className={`relative flex-1 min-h-0 rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-[#04060A] ${
          isHoveringTrigger || isDraggingTrigger ? 'cursor-ns-resize' : 'cursor-crosshair'
        }`}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={() => !isDraggingTriggerRef.current && setIsHoveringTrigger(false)}
          onDoubleClick={() => triggerMode === 'trigger' && setTriggerLevel(0)}
          className="absolute inset-0 w-full h-full block touch-none"
        />
        {isDraggingTrigger && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 pointer-events-none px-3 py-1 rounded-full bg-amber-500 text-black font-mono text-xs font-bold shadow-lg flex items-center gap-1.5">
            <MoveVertical className="w-3.5 h-3.5" />
            <span>TRIGGER LEVEL: {formatVolts(triggerLevel)}</span>
          </div>
        )}
      </div>
    </div>
  );
};
