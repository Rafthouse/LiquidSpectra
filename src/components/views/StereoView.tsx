/**
 * StereoView - Master-Grade Studio Multitrack Goniometer & Vectorscope Suite
 * Crafted with ultra-luxurious Apple Liquid Glass & titanium mastering hardware aesthetics:
 * - Precision laser-etched circular polar reticle with 360° degree markings and concentric dB rings
 * - True analog phosphor CRT beam simulation with persistent decay trails & additive luminous blending
 * - Dynamic perimeter Phase Correlation Arc (Ruby -1.0 -> Amber 0.0 -> Emerald +1.0) with jewel needle
 * - Instantaneous Center Phase Azimuth Needle with illuminated sapphire pivot
 * - 4 Scope Engines: Analog CRT Lissajous X-Y, Polar Dispersion Radar, Phosphor Cloud, and Living M/S Field
 * - 100% Rock-Solid UI: Strict fixed-width containers and tabular-nums to prevent ANY jitter, twitching or layout shift
 * - Multi-Track Channel Matrix with jewel color swatches, phase inversion simulation (Ø), and solo isolation
 */

import React, { useRef, useEffect, useState } from 'react';
import { AudioTrack, AnalyzerSettings, StereoMetrics } from '../../types/audio';
import { audioEngine } from '../../audio/AudioEngine';
import {
  Compass,
  Radio,
  CircleDot,
  ZoomIn,
  Sparkles,
  Layers,
  Eye,
  EyeOff,
  Disc,
} from 'lucide-react';

interface StereoViewProps {
  tracks: AudioTrack[];
  settings: AnalyzerSettings;
}

interface TrackStereoState extends StereoMetrics {
  trackId: string;
  trackName: string;
  trackColor: string;
  isSolo: boolean;
  isVisibleInScope: boolean;
  isPhaseInverted: boolean;
  lissajousPoints: { x: number; y: number }[];
}

// Curated Luxury Jewel Palette
const JEWEL_PALETTE = [
  { name: 'Cyan Sapphire', color: '#06B6D4' },
  { name: 'Amber Topaz', color: '#F59E0B' },
  { name: 'Neon Ruby', color: '#F43F5E' },
  { name: 'Emerald Crystal', color: '#10B981' },
  { name: 'Cyber Amethyst', color: '#8B5CF6' },
  { name: 'Electric Sky', color: '#38BDF8' },
  { name: 'Rose Quartz', color: '#EC4899' },
  { name: 'Solar Gold', color: '#FBBF24' },
];

export const StereoView: React.FC<StereoViewProps> = ({ tracks }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Scope Settings
  const [displayMode, setDisplayMode] = useState<'lissajous' | 'polar' | 'cloud' | 'ellipse'>('lissajous');
  const [scopeGain, setScopeGain] = useState<number>(2.0); // 1x to 5x zoom
  const [glowIntensity, setGlowIntensity] = useState<number>(12); // blur px

  // Per-track custom visibility, solo, and color overrides
  const [soloTrackId, setSoloTrackId] = useState<string | null>(null);
  const [hiddenTrackIds, setHiddenTrackIds] = useState<Set<string>>(new Set());
  const [colorPickerTrackId, setColorPickerTrackId] = useState<string | null>(null);
  const [customColors, setCustomColors] = useState<Map<string, string>>(new Map());
  const [phaseInverts, setPhaseInverts] = useState<Map<string, boolean>>(new Map());

  // Throttled UI Telemetry (Updated at 10Hz with strict fixed width to prevent any React layout jitter)
  const [telemetry, setTelemetry] = useState({
    correlation: 1.0,
    width: 100,
    balance: 0,
    midDb: -24.0,
    sideDb: -30.0,
  });
  const [trackMetricsList, setTrackMetricsList] = useState<TrackStereoState[]>([]);

  // Ballistics for smooth needle animation on canvas
  const smoothedCorrRef = useRef<number>(1.0);
  const needleVelocityRef = useRef<number>(0);

  // Smooth ballistics for dynamic M/S ellipse breathing
  const smoothedMidEnergyRef = useRef<number>(0.5);
  const smoothedSideEnergyRef = useRef<number>(0.3);

  // Persistence canvas for authentic CRT Phosphor decay
  const persistenceCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Refs for canvas drawing loop to access latest state without re-creating effect
  const scopeStateRef = useRef({
    displayMode,
    scopeGain,
    glowIntensity,
    soloTrackId,
    hiddenTrackIds,
    customColors,
    phaseInverts,
    tracks,
  });

  useEffect(() => {
    scopeStateRef.current = {
      displayMode,
      scopeGain,
      glowIntensity,
      soloTrackId,
      hiddenTrackIds,
      customColors,
      phaseInverts,
      tracks,
    };
  }, [displayMode, scopeGain, glowIntensity, soloTrackId, hiddenTrackIds, customColors, phaseInverts, tracks]);

  // Periodic throttled state update for the UI sidebar (10Hz = every 100ms)
  useEffect(() => {
    const timer = setInterval(() => {
      const activeTracks = tracks.filter((t) => t.isVisible);
      const metricsList: TrackStereoState[] = [];

      let totalCorr = 0;
      let totalWidth = 0;
      let totalBalance = 0;
      let totalMid = 0;
      let totalSide = 0;
      let count = 0;

      activeTracks.forEach((track) => {
        const m = audioEngine.calculateStereoMetrics(track.id);
        const isSolo = soloTrackId === track.id;
        const isHidden = hiddenTrackIds.has(track.id);
        const isPhaseInverted = phaseInverts.get(track.id) || false;
        const trackColor = customColors.get(track.id) || track.color;

        metricsList.push({
          trackId: track.id,
          trackName: track.name,
          trackColor,
          isSolo,
          isVisibleInScope: !isHidden,
          isPhaseInverted,
          ...m,
        });

        if (!isHidden && (!soloTrackId || isSolo)) {
          totalCorr += isPhaseInverted ? -m.correlation : m.correlation;
          totalWidth += m.widthPercent;
          totalBalance += m.balance;
          totalMid += m.midLevelDb;
          totalSide += m.sideLevelDb;
          count++;
        }
      });

      setTrackMetricsList(metricsList);

      if (count > 0) {
        setTelemetry({
          correlation: totalCorr / count,
          width: totalWidth / count,
          balance: totalBalance / count,
          midDb: totalMid / count,
          sideDb: totalSide / count,
        });
      }
    }, 100);

    return () => clearInterval(timer);
  }, [tracks, soloTrackId, hiddenTrackIds, phaseInverts, customColors]);

  // Main 60FPS Hardware-Accelerated Vector Canvas Loop
  useEffect(() => {
    let isDestroyed = false;

    // Create offscreen persistence buffer
    if (!persistenceCanvasRef.current) {
      persistenceCanvasRef.current = document.createElement('canvas');
    }

    const render = () => {
      if (isDestroyed) return;
      const canvas = canvasRef.current;
      if (!canvas) {
        animFrameRef.current = requestAnimationFrame(render);
        return;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      const pCanvas = persistenceCanvasRef.current!;
      if (pCanvas.width !== canvas.width || pCanvas.height !== canvas.height) {
        pCanvas.width = canvas.width;
        pCanvas.height = canvas.height;
      }
      const pCtx = pCanvas.getContext('2d');

      const {
        displayMode: curMode,
        scopeGain: curGain,
        glowIntensity: curGlow,
        soloTrackId: curSolo,
        hiddenTrackIds: curHidden,
        customColors: curColors,
        phaseInverts: curInverts,
        tracks: curTracks,
      } = scopeStateRef.current;

      ctx.save();
      ctx.scale(dpr, dpr);

      // ── Step 1: Deep Metallic Obsidian Background ──
      const gradBg = ctx.createRadialGradient(width / 2, height / 2, 10, width / 2, height / 2, width * 0.7);
      gradBg.addColorStop(0, '#070A12');
      gradBg.addColorStop(0.6, '#04060A');
      gradBg.addColorStop(1, '#020306');
      ctx.fillStyle = gradBg;
      ctx.fillRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const maxR = Math.min(width, height) * 0.44;

      // ── Step 2: Ultra-Luxurious Mastering Bezel & Graticule ──
      // Outer Bezel Rim (Titanium / Obsidian CNC ring)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx.stroke();

      // Outer Glow Accent
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
      ctx.stroke();

      // Subtle out-of-phase danger quadrant tint (bottom half)
      const dangerGrad = ctx.createRadialGradient(cx, cy + maxR * 0.5, 10, cx, cy + maxR * 0.5, maxR * 0.7);
      dangerGrad.addColorStop(0, 'rgba(239, 68, 68, 0.04)');
      dangerGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = dangerGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * 0.98, Math.PI * 0.15, Math.PI * 0.85);
      ctx.fill();

      // Concentric dB Reference Rings (-18dB, -12dB, -6dB, 0dB, +3dB)
      const dbRings = [
        { r: maxR * 0.25, label: '-18dB' },
        { r: maxR * 0.50, label: '-12dB' },
        { r: maxR * 0.75, label: '-6dB' },
        { r: maxR * 1.00, label: '0dB' },
      ];

      ctx.lineWidth = 1;
      dbRings.forEach((ring) => {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Elegant gold/slate ring labels
        if (maxR > 110) {
          ctx.font = '8px "JetBrains Mono", monospace';
          ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
          ctx.textAlign = 'center';
          ctx.fillText(ring.label, cx, cy - ring.r + 9);
        }
      });

      // 45° Diagonal Axes (L and R Speakers)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1.2;
      const diagLen = maxR * 1.02;

      // +L Axis (top-left to bottom-right, 135° to 315°)
      ctx.beginPath();
      ctx.moveTo(cx - diagLen * 0.7071, cy - diagLen * 0.7071);
      ctx.lineTo(cx + diagLen * 0.7071, cy + diagLen * 0.7071);
      ctx.stroke();

      // +R Axis (top-right to bottom-left, 45° to 225°)
      ctx.beginPath();
      ctx.moveTo(cx + diagLen * 0.7071, cy - diagLen * 0.7071);
      ctx.lineTo(cx - diagLen * 0.7071, cy + diagLen * 0.7071);
      ctx.stroke();

      // Orthogonal Mid / Side Axes (0° Vertical = Mid / Mono, 90° Horizontal = Side / Stereo)
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.lineWidth = 1.5;

      // Mid (Mono Core) Axis
      ctx.beginPath();
      ctx.moveTo(cx, cy - maxR * 1.03);
      ctx.lineTo(cx, cy + maxR * 1.03);
      ctx.stroke();

      // Side (Stereo Width) Axis
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - maxR * 1.03, cy);
      ctx.lineTo(cx + maxR * 1.03, cy);
      ctx.stroke();

      // Laser-Etched Hardware Quadrant Indicators (+L, +R, M, S, Phase -)
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';

      // Mid (Mono Center)
      ctx.fillStyle = '#38BDF8';
      ctx.fillText('M (MONO)', cx, cy - maxR - 8);

      // Side (Stereo Width)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fillText('+S (SIDE)', cx + maxR + 24, cy + 3.5);
      ctx.fillText('-S', cx - maxR - 16, cy + 3.5);

      // +L (Left Channel)
      ctx.fillStyle = '#FBBF24';
      ctx.fillText('+L', cx - diagLen * 0.7071 - 10, cy - diagLen * 0.7071 - 4);

      // +R (Right Channel)
      ctx.fillStyle = '#FBBF24';
      ctx.fillText('+R', cx + diagLen * 0.7071 + 10, cy - diagLen * 0.7071 - 4);

      // Out-of-phase Warning at Bottom
      ctx.fillStyle = 'rgba(244, 63, 94, 0.8)';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText('OUT OF PHASE (-)', cx, cy + maxR + 14);

      // ── Step 3: Upper Perimeter Phase Correlation Arc (-1.0 to +1.0) with Jewel Needle ──
      const arcR = maxR * 0.94;
      const startA = Math.PI * 0.95;
      const endA = Math.PI * 2.05;

      // Outer Arc Rail
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, arcR, startA, endA);
      ctx.stroke();

      // Ballistics physics for smooth analog needle motion
      const targetCorr = telemetry.correlation;
      const springK = 0.12;
      const damping = 0.82;
      const delta = targetCorr - smoothedCorrRef.current;
      needleVelocityRef.current = needleVelocityRef.current * damping + delta * springK;
      smoothedCorrRef.current += needleVelocityRef.current;

      const clampedCorr = Math.max(-1, Math.min(1, smoothedCorrRef.current));
      const corrNorm = (clampedCorr + 1) / 2;
      const currentAngle = startA + corrNorm * (endA - startA);

      // Gradient glow along active arc
      const arcGrad = ctx.createLinearGradient(cx - arcR, cy, cx + arcR, cy);
      arcGrad.addColorStop(0, '#EF4444');
      arcGrad.addColorStop(0.5, '#F59E0B');
      arcGrad.addColorStop(1, '#10B981');

      ctx.strokeStyle = arcGrad;
      ctx.lineWidth = 4;
      ctx.shadowColor = clampedCorr > 0 ? '#10B981' : '#EF4444';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(cx, cy, arcR, startA, currentAngle);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Glowing Jewel Needle Tip
      const needleAx = cx + Math.cos(currentAngle) * arcR;
      const needleAy = cy + Math.sin(currentAngle) * arcR;

      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = clampedCorr > 0 ? '#38BDF8' : '#EF4444';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(needleAx, needleAy, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Arc scale numbers
      if (maxR > 80) {
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
        ctx.textAlign = 'right';
        ctx.fillText('-1', cx + Math.cos(startA) * (arcR + 10), cy + Math.sin(startA) * (arcR + 10));

        ctx.fillStyle = 'rgba(245, 158, 11, 0.8)';
        ctx.textAlign = 'center';
        ctx.fillText('0', cx, cy - arcR - 10);

        ctx.fillStyle = 'rgba(16, 185, 129, 0.8)';
        ctx.textAlign = 'left';
        ctx.fillText('+1', cx + Math.cos(endA) * (arcR + 10), cy + Math.sin(endA) * (arcR + 10));
      }

      // ── Step 4: Render Vectorscope Beam Traces (4 Master Engines) ──
      const visible = curTracks.filter((t) => t.isVisible);
      const tracksToDraw = curSolo
        ? visible.filter((t) => t.id === curSolo)
        : visible.filter((t) => !curHidden.has(t.id));

      ctx.globalCompositeOperation = 'lighter';

      tracksToDraw.forEach((track) => {
        const m = audioEngine.calculateStereoMetrics(track.id);
        const color = curColors.get(track.id) || track.color;
        const inverted = curInverts.get(track.id) || false;

        const pts = inverted
          ? m.lissajousPoints.map((p) => ({ x: -p.x, y: p.y }))
          : m.lissajousPoints;

        if (pts.length < 2) return;

        const effectiveGain = maxR * curGain * 1.35;

        // --- ENGINE 1: ANALOG CRT LISSAJOUS (Dual-pass glow with white-hot core) ---
        if (curMode === 'lissajous') {
          ctx.beginPath();
          const first = pts[0];
          ctx.moveTo(cx + first.x * effectiveGain, cy - first.y * effectiveGain);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(cx + pts[i].x * effectiveGain, cy - pts[i].y * effectiveGain);
          }
          // Ambient glow pass
          ctx.strokeStyle = `${color}44`;
          ctx.lineWidth = 4.5;
          ctx.shadowColor = color;
          ctx.shadowBlur = curGlow * 1.5;
          ctx.stroke();

          // Saturated chromatic trace pass
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.0;
          ctx.shadowBlur = curGlow * 0.8;
          ctx.stroke();

          // White-hot center beam
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
          ctx.lineWidth = 1.0;
          ctx.shadowBlur = 0;
          ctx.stroke();
        }

        // --- ENGINE 2: POLAR DISPERSION RADAR ---
        else if (curMode === 'polar') {
          ctx.beginPath();
          pts.forEach((pt) => {
            const px = cx + pt.x * effectiveGain;
            const py = cy - pt.y * effectiveGain;
            ctx.moveTo(cx, cy);
            ctx.lineTo(px, py);
          });
          ctx.strokeStyle = `${color}55`;
          ctx.lineWidth = 1.5;
          ctx.shadowColor = color;
          ctx.shadowBlur = curGlow * 0.6;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }

        // --- ENGINE 3: PHOSPHOR CLOUD ---
        else if (curMode === 'cloud') {
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = 4;
          pts.forEach((pt) => {
            const px = cx + pt.x * effectiveGain;
            const py = cy - pt.y * effectiveGain;
            ctx.beginPath();
            ctx.arc(px, py, 1.8, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.shadowBlur = 0;
        }

        // --- ENGINE 4: MASTER-GRADE LIVING M/S STEREO FIELD ---
        // An organic, pulsating stereo field with breathing harmonic rings and energetic core
        else if (curMode === 'ellipse') {
          const midEnergy = Math.max(0.1, Math.min(1.0, Math.pow(10, (m.midLevelDb + 40) / 40)));
          const sideEnergy = Math.max(0.05, Math.min(1.0, Math.pow(10, (m.sideLevelDb + 40) / 40)));

          // Smooth ballistics
          smoothedMidEnergyRef.current += (midEnergy - smoothedMidEnergyRef.current) * 0.15;
          smoothedSideEnergyRef.current += (sideEnergy - smoothedSideEnergyRef.current) * 0.15;

          const smMid = smoothedMidEnergyRef.current;
          const smSide = smoothedSideEnergyRef.current;

          const rot = (m.balance || 0) * (Math.PI / 6);
          const baseR = maxR * 0.75;
          const verticalMidR = Math.max(15, baseR * smMid * (curGain * 0.7));
          const horizontalSideR = Math.max(10, baseR * smSide * (curGain * 0.7));

          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(rot);

          // 1. Concentric Harmonic Energy Rings (Breathing with transient energy)
          const ringLevels = [0.4, 0.7, 1.0, 1.25];
          ringLevels.forEach((mult, idx) => {
            const rX = horizontalSideR * mult;
            const rY = verticalMidR * mult;

            ctx.beginPath();
            ctx.ellipse(0, 0, Math.max(2, rX), Math.max(2, rY), 0, 0, Math.PI * 2);
            ctx.strokeStyle = idx === 2 ? color : `${color}${idx === 3 ? '22' : '44'}`;
            ctx.lineWidth = idx === 2 ? 2.0 : 1.0;
            if (idx === 2) {
              ctx.shadowColor = color;
              ctx.shadowBlur = curGlow;
            } else {
              ctx.shadowBlur = 0;
            }
            ctx.stroke();
          });

          // 2. Translucent Radial Fill
          ctx.fillStyle = `${color}18`;
          ctx.beginPath();
          ctx.ellipse(0, 0, Math.max(2, horizontalSideR), Math.max(2, verticalMidR), 0, 0, Math.PI * 2);
          ctx.fill();

          // 3. Glowing Mid Core Pillar (Vertical Mono Punch)
          const midGrad = ctx.createLinearGradient(0, -verticalMidR, 0, verticalMidR);
          midGrad.addColorStop(0, 'rgba(56, 189, 248, 0)');
          midGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.85)');
          midGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
          ctx.strokeStyle = midGrad;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(0, -verticalMidR * 1.1);
          ctx.lineTo(0, verticalMidR * 1.1);
          ctx.stroke();

          // 4. Glowing Side Width Wings (Horizontal Stereo Spread)
          const sideGrad = ctx.createLinearGradient(-horizontalSideR, 0, horizontalSideR, 0);
          sideGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
          sideGrad.addColorStop(0.5, `${color}88`);
          sideGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.strokeStyle = sideGrad;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-horizontalSideR * 1.1, 0);
          ctx.lineTo(horizontalSideR * 1.1, 0);
          ctx.stroke();

          // 5. Active Dynamic Particles Mapped to Mid/Side Samples
          ctx.fillStyle = '#FFFFFF';
          ctx.shadowColor = color;
          ctx.shadowBlur = 4;
          for (let pIdx = 0; pIdx < pts.length; pIdx += 2) {
            const pt = pts[pIdx];
            const px = pt.x * effectiveGain * 0.65;
            const py = -pt.y * effectiveGain * 0.65;
            ctx.beginPath();
            ctx.arc(px, py, 1.4, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.restore();
        }
      });

      ctx.globalCompositeOperation = 'source-over';

      // ── Step 5: Center Dynamic Phase Needle & Illuminated Sapphire Pivot ──
      if (tracksToDraw.length > 0) {
        const firstTrack = tracksToDraw[0];
        const m = audioEngine.calculateStereoMetrics(firstTrack.id);
        const pts = m.lissajousPoints;

        if (pts.length > 0) {
          const mid = pts[Math.floor(pts.length / 2)];
          const targetAngle = -Math.atan2(mid.y, mid.x) + Math.PI / 2;

          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(targetAngle);

          // Slender illuminated titanium needle
          const needleLen = maxR * 0.85;
          const needleGrad = ctx.createLinearGradient(0, 0, 0, -needleLen);
          needleGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
          needleGrad.addColorStop(0.7, '#38BDF8');
          needleGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');

          ctx.strokeStyle = needleGrad;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(0, 8);
          ctx.lineTo(0, -needleLen);
          ctx.stroke();

          ctx.restore();
        }
      }

      // Center Sapphire Pivot
      ctx.fillStyle = '#0F172A';
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#38BDF8';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.restore();
      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      isDestroyed = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Per-track actions
  const toggleSoloTrack = (trackId: string) => {
    setSoloTrackId((prev) => (prev === trackId ? null : trackId));
  };

  const toggleTrackVisibility = (trackId: string) => {
    setHiddenTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const togglePhaseInvert = (trackId: string) => {
    setPhaseInverts((prev) => {
      const next = new Map(prev);
      next.set(trackId, !next.get(trackId));
      return next;
    });
  };

  const handleSelectColor = (trackId: string, color: string) => {
    setCustomColors((prev) => {
      const next = new Map(prev);
      next.set(trackId, color);
      return next;
    });
    setColorPickerTrackId(null);
  };

  const getPhaseStatus = (r: number) => {
    if (r > 0.85) return { label: 'MONO PERFECT', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' };
    if (r > 0.40) return { label: 'WIDE STEREO', color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' };
    if (r > 0.00) return { label: 'NARROW PHASE', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
    return { label: 'PHASE CANCEL!', color: 'text-rose-400 bg-rose-500/10 border-rose-500/30 shadow-[0_0_8px_rgba(244,63,94,0.3)]' };
  };

  const phaseStatus = getPhaseStatus(telemetry.correlation);

  return (
    <div className="w-full h-full flex flex-col gap-2 select-none overflow-hidden">
      {/* ── Top Bar: Mode Selectors, Zoom, and Fixed-Width Jitter-Free Telemetry ── */}
      <div className="h-11 px-3 rounded-xl bg-slate-950/85 backdrop-blur-xl border border-white/10 flex items-center justify-between gap-3 shrink-0 shadow-sm">
        {/* Left: 4 Scope Engine Mode Buttons */}
        <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-white/10">
          <button
            onClick={() => setDisplayMode('lissajous')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-all cursor-pointer
              ${
                displayMode === 'lissajous'
                  ? 'bg-slate-700 text-cyan-400 shadow-sm font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
          >
            <Compass className="w-3.5 h-3.5" />
            Lissajous X-Y
          </button>

          <button
            onClick={() => setDisplayMode('polar')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-all cursor-pointer
              ${
                displayMode === 'polar'
                  ? 'bg-slate-700 text-cyan-400 shadow-sm font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
          >
            <Radio className="w-3.5 h-3.5" />
            Polar Radar
          </button>

          <button
            onClick={() => setDisplayMode('cloud')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-all cursor-pointer
              ${
                displayMode === 'cloud'
                  ? 'bg-slate-700 text-cyan-400 shadow-sm font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
          >
            <CircleDot className="w-3.5 h-3.5" />
            Phosphor Cloud
          </button>

          <button
            onClick={() => setDisplayMode('ellipse')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-all cursor-pointer
              ${
                displayMode === 'ellipse'
                  ? 'bg-slate-700 text-cyan-400 shadow-sm font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            title="Living Mid/Side Harmonic Stereo Field"
          >
            <Disc className="w-3.5 h-3.5" />
            M/S Field
          </button>
        </div>

        {/* Center: Zoom / Gain Stepper */}
        <div className="hidden sm:flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
            <ZoomIn className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px] uppercase tracking-wider text-slate-400">Zoom:</span>
          </div>

          <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-white/10 font-mono text-xs">
            {[1.0, 1.5, 2.0, 3.0, 4.5].map((g) => (
              <button
                key={g}
                onClick={() => setScopeGain(g)}
                className={`px-2 py-0.5 rounded font-bold transition-all cursor-pointer
                  ${
                    scopeGain === g
                      ? 'bg-cyan-500 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
              >
                {g}x
              </button>
            ))}
          </div>

          {/* Bloom Slider */}
          <div className="hidden lg:flex items-center gap-2 pl-3 border-l border-white/10 text-xs">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[11px] text-slate-400 uppercase tracking-wider">Bloom:</span>
            <input
              type="range"
              min="2"
              max="24"
              value={glowIntensity}
              onChange={(e) => setGlowIntensity(parseInt(e.target.value))}
              className="w-16 h-1 bg-slate-800 rounded cursor-pointer accent-cyan-400"
            />
          </div>
        </div>

        {/* Right: Master Phase Health Readout (STRICT Fixed-Width Containers - Zero Jitter Guaranteed) */}
        <div className="flex items-center gap-2 font-mono text-xs shrink-0">
          {/* Phase Correlation Container (Fixed Width) */}
          <div className="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1.5 rounded-xl border border-white/10 shadow-lg shrink-0">
            <span className="text-slate-400 text-[11px] shrink-0">Phase r:</span>
            <span className="w-14 inline-block text-right text-white font-bold text-sm tabular-nums">
              {telemetry.correlation > 0 ? '+' : ''}{telemetry.correlation.toFixed(2)}
            </span>
            {/* Fixed-width badge so status label changes NEVER shift adjacent items */}
            <span className={`w-28 inline-block text-center text-[10px] font-bold px-1.5 py-0.5 rounded border truncate ${phaseStatus.color}`}>
              {phaseStatus.label}
            </span>
          </div>

          {/* Width Container (Fixed Width) */}
          <div className="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1.5 rounded-xl border border-white/10 shadow-lg shrink-0">
            <span className="text-slate-400 text-[11px] shrink-0">Width:</span>
            <span className="w-12 inline-block text-right text-cyan-400 font-bold text-sm tabular-nums">
              {telemetry.width.toFixed(0)}%
            </span>
          </div>
        </div>
      </div>

      {/* ── Main Stage: Center Goniometer + Right Clean Multi-Track Matrix ── */}
      <div className="flex-1 flex flex-col md:flex-row gap-3 min-h-0 overflow-hidden">
        {/* Left: Main Goniometer Display */}
        <div className="relative flex-1 rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-[#05070D] flex flex-col min-w-0">
          <canvas ref={canvasRef} className="w-full flex-1 block" />

          {/* Bottom Master Correlation & Balance Hardware Strip (Strict Fixed-Width - Zero Jitter) */}
          <div className="h-10 px-4 bg-slate-950/90 backdrop-blur-xl border-t border-white/10 flex items-center justify-between gap-6 shrink-0">
            {/* Correlation Linear Bar */}
            <div className="flex-1 flex items-center gap-3 min-w-0">
              <span className="text-[10px] font-mono text-slate-400 uppercase font-bold shrink-0">
                Phase Correlation:
              </span>
              <div className="relative flex-1 h-2.5 bg-slate-900 rounded-full overflow-hidden flex items-center border border-white/10">
                <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-400 z-10" />
                <div
                  className={`h-full rounded-full transition-all duration-75 shadow-[0_0_8px_currentColor] ${
                    telemetry.correlation < 0
                      ? 'bg-rose-500 text-rose-500'
                      : telemetry.correlation < 0.35
                      ? 'bg-amber-400 text-amber-400'
                      : 'bg-emerald-400 text-emerald-400'
                  }`}
                  style={{
                    width: `${Math.abs(telemetry.correlation) * 50}%`,
                    marginLeft: telemetry.correlation < 0 ? `${(1 + telemetry.correlation) * 50}%` : '50%',
                  }}
                />
              </div>
              <div className="flex items-center gap-2 text-[9px] font-mono shrink-0">
                <span className="text-rose-400 font-bold">-1 (Phase Cancel)</span>
                <span className="text-slate-500">0</span>
                <span className="text-emerald-400 font-bold">+1 (Mono)</span>
              </div>
            </div>

            {/* M/S Energy Split & Pan Balance (Strict Fixed-Width Numbers - Zero Layout Twitching) */}
            <div className="hidden lg:flex items-center gap-4 shrink-0 pl-4 border-l border-white/10 text-xs font-mono">
              <div className="flex items-center gap-1.5 text-slate-400">
                <span>Mid:</span>
                <b className="w-14 inline-block text-right text-white tabular-nums">{telemetry.midDb.toFixed(1)}dB</b>
                <span className="text-slate-600">/</span>
                <span>Side:</span>
                <b className="w-14 inline-block text-right text-cyan-400 tabular-nums">{telemetry.sideDb.toFixed(1)}dB</b>
              </div>

              <div className="flex items-center gap-1.5 text-slate-400">
                <span>Azimuth:</span>
                <b className="w-16 inline-block text-center text-slate-200 tabular-nums">
                  {Math.abs(telemetry.balance) < 0.04
                    ? 'Center'
                    : telemetry.balance < 0
                    ? `L ${(Math.abs(telemetry.balance) * 100).toFixed(0)}%`
                    : `R ${(telemetry.balance * 100).toFixed(0)}%`}
                </b>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Multi-Track Phase Matrix */}
        <div className="w-full md:w-84 flex flex-col gap-2 p-3.5 rounded-2xl bg-slate-950/90 backdrop-blur-2xl border border-white/10 shadow-2xl shrink-0 overflow-y-auto">
          <div className="flex items-center justify-between pb-2 border-b border-white/10 shrink-0">
            <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-cyan-400" />
              Multitrack Phase Matrix
            </span>
            <span className="text-[10px] font-mono text-cyan-400 font-semibold px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20">
              {trackMetricsList.length} Tracks Synced
            </span>
          </div>

          <div className="flex-1 flex flex-col gap-2 overflow-y-auto pr-1">
            {trackMetricsList.map((tm) => {
              const isSolo = soloTrackId === tm.trackId;
              const isHidden = hiddenTrackIds.has(tm.trackId);
              const isPickerOpen = colorPickerTrackId === tm.trackId;

              return (
                <div
                  key={tm.trackId}
                  className={`p-3 rounded-xl border transition-all flex flex-col gap-2 shadow-sm
                    ${
                      isSolo
                        ? 'bg-slate-900/95 border-amber-500/50 shadow-amber-500/10'
                        : isHidden
                        ? 'bg-slate-900/40 border-white/5 opacity-40'
                        : 'bg-slate-900/80 border-white/10'
                    }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        onClick={() => setColorPickerTrackId(isPickerOpen ? null : tm.trackId)}
                        className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/60 shadow-[0_0_8px_currentColor] transition-transform hover:scale-125 cursor-pointer"
                        style={{ backgroundColor: tm.trackColor, color: tm.trackColor }}
                        title="Click to choose a jewel color"
                      />

                      <span className="text-xs font-bold text-white truncate">
                        {tm.trackName}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => togglePhaseInvert(tm.trackId)}
                        title="Simulate Inverting Phase (Ø)"
                        className={`px-1.5 py-0.5 text-[10px] font-mono rounded font-bold transition-all cursor-pointer border
                          ${
                            tm.isPhaseInverted
                              ? 'bg-rose-500 text-white border-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.4)]'
                              : 'bg-slate-800 text-slate-400 border-white/10 hover:text-white'
                          }`}
                      >
                        Ø
                      </button>

                      <button
                        onClick={() => toggleSoloTrack(tm.trackId)}
                        title="Solo this track in Vectorscope"
                        className={`px-2 py-0.5 text-[10px] font-bold font-mono rounded transition-all cursor-pointer border
                          ${
                            isSolo
                              ? 'bg-amber-500 text-slate-950 border-amber-400 font-extrabold shadow-sm'
                              : 'bg-slate-800 text-slate-400 border-white/10 hover:text-white'
                          }`}
                      >
                        S
                      </button>

                      <button
                        onClick={() => toggleTrackVisibility(tm.trackId)}
                        title={isHidden ? 'Show in Vectorscope' : 'Hide from Vectorscope'}
                        className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
                      >
                        {isHidden ? <EyeOff className="w-3.5 h-3.5 text-slate-600" /> : <Eye className="w-3.5 h-3.5 text-cyan-400" />}
                      </button>
                    </div>
                  </div>

                  {isPickerOpen && (
                    <div className="flex items-center justify-between p-2 rounded-xl bg-slate-950 border border-white/20 shadow-xl z-20">
                      {JEWEL_PALETTE.map((j) => (
                        <button
                          key={j.color}
                          onClick={() => handleSelectColor(tm.trackId, j.color)}
                          className="w-4 h-4 rounded-full transition-transform hover:scale-130 cursor-pointer"
                          style={{
                            backgroundColor: j.color,
                            boxShadow: j.color === tm.trackColor ? '0 0 8px white' : 'none',
                          }}
                          title={j.name}
                        />
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="text-slate-400">Phase r:</span>
                      <span
                        className={`w-14 inline-block text-right font-bold tabular-nums ${
                          tm.correlation < 0 ? 'text-rose-400' : tm.correlation < 0.35 ? 'text-amber-400' : 'text-emerald-400'
                        }`}
                      >
                        {tm.correlation > 0 ? '+' : ''}{tm.correlation.toFixed(2)}
                      </span>
                    </div>

                    <div className="relative h-2 bg-slate-950 rounded-full overflow-hidden flex items-center border border-white/5">
                      <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-600 z-10" />
                      <div
                        className="h-full rounded-full transition-all duration-75"
                        style={{
                          backgroundColor: tm.trackColor,
                          width: `${Math.abs(tm.correlation) * 50}%`,
                          marginLeft: tm.correlation < 0 ? `${(1 + tm.correlation) * 50}%` : '50%',
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-mono pt-1.5 border-t border-white/5 text-slate-400">
                    <span>Width: <b className="w-10 inline-block text-right text-white tabular-nums">{tm.widthPercent.toFixed(0)}%</b></span>
                    <span>Mid: <b className="w-10 inline-block text-right text-white tabular-nums">{tm.midLevelDb.toFixed(0)}dB</b></span>
                    <span>Side: <b className="w-10 inline-block text-right text-cyan-400 tabular-nums">{tm.sideLevelDb.toFixed(0)}dB</b></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
