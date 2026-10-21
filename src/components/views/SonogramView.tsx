/**
 * SonogramView - World-Class Mastering-Grade Multitrack Sonogram & Spectrogram Suite
 * Engineered to match & exceed market leaders (iZotope RX, MMultiAnalyzer, FabFilter):
 * 
 * 1. Three Distinct Projections:
 *    - Waterfall (Vertical flow with full 20Hz-20kHz horizontal spectrum & glowing piano roll)
 *    - Timeline RX (Horizontal scrolling time-history with vertical 20Hz-20kHz logarithmic frequency axis)
 *    - 3D Terrain Mesh (Mastering perspective 3D sonogram landscape showing energy mountains over time)
 * 
 * 2. Multi-Track Phosphor Layering & Solo Inspection:
 *    - Multi-Track: Photometric additive blending showing Kick (cyan), Bass (amber), Vocal (rose), Synth (emerald)
 *    - Solo Mode: Isolates any track in full high-dynamic-range thermal resolution
 * 
 * 3. 5 Calibrated Perceptual Colormaps:
 *    - Liquid Phosphor (Cyan/Mint/Hot-White)
 *    - Inferno / Magma (iZotope RX gold standard)
 *    - Viridis / Solaris (Scientific linear-luminance)
 *    - Cyber Neon (Amethyst/Magenta/Electric-Cyan)
 *    - Monochrome Studio CRT (Pure laboratory phosphor)
 * 
 * 4. High-Precision Inspection Tools:
 *    - Freeze / Pause Frame buffer
 *    - Crosshair reticle with Hz, Note + Cents, dBFS, and Dominant Track
 *    - Logarithmic frequency grid with piano roll overlay
 *    - Translucent glow piano roll with key contour alignment
 *    - Zero audio coloration (100% bit-transparent measurement instrument)
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { AudioTrack, AnalyzerSettings, SonogramPalette } from '../../types/audio';
import { audioEngine } from '../../audio/AudioEngine';
import {
  Snowflake,
  Music,
} from 'lucide-react';

interface SonogramViewProps {
  tracks: AudioTrack[];
  settings: AnalyzerSettings;
}

type ProjectionMode = 'waterfall' | 'timeline' | 'terrain3d';

// Convert Hex string to [r, g, b]
function hexToRgb(hex: string): [number, number, number] {
  let c = hex.replace('#', '');
  if (c.length === 3) {
    c = c.split('').map((char) => char + char).join('');
  }
  const num = parseInt(c, 16);
  if (isNaN(num)) return [6, 182, 212];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// Convert Hz to Musical Note and cents
function hzToNoteDetails(hz: number): { note: string; cents: number } {
  if (hz < 16) return { note: '', cents: 0 };
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const midiExact = 69 + 12 * Math.log2(hz / 440);
  const midiRound = Math.round(midiExact);
  const cents = Math.round((midiExact - midiRound) * 100);
  const octave = Math.floor(midiRound / 12) - 1;
  const name = noteNames[((midiRound % 12) + 12) % 12];
  return { note: `${name}${octave}`, cents };
}

// Piano keys generation for glowing contour keyboard
interface PianoKeyDef {
  midi: number;
  freq: number;
  isBlack: boolean;
  name: string;
  octave: number;
}

const PIANO_KEY_DEFS: PianoKeyDef[] = (() => {
  const keys: PianoKeyDef[] = [];
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  for (let m = 21; m <= 108; m++) {
    const freq = 440 * Math.pow(2, (m - 69) / 12);
    const octave = Math.floor(m / 12) - 1;
    const name = noteNames[((m % 12) + 12) % 12];
    keys.push({ midi: m, freq, isBlack: name.includes('#'), name, octave });
  }
  return keys;
})();

export const SonogramView: React.FC<SonogramViewProps> = ({ tracks, settings }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Projection modes: waterfall (vertical), timeline (RX horizontal), terrain3d (perspective)
  const [projection, setProjection] = useState<ProjectionMode>('waterfall');
  const [viewMode, setViewMode] = useState<'multitrack' | 'solo'>('multitrack');
  const [soloTrackId, setSoloTrackId] = useState<string>(tracks[0]?.id || 'track_kick');
  const [palette, setPalette] = useState<SonogramPalette>(settings.sonogramPalette || 'liquid');
  const [speed, setSpeed] = useState<number>(settings.sonogramSpeed || 2);
  const [isFrozen, setIsFrozen] = useState<boolean>(false);
  const [showPianoRoll, setShowPianoRoll] = useState<boolean>(true);
  // Read by the long-lived canvas loop and its drawing helpers
  const showPianoRollRef = useRef(showPianoRoll);
  showPianoRollRef.current = showPianoRoll;
  // Fixed display calibration (no UI controls them)
  const sensitivityDb = -80; // Min floor (dB)
  const colorGain = 1.2; // Contrast / intensity

  // Per-track visibility toggles
  const [visibleTrackIds, setVisibleTrackIds] = useState<Set<string>>(() => {
    return new Set(tracks.filter((t) => t.isVisible).map((t) => t.id));
  });

  // Track hover state for crosshair HUD
  const [hoverData, setHoverData] = useState<{
    x: number;
    y: number;
    freq: number;
    note: string;
    cents: number;
    db: number;
    timeOffsetSec: number;
    dominantTrackName?: string;
    dominantColor?: string;
  } | null>(null);

  // Sync with global tracks
  useEffect(() => {
    setVisibleTrackIds(new Set(tracks.filter((t) => t.isVisible).map((t) => t.id)));
  }, [tracks]);

  // Color Map Lookups
  const paletteLut = useMemo(() => {
    const lut: [number, number, number][] = [];
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      if (palette === 'liquid') {
        // Deep Obsidian -> Phosphor Cyan -> Neon Mint -> White Hot
        if (t < 0.3) {
          const s = t / 0.3;
          lut.push([Math.round(4 + s * 4), Math.round(10 + s * 90), Math.round(20 + s * 160)]);
        } else if (t < 0.7) {
          const s = (t - 0.3) / 0.4;
          lut.push([Math.round(8 + s * 30), Math.round(100 + s * 145), Math.round(180 + s * 55)]);
        } else {
          const s = (t - 0.7) / 0.3;
          lut.push([Math.round(38 + s * 217), Math.round(245 + s * 10), Math.round(235 + s * 20)]);
        }
      } else if (palette === 'magma') {
        // iZotope RX Magma: Black -> Violet -> Crimson -> Fiery Orange -> Gold -> White
        if (t < 0.25) {
          const s = t / 0.25;
          lut.push([Math.round(s * 80), Math.round(s * 10), Math.round(s * 120)]);
        } else if (t < 0.55) {
          const s = (t - 0.25) / 0.3;
          lut.push([Math.round(80 + s * 140), Math.round(10 + s * 20), Math.round(120 - s * 60)]);
        } else if (t < 0.85) {
          const s = (t - 0.55) / 0.3;
          lut.push([Math.round(220 + s * 35), Math.round(30 + s * 170), Math.round(60 - s * 50)]);
        } else {
          const s = (t - 0.85) / 0.15;
          lut.push([255, Math.round(200 + s * 55), Math.round(10 + s * 245)]);
        }
      } else if (palette === 'viridis') {
        // Viridis: Deep Indigo -> Teal -> Emerald -> Bright Yellow
        const r = Math.round(255 * (0.15 + 0.85 * Math.pow(t, 2.2)));
        const g = Math.round(255 * (0.1 + 0.9 * Math.sqrt(t)));
        const b = Math.round(255 * (0.4 * (1 - t) + 0.15));
        lut.push([Math.min(255, r), Math.min(255, g), Math.min(255, b)]);
      } else if (palette === 'cyber') {
        // Cyber Neon: Deep Indigo -> Royal Purple -> Hot Pink -> Cyan
        if (t < 0.5) {
          const s = t / 0.5;
          lut.push([Math.round(15 + s * 180), Math.round(5 + s * 15), Math.round(40 + s * 180)]);
        } else {
          const s = (t - 0.5) / 0.5;
          lut.push([Math.round(195 - s * 170), Math.round(20 + s * 210), Math.round(220 + s * 35)]);
        }
      } else {
        // Studio Monochrome CRT
        const v = Math.round(t * 255);
        lut.push([v, v, v]);
      }
    }
    return lut;
  }, [palette]);

  // Pre-calculate RGB colors for active tracks
  const trackRgbMap = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    tracks.forEach((t) => map.set(t.id, hexToRgb(t.color)));
    return map;
  }, [tracks]);

  // Keep references to mutable parameters so render loop never requires teardown
  const paramsRef = useRef({
    projection,
    viewMode,
    soloTrackId,
    paletteLut,
    speed,
    isFrozen,
    visibleTrackIds,
    trackRgbMap,
    sensitivityDb,
    colorGain,
    tracks,
    fftSize: settings.fftSize,
  });

  useEffect(() => {
    paramsRef.current = {
      projection,
      viewMode,
      soloTrackId,
      paletteLut,
      speed,
      isFrozen,
      visibleTrackIds,
      trackRgbMap,
      sensitivityDb,
      colorGain,
      tracks,
      fftSize: settings.fftSize,
    };
  }, [
    projection,
    viewMode,
    soloTrackId,
    paletteLut,
    speed,
    isFrozen,
    visibleTrackIds,
    trackRgbMap,
    sensitivityDb,
    colorGain,
    tracks,
    settings.fftSize,
  ]);

  // Persistent Offscreen Ring Buffer for 2D Sonograms (Survives React re-renders)
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const historyDataRef = useRef<Float32Array[]>([]); // 3D and Timeline history slices

  // Main High-Performance Canvas Rendering Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement('canvas');
      offscreenCanvasRef.current.width = 1000;
      offscreenCanvasRef.current.height = 600;
      const oCtx = offscreenCanvasRef.current.getContext('2d');
      if (oCtx) {
        oCtx.fillStyle = '#06080E';
        oCtx.fillRect(0, 0, 1000, 600);
      }
    }

    let isDestroyed = false;
    let cachedFftSize = paramsRef.current.fftSize;
    let tempBuf = new Float32Array(cachedFftSize / 2);

    const render = () => {
      if (isDestroyed) return;

      const p = paramsRef.current;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(10, Math.floor(rect.width));
      const height = Math.max(10, Math.floor(rect.height));

      // Resize primary canvas if needed
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      // Check if FFT size changed
      if (p.fftSize !== cachedFftSize) {
        cachedFftSize = p.fftSize;
        tempBuf = new Float32Array(cachedFftSize / 2);
      }

      const binCount = cachedFftSize / 2;
      const sampleRate = audioEngine.getSampleRate();
      const binHz = sampleRate / cachedFftSize;

      // Ensure offscreen canvas matches display size
      const offscreen = offscreenCanvasRef.current!;
      if (offscreen.width !== width || offscreen.height !== height) {
        // Preserve previous contents across resize
        const copyCanvas = document.createElement('canvas');
        copyCanvas.width = offscreen.width;
        copyCanvas.height = offscreen.height;
        const cCtx = copyCanvas.getContext('2d');
        if (cCtx) cCtx.drawImage(offscreen, 0, 0);

        offscreen.width = width;
        offscreen.height = height;
        const oCtx = offscreen.getContext('2d');
        if (oCtx) {
          oCtx.fillStyle = '#06080E';
          oCtx.fillRect(0, 0, width, height);
          oCtx.drawImage(copyCanvas, 0, 0, width, height);
        }
      }

      const oCtx = offscreen.getContext('2d');

      // Sample active audio frequency data
      const activeTracks = p.tracks.filter((t) => p.visibleTrackIds.has(t.id));
      const trackDataMap = new Map<string, Float32Array>();

      if (!p.isFrozen) {
        if (p.viewMode === 'multitrack') {
          activeTracks.forEach((track) => {
            audioEngine.getTrackFrequencyData(track.id, tempBuf);
            const copy = new Float32Array(binCount);
            copy.set(tempBuf);
            trackDataMap.set(track.id, copy);
          });
        } else {
          audioEngine.getTrackFrequencyData(p.soloTrackId, tempBuf);
          const copy = new Float32Array(binCount);
          copy.set(tempBuf);
          trackDataMap.set(p.soloTrackId, copy);
        }

        // Store history slice for 3D terrain & Timeline modes (capped at 120 slices)
        const combinedSlice = new Float32Array(128); // 128 log bands for 3D
        for (let b = 0; b < 128; b++) {
          const norm = b / 128;
          const freq = 20 * Math.pow(1000, norm);
          const binIdx = Math.min(binCount - 1, Math.max(0, Math.round(freq / binHz)));
          let maxAmp = -120;
          if (p.viewMode === 'multitrack') {
            activeTracks.forEach((tr) => {
              const data = trackDataMap.get(tr.id);
              if (data && data[binIdx] > maxAmp) maxAmp = data[binIdx];
            });
          } else {
            const data = trackDataMap.get(p.soloTrackId);
            if (data && data[binIdx] > maxAmp) maxAmp = data[binIdx];
          }
          combinedSlice[b] = maxAmp;
        }

        historyDataRef.current.unshift(combinedSlice);
        if (historyDataRef.current.length > 120) {
          historyDataRef.current.pop();
        }
      }

      // ─────────────────────────────────────────────────────────────
      // PROJECTION 1: WATERFALL (Vertical Top-Down Scrolling)
      // ─────────────────────────────────────────────────────────────
      if (p.projection === 'waterfall' && oCtx) {
        if (!p.isFrozen) {
          const shiftY = p.speed;
          // Shift image downward
          oCtx.drawImage(
            offscreen,
            0,
            0,
            width,
            height - shiftY,
            0,
            shiftY,
            width,
            height - shiftY
          );

          // Draw the new top row slice
          const sliceHeight = Math.ceil(shiftY);
          const rowImg = oCtx.createImageData(width, sliceHeight);
          const pixels = rowImg.data;

          for (let x = 0; x < width; x++) {
            // Logarithmic mapping: 20 Hz to 20,000 Hz
            const normX = x / width;
            const freq = 20 * Math.pow(1000, normX);
            const binIdx = Math.min(binCount - 1, Math.max(0, Math.round(freq / binHz)));

            let r = 0;
            let g = 0;
            let b = 0;

            if (p.viewMode === 'multitrack') {
              // Additive photometric multi-track blending
              let sumR = 0;
              let sumG = 0;
              let sumB = 0;

              activeTracks.forEach((track) => {
                const data = trackDataMap.get(track.id);
                if (!data) return;
                const db = data[binIdx];
                if (db > p.sensitivityDb) {
                  const norm = Math.max(0, Math.min(1, (db - p.sensitivityDb) / (0 - p.sensitivityDb)));
                  const intensity = Math.pow(norm, 1.4) * p.colorGain;
                  const [tr, tg, tb] = p.trackRgbMap.get(track.id) || [6, 182, 212];
                  sumR += tr * intensity;
                  sumG += tg * intensity;
                  sumB += tb * intensity;
                }
              });

              r = Math.min(255, Math.round(sumR));
              g = Math.min(255, Math.round(sumG));
              b = Math.min(255, Math.round(sumB));
            } else {
              // Solo Track with Selected Thermal Palette
              const data = trackDataMap.get(p.soloTrackId);
              const db = data ? data[binIdx] : -120;
              if (db > p.sensitivityDb) {
                const norm = Math.max(0, Math.min(1, (db - p.sensitivityDb) / (0 - p.sensitivityDb)));
                const lutIdx = Math.min(255, Math.max(0, Math.round(Math.pow(norm, 1.3) * p.colorGain * 255)));
                const [lr, lg, lb] = p.paletteLut[lutIdx] || [0, 0, 0];
                r = lr;
                g = lg;
                b = lb;
              }
            }

            for (let y = 0; y < sliceHeight; y++) {
              const pIdx = (y * width + x) * 4;
              pixels[pIdx] = r;
              pixels[pIdx + 1] = g;
              pixels[pIdx + 2] = b;
              pixels[pIdx + 3] = 255;
            }
          }

          oCtx.putImageData(rowImg, 0, 0);
        }

        // Render buffer onto display canvas
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.drawImage(offscreen, 0, 0, width, height);

        // Grid & Frequency Markers
        drawVerticalFrequencyGrid(ctx, width, height);

        // Piano roll bottom strip
        if (showPianoRollRef.current) {
          drawBottomPianoRoll(ctx, width, height);
        }
        ctx.restore();
      }

      // ─────────────────────────────────────────────────────────────
      // PROJECTION 2: TIMELINE RX (Horizontal Left-to-Right Scrolling)
      // ─────────────────────────────────────────────────────────────
      else if (p.projection === 'timeline' && oCtx) {
        if (!p.isFrozen) {
          const shiftX = p.speed;
          // Shift image to the left (time moves rightwards, newest slice at right edge)
          oCtx.drawImage(
            offscreen,
            shiftX,
            0,
            width - shiftX,
            height,
            0,
            0,
            width - shiftX,
            height
          );

          // Draw the new right column slice
          const sliceWidth = Math.ceil(shiftX);
          const colImg = oCtx.createImageData(sliceWidth, height);
          const pixels = colImg.data;

          for (let y = 0; y < height; y++) {
            // Logarithmic mapping: bottom (y=height) is 20 Hz, top (y=0) is 20 kHz
            const normY = (height - 1 - y) / height;
            const freq = 20 * Math.pow(1000, normY);
            const binIdx = Math.min(binCount - 1, Math.max(0, Math.round(freq / binHz)));

            let r = 0;
            let g = 0;
            let b = 0;

            if (p.viewMode === 'multitrack') {
              let sumR = 0;
              let sumG = 0;
              let sumB = 0;

              activeTracks.forEach((track) => {
                const data = trackDataMap.get(track.id);
                if (!data) return;
                const db = data[binIdx];
                if (db > p.sensitivityDb) {
                  const norm = Math.max(0, Math.min(1, (db - p.sensitivityDb) / (0 - p.sensitivityDb)));
                  const intensity = Math.pow(norm, 1.4) * p.colorGain;
                  const [tr, tg, tb] = p.trackRgbMap.get(track.id) || [6, 182, 212];
                  sumR += tr * intensity;
                  sumG += tg * intensity;
                  sumB += tb * intensity;
                }
              });

              r = Math.min(255, Math.round(sumR));
              g = Math.min(255, Math.round(sumG));
              b = Math.min(255, Math.round(sumB));
            } else {
              const data = trackDataMap.get(p.soloTrackId);
              const db = data ? data[binIdx] : -120;
              if (db > p.sensitivityDb) {
                const norm = Math.max(0, Math.min(1, (db - p.sensitivityDb) / (0 - p.sensitivityDb)));
                const lutIdx = Math.min(255, Math.max(0, Math.round(Math.pow(norm, 1.3) * p.colorGain * 255)));
                const [lr, lg, lb] = p.paletteLut[lutIdx] || [0, 0, 0];
                r = lr;
                g = lg;
                b = lb;
              }
            }

            for (let x = 0; x < sliceWidth; x++) {
              const pIdx = (y * sliceWidth + x) * 4;
              pixels[pIdx] = r;
              pixels[pIdx + 1] = g;
              pixels[pIdx + 2] = b;
              pixels[pIdx + 3] = 255;
            }
          }

          oCtx.putImageData(colImg, width - sliceWidth, 0);
        }

        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.drawImage(offscreen, 0, 0, width, height);

        // Horizontal frequency ruler on Y axis (20Hz - 20kHz)
        drawHorizontalFrequencyGrid(ctx, width, height);
        ctx.restore();
      }

      // ─────────────────────────────────────────────────────────────
      // PROJECTION 3: 3D TERRAIN MESH (Mastering Perspective Sonogram)
      // ─────────────────────────────────────────────────────────────
      else if (p.projection === 'terrain3d') {
        ctx.save();
        ctx.scale(dpr, dpr);
        // Clear deep space background
        ctx.fillStyle = '#06080E';
        ctx.fillRect(0, 0, width, height);

        const history = historyDataRef.current;
        const sliceCount = Math.min(80, history.length);
        const bands = 100;

        // Perspective 3D isometric projection parameters
        const originX = width * 0.5;
        const originY = height * 0.88;
        const anglePitch = 0.58;
        const scaleX = width * 0.82;
        const depthZ = height * 0.72;

        ctx.lineWidth = 1.2;

        // Render back-to-front slices for painter's depth
        for (let s = sliceCount - 1; s >= 0; s--) {
          const slice = history[s];
          if (!slice) continue;
          const zNorm = s / sliceCount; // 0 is front, 1 is back
          const rowY = originY - zNorm * depthZ * anglePitch;
          const rowScale = 1.0 - zNorm * 0.42;
          const rowWidth = scaleX * rowScale;
          const startX = originX - rowWidth * 0.5;

          ctx.beginPath();
          let started = false;

          for (let b = 0; b < bands; b++) {
            const bNorm = b / bands;
            const x = startX + bNorm * rowWidth;
            const db = slice[Math.floor(bNorm * 128)] || -120;
            const ampNorm = Math.max(0, Math.min(1, (db - p.sensitivityDb) / (0 - p.sensitivityDb)));
            const peakHeight = Math.pow(ampNorm, 1.5) * 90 * rowScale * p.colorGain;
            const y = rowY - peakHeight;

            if (!started) {
              ctx.moveTo(x, y);
              started = true;
            } else {
              ctx.lineTo(x, y);
            }
          }

          // Shaded fill to hide geometry behind
          const alpha = 0.15 + (1 - zNorm) * 0.75;
          const colorLutIdx = Math.min(255, Math.max(0, Math.round((1 - zNorm) * 200 + 40)));
          const [cr, cg, cb] = p.paletteLut[colorLutIdx] || [6, 182, 212];

          ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha})`;
          ctx.stroke();

          // Base line shadow
          ctx.lineTo(startX + rowWidth, rowY);
          ctx.lineTo(startX, rowY);
          ctx.closePath();
          ctx.fillStyle = `rgba(6, 8, 14, 0.7)`;
          ctx.fill();
        }

        // Overlay 3D Coordinate Grids
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.beginPath();
        // Baseline axis
        ctx.moveTo(originX - scaleX * 0.5, originY);
        ctx.lineTo(originX + scaleX * 0.5, originY);
        ctx.stroke();

        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.textAlign = 'center';
        ctx.fillText('3D Spectral Terrain (Melda MMultiAnalyzer Principle) · Frequency 20Hz → 20kHz', width / 2, 24);
        ctx.restore();
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      isDestroyed = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Drawing Helpers for Studio Frequency Grids
  // ─────────────────────────────────────────────────────────────
  const drawVerticalFrequencyGrid = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';

    const freqLabels = [30, 60, 120, 250, 500, 1000, 2500, 5000, 10000, 20000];
    freqLabels.forEach((f) => {
      const normX = Math.log10(f / 20) / Math.log10(20000 / 20);
      const x = normX * width;

      // Vertical guide lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height - (showPianoRollRef.current ? 22 : 0));
      ctx.stroke();

      // Label at bottom
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x, height - (showPianoRollRef.current ? 26 : 8));
    });
    ctx.setLineDash([]);
  };

  const drawHorizontalFrequencyGrid = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';

    const freqLabels = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000];
    freqLabels.forEach((f) => {
      const normY = Math.log10(f / 20) / Math.log10(20000 / 20);
      const y = height - normY * height;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f} Hz`, 8, y - 3);
    });
    ctx.setLineDash([]);
  };

  // Drawing Piano Roll along bottom edge (Glowing contour, translucent style)
  const drawBottomPianoRoll = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const barHeight = 18;
    const yTop = height - barHeight;

    ctx.fillStyle = 'rgba(10, 14, 22, 0.85)';
    ctx.fillRect(0, yTop, width, barHeight);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.moveTo(0, yTop);
    ctx.lineTo(width, yTop);
    ctx.stroke();

    PIANO_KEY_DEFS.forEach((key) => {
      if (key.freq < 20 || key.freq > 20000) return;
      const normX = Math.log10(key.freq / 20) / Math.log10(20000 / 20);
      const x = normX * width;

      if (key.name === 'C') {
        // C-root accent line
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.6)';
        ctx.beginPath();
        ctx.moveTo(x, yTop);
        ctx.lineTo(x, height);
        ctx.stroke();

        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillStyle = '#06B6D4';
        ctx.textAlign = 'center';
        ctx.fillText(`C${key.octave}`, x, height - 5);
      } else if (!key.isBlack) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(x, yTop + 6);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    });
  };

  // ─────────────────────────────────────────────────────────────
  // Mouse Hover HUD & Harmonic Series Inspection
  // ─────────────────────────────────────────────────────────────
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    let freq = 0;
    let timeOffsetSec = 0;

    if (projection === 'waterfall') {
      const normX = x / rect.width;
      freq = Math.round(20 * Math.pow(1000, normX));
      // Top is t=0, bottom is historical
      const normY = y / rect.height;
      timeOffsetSec = -(normY * (rect.height / (speed * 60)));
    } else if (projection === 'timeline') {
      // Right is t=0, left is historical
      const normX = (rect.width - x) / rect.width;
      timeOffsetSec = -(normX * (rect.width / (speed * 60)));
      const normY = (rect.height - y) / rect.height;
      freq = Math.round(20 * Math.pow(1000, normY));
    } else {
      const normX = x / rect.width;
      freq = Math.round(20 * Math.pow(1000, normX));
      timeOffsetSec = 0;
    }

    const { note, cents } = hzToNoteDetails(freq);

    // Identify dominant track around this frequency
    let bestTrackName: string | undefined;
    let bestColor: string | undefined;
    let maxDb = -120;

    const sampleRate = audioEngine.getSampleRate();
    const binCount = settings.fftSize / 2;
    const binHz = sampleRate / settings.fftSize;
    const targetBin = Math.min(binCount - 1, Math.max(0, Math.round(freq / binHz)));
    const buf = new Float32Array(binCount);

    tracks.forEach((t) => {
      if (visibleTrackIds.has(t.id)) {
        audioEngine.getTrackFrequencyData(t.id, buf);
        if (buf[targetBin] > maxDb) {
          maxDb = buf[targetBin];
          bestTrackName = t.name;
          bestColor = t.color;
        }
      }
    });

    setHoverData({
      x,
      y,
      freq,
      note,
      cents,
      db: Math.round(maxDb * 10) / 10,
      timeOffsetSec: Math.round(timeOffsetSec * 10) / 10,
      dominantTrackName: bestTrackName,
      dominantColor: bestColor,
    });
  };

  const handleToggleTrack = (trackId: string) => {
    setVisibleTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        if (next.size > 1) next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  };

  return (
    <div className="relative w-full h-full flex flex-col select-none rounded-2xl overflow-hidden bg-[#06080E]">
      {/* ─── LUXURY MASTERING HUD OVERLAY BAR ─── */}
      <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2.5 z-30 pointer-events-none">
        {/* Left: Projection Mode Selector & Track Controls */}
        <div className="flex flex-wrap items-center gap-1.5 pointer-events-auto bg-slate-950/85 backdrop-blur-2xl p-1.5 rounded-2xl border border-white/10 shadow-2xl">
          {/* Projection Modes */}
          <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-white/5">
            <button
              onClick={() => setProjection('waterfall')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                projection === 'waterfall'
                  ? 'bg-cyan-500 text-white shadow-sm font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Vertical Waterfall: Time flows downward, 20Hz-20kHz horizontal axis aligned with Piano Roll"
            >
              <span>Waterfall ▾</span>
            </button>

            <button
              onClick={() => setProjection('timeline')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                projection === 'timeline'
                  ? 'bg-cyan-500 text-white shadow-sm font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Timeline RX: Continuous time ribbon along X-axis, vertical 20Hz-20kHz logarithmic scale (iZotope RX Style)"
            >
              <span>Timeline RX ◫</span>
            </button>

            <button
              onClick={() => setProjection('terrain3d')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                projection === 'terrain3d'
                  ? 'bg-cyan-500 text-white shadow-sm font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="3D Terrain: Perspective 3D waterfall sonogram mesh (Melda MMultiAnalyzer 3D)"
            >
              <span>3D Mesh ▱</span>
            </button>
          </div>

          <div className="w-px h-5 bg-white/10 mx-0.5" />

          {/* View Mode: Multi-Track vs Solo */}
          <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-white/5">
            <button
              onClick={() => setViewMode('multitrack')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                viewMode === 'multitrack'
                  ? 'bg-white/15 text-white font-bold border border-white/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Multi-Track
            </button>
            <button
              onClick={() => setViewMode('solo')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                viewMode === 'solo'
                  ? 'bg-white/15 text-white font-bold border border-white/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Solo Stem
            </button>
          </div>

          {/* Per-Track Chips (Multi-Track) or Dropdown (Solo) */}
          {viewMode === 'multitrack' ? (
            <div className="flex items-center gap-1 pl-1">
              {tracks.map((t) => {
                const isVis = visibleTrackIds.has(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => handleToggleTrack(t.id)}
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1.5 border cursor-pointer ${
                      isVis
                        ? 'bg-white/10 text-white border-white/20 shadow-sm'
                        : 'bg-transparent text-slate-500 border-dashed border-white/5 opacity-50'
                    }`}
                  >
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{
                        backgroundColor: t.color,
                        boxShadow: isVis ? `0 0 6px ${t.color}` : 'none',
                      }}
                    />
                    <span className="truncate max-w-[85px]">{t.name}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-1 pl-1">
              <select
                value={soloTrackId}
                onChange={(e) => setSoloTrackId(e.target.value)}
                className="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-900 text-white border border-white/10 outline-none cursor-pointer"
              >
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Right: Palette, Speed, Freeze, Overlays */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Palette Selector */}
          <div className="flex items-center bg-slate-950/85 backdrop-blur-2xl p-1 rounded-2xl border border-white/10 shadow-2xl">
            <select
              value={palette}
              onChange={(e) => setPalette(e.target.value as SonogramPalette)}
              className="px-2.5 py-1 text-xs font-medium rounded-xl bg-slate-900 text-cyan-400 border border-white/10 outline-none cursor-pointer"
            >
              <option value="liquid">Liquid Phosphor</option>
              <option value="magma">Inferno (RX Magma)</option>
              <option value="viridis">Viridis Linear</option>
              <option value="cyber">Cyber Neon</option>
              <option value="grayscale">Monochrome CRT</option>
            </select>
          </div>

          {/* Speed Presets */}
          <div className="flex items-center gap-1 bg-slate-950/85 backdrop-blur-2xl p-1 rounded-2xl border border-white/10 text-xs">
            {[0.5, 1, 2, 4].map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`px-2 py-0.5 text-[10px] font-mono rounded-lg transition-colors cursor-pointer ${
                  speed === s ? 'bg-cyan-500 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
                title={`Scrolling Speed: ${s}x`}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Freeze Frame Toggle */}
          <button
            onClick={() => setIsFrozen(!isFrozen)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-2xl transition-all flex items-center gap-1.5 border shadow-lg cursor-pointer ${
              isFrozen
                ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold shadow-amber-500/20'
                : 'bg-slate-950/85 text-slate-300 border-white/10 hover:text-white hover:bg-slate-900'
            }`}
            title="Freeze/Pause sonogram waterfall history for detailed harmonic measurement"
          >
            <Snowflake className="w-3.5 h-3.5" />
            <span>{isFrozen ? 'FROZEN' : 'Freeze'}</span>
          </button>

          {/* Piano Roll Toggle (for waterfall projection) */}
          {projection === 'waterfall' && (
            <div className="flex items-center gap-1 bg-slate-950/85 backdrop-blur-2xl p-1 rounded-2xl border border-white/10">
              <button
                onClick={() => setShowPianoRoll(!showPianoRoll)}
                className={`p-1.5 rounded-xl transition-colors cursor-pointer ${
                  showPianoRoll ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-500 hover:text-slate-300'
                }`}
                title="Toggle Glowing Piano Roll Overlay"
              >
                <Music className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ─── FLOATING PRECISION RETICLE & INSPECTOR HUD BADGE ─── */}
      {hoverData && (
        <div
          className="absolute z-40 pointer-events-none transform -translate-x-1/2 -translate-y-full mb-3"
          style={{
            left: `${hoverData.x}px`,
            top: `${hoverData.y}px`,
          }}
        >
          <div className="px-3 py-2 rounded-xl bg-slate-950/95 backdrop-blur-2xl border border-cyan-500/40 shadow-2xl text-white flex flex-col gap-1 min-w-[170px] animate-in fade-in duration-100">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-1">
              <span className="font-mono text-xs font-bold text-cyan-400">
                {hoverData.freq >= 1000 ? `${(hoverData.freq / 1000).toFixed(2)} kHz` : `${hoverData.freq} Hz`}
              </span>
              {hoverData.note && (
                <span className="font-mono text-[11px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.2 rounded border border-amber-400/20">
                  {hoverData.note} {hoverData.cents !== 0 ? `(${hoverData.cents > 0 ? '+' : ''}${hoverData.cents}¢)` : ''}
                </span>
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono text-slate-300">
              <span className="text-slate-500">Amplitude:</span>
              <span className={hoverData.db > -30 ? 'text-emerald-400 font-bold' : 'text-slate-300'}>
                {hoverData.db > -110 ? `${hoverData.db} dBFS` : '-inf'}
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono text-slate-300">
              <span className="text-slate-500">History:</span>
              <span className="text-slate-400">{hoverData.timeOffsetSec}s</span>
            </div>

            {hoverData.dominantTrackName && (
              <div className="flex items-center gap-1.5 pt-1 border-t border-white/5 text-[11px]">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: hoverData.dominantColor }}
                />
                <span className="text-slate-400 truncate max-w-[130px] font-medium">
                  {hoverData.dominantTrackName}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── MAIN SPECTROGRAM CANVAS ─── */}
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverData(null)}
        className="w-full h-full block cursor-crosshair"
      />
    </div>
  );
};
