/**
 * OscilloscopeView - Premium Mastering-Grade Multitrack Digital Storage Oscilloscope
 * Pure measurement instrument with zero audio distortion:
 * - Ultra-wide timebase presets: 1ms up to 10 seconds (no redundant slider)
 * - Anti-aliased sub-sample curve smoothing with analog phosphor CRT beam glow
 * - Pure passive Phase Coherence measurement readout (no audio shift or delay knobs)
 * - Optional "Waveform Clashes / Intersections" visual overlay toggle (view original or highlight conflicts)
 * - Interactive on-screen trigger drag line with zero UI jumping/twitching
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { AudioTrack, AnalyzerSettings } from '../../types/audio';
import { audioEngine, OscilloscopeChannelData } from '../../audio/AudioEngine';
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

export const OscilloscopeView: React.FC<OscilloscopeViewProps> = ({ tracks, settings }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Display Mode: Overlay vs Stacked Lanes
  const [displayMode, setDisplayMode] = useState<'overlay' | 'lanes'>('overlay');

  // Timebase Presets (1ms to 10 seconds - clean preset buttons, no redundant slider)
  const [timebaseMs, setTimebaseMs] = useState<number>(settings.oscilloscopeTimebaseMs || 50);

  // Trigger Configuration
  const [triggerMode, setTriggerMode] = useState<'trigger' | 'free' | 'freeze'>('trigger');
  const [triggerTrackId, setTriggerTrackId] = useState<string>('track_kick');
  const [triggerLevel, setTriggerLevel] = useState<number>(0.08);
  const [triggerEdge, setTriggerEdge] = useState<'rising' | 'falling'>('rising');

  // Conflict / Clash Overlay Mode (User can see pure original waveform or highlight wave collisions)
  const [showWaveClashes, setShowWaveClashes] = useState<boolean>(false);

  // Dragging & Hovering Trigger
  const isDraggingTriggerRef = useRef<boolean>(false);
  const [isHoveringTrigger, setIsHoveringTrigger] = useState<boolean>(false);
  const [isDraggingTrigger, setIsDraggingTrigger] = useState<boolean>(false);

  // Passive Phase Coherence Readout (Throttled at 10Hz to prevent ANY React layout jitter)
  const [phaseCoherence, setPhaseCoherence] = useState<number>(0.92);

  useEffect(() => {
    const timer = setInterval(() => {
      if (triggerMode !== 'freeze') {
        const score = audioEngine.calculatePhaseAlignmentScore('track_kick', 'track_bass', 0);
        setPhaseCoherence(score);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [triggerMode]);

  // Frozen Waveform Cache
  const frozenFrames = useRef<Map<string, OscilloscopeChannelData>>(new Map());

  // 1ms to 10 seconds presets as requested
  const presets = [
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

  // Auto 50% Peak Trigger Level Calculation
  const handleAutoTriggerLevel = useCallback(() => {
    const peakInfo = audioEngine.getTrackPeak(triggerTrackId);
    let target = 0.08;
    if (triggerEdge === 'rising') {
      target = Math.max(0.02, Math.min(0.9, peakInfo.peakPos * 0.5));
    } else {
      target = Math.min(-0.02, Math.max(-0.9, peakInfo.peakNeg * 0.5));
    }
    setTriggerLevel(Math.round(target * 100) / 100);
  }, [triggerTrackId, triggerEdge]);

  // Convert canvas Y to voltage level (-1.0V to +1.0V)
  const yToVoltage = useCallback((y: number, height: number): number => {
    const volt = (height / 2 - y) / (height * 0.44);
    return Math.max(-1.0, Math.min(1.0, Math.round(volt * 100) / 100));
  }, []);

  // Convert voltage level to canvas Y coordinate
  const voltageToY = useCallback((voltage: number, height: number): number => {
    return height / 2 - voltage * (height * 0.44);
  }, []);

  // Handle Pointer Events on Canvas for Direct Trigger Line Dragging
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (triggerMode !== 'trigger') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const mouseX = e.clientX - rect.left;
    const currentTrigY = voltageToY(triggerLevel, rect.height);

    const isNearLine = Math.abs(mouseY - currentTrigY) <= 16;
    const isOnRightHandle = mouseX >= rect.width - 140 && Math.abs(mouseY - currentTrigY) <= 24;

    if (isNearLine || isOnRightHandle) {
      isDraggingTriggerRef.current = true;
      setIsDraggingTrigger(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      const newVolt = yToVoltage(mouseY, rect.height);
      setTriggerLevel(newVolt);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const mouseX = e.clientX - rect.left;

    if (isDraggingTriggerRef.current) {
      const newVolt = yToVoltage(mouseY, rect.height);
      setTriggerLevel(newVolt);
    } else if (triggerMode === 'trigger') {
      const currentTrigY = voltageToY(triggerLevel, rect.height);
      const isNear = Math.abs(mouseY - currentTrigY) <= 16 || (mouseX >= rect.width - 140 && Math.abs(mouseY - currentTrigY) <= 24);
      setIsHoveringTrigger(isNear);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDraggingTriggerRef.current) {
      isDraggingTriggerRef.current = false;
      setIsDraggingTrigger(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignored
      }
    }
  };

  const handleDoubleClick = () => {
    if (triggerMode === 'trigger') {
      setTriggerLevel(0.0);
    }
  };

  // Main High-Precision Render Loop
  useEffect(() => {
    let isDestroyed = false;

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

      ctx.save();
      ctx.scale(dpr, dpr);

      // Deep obsidian oscilloscope screen background
      ctx.fillStyle = '#05070D';
      ctx.fillRect(0, 0, width, height);

      const activeTracks = tracks.filter((t) => t.isVisible);

      // Fetch or cache frames (Zero phase shift on actual audio - pure measurement)
      const channelFrames: OscilloscopeChannelData[] = [];
      activeTracks.forEach((track) => {
        let frame: OscilloscopeChannelData | null = null;
        if (triggerMode === 'freeze') {
          frame = frozenFrames.current.get(track.id) || null;
        } else {
          frame = audioEngine.getOscilloscopeChannelData(
            track.id,
            timebaseMs,
            triggerMode,
            triggerTrackId,
            triggerLevel,
            triggerEdge,
            0 // zero shift on audio
          );
          if (frame) {
            frozenFrames.current.set(track.id, frame);
          }
        }
        if (frame) channelFrames.push(frame);
      });

      // Render Mode 1: Overlay Mode
      if (displayMode === 'overlay') {
        // Precision Graticule (10 horizontal, 8 vertical)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;

        const numXDivs = 10;
        for (let i = 1; i < numXDivs; i++) {
          const x = (i / numXDivs) * width;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }

        const numYDivs = 8;
        for (let i = 1; i < numYDivs; i++) {
          const y = (i / numYDivs) * height;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
        }

        // Center 0V Reference Axis (Glowing emerald/cyan graticule line)
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Voltage Scale Tick Labels
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
        ctx.textAlign = 'left';
        ctx.fillText('+1.0V', 8, 14);
        ctx.fillText('+0.5V', 8, height * 0.25 + 4);
        ctx.fillText(' 0.0V', 8, height * 0.5 - 4);
        ctx.fillText('-0.5V', 8, height * 0.75 + 4);
        ctx.fillText('-1.0V', 8, height - 8);

        // Time division text
        const msPerDiv = timebaseMs / numXDivs;
        const timeDivStr = msPerDiv >= 1000 
          ? `${(msPerDiv / 1000).toFixed(2)} s/div` 
          : `${msPerDiv.toFixed(1)} ms/div`;
        ctx.textAlign = 'right';
        ctx.fillText(timeDivStr, width - 10, 16);

        // Interactive Visual Trigger Level Line
        if (triggerMode === 'trigger') {
          const trigY = height / 2 - triggerLevel * (height * 0.44);
          const isHighlit = isDraggingTriggerRef.current || isHoveringTrigger;

          if (isHighlit) {
            ctx.strokeStyle = 'rgba(234, 179, 8, 0.4)';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(0, trigY);
            ctx.lineTo(width, trigY);
            ctx.stroke();
          }

          ctx.strokeStyle = isHighlit ? '#FACC15' : 'rgba(234, 179, 8, 0.75)';
          ctx.lineWidth = isHighlit ? 1.8 : 1.2;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(0, trigY);
          ctx.lineTo(width, trigY);
          ctx.stroke();
          ctx.setLineDash([]);

          // Tactile Trigger Handle Pill
          const trigSourceTrack = tracks.find((t) => t.id === triggerTrackId);
          const srcName = trigSourceTrack ? trigSourceTrack.name : 'Ch';
          const edgeIcon = triggerEdge === 'rising' ? '↗' : '↘';
          const labelText = `TRIG [${edgeIcon} ${srcName}]: ${(triggerLevel >= 0 ? '+' : '') + triggerLevel.toFixed(2)}V`;

          ctx.font = 'bold 10px "JetBrains Mono", monospace';
          const textMetrics = ctx.measureText(labelText);
          const pillW = textMetrics.width + 24;
          const pillH = 20;
          const pillX = width - pillW - 8;
          const pillY = trigY - pillH / 2;

          ctx.fillStyle = isHighlit ? '#CA8A04' : 'rgba(161, 98, 7, 0.9)';
          ctx.beginPath();
          ctx.roundRect(pillX, pillY, pillW, pillH, 4);
          ctx.fill();

          ctx.strokeStyle = isHighlit ? '#FEF08A' : '#EAB308';
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = isHighlit ? '#FEF08A' : '#EAB308';
          ctx.beginPath();
          ctx.moveTo(pillX, trigY);
          ctx.lineTo(pillX - 6, trigY - 4);
          ctx.lineTo(pillX - 6, trigY + 4);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle = '#FFFFFF';
          ctx.textAlign = 'left';
          ctx.fillText(labelText, pillX + 8, trigY + 3.5);
        }

        // Draw Overlaid Multitrack Waveforms with Silky Sub-Sample Smoothing
        channelFrames.forEach((frame) => {
          const track = tracks.find((t) => t.id === frame.trackId);
          if (!track) return;

          const numPts = frame.centerValues.length;
          const stepX = width / (numPts - 1);

          // For timebases >= 50ms, draw translucent envelope to show high frequency peak spread
          if (timebaseMs >= 50) {
            ctx.beginPath();
            ctx.moveTo(0, height / 2 - frame.maxValues[0] * (height * 0.44));
            for (let i = 1; i < numPts; i++) {
              ctx.lineTo(i * stepX, height / 2 - frame.maxValues[i] * (height * 0.44));
            }
            for (let i = numPts - 1; i >= 0; i--) {
              ctx.lineTo(i * stepX, height / 2 - frame.minValues[i] * (height * 0.44));
            }
            ctx.closePath();
            ctx.fillStyle = `${track.color}18`;
            ctx.fill();
          }

          // Draw Smooth Phosphor Beam Line Trace (At small timebases 1ms-25ms, use anti-aliased sub-sample curve)
          ctx.beginPath();
          ctx.moveTo(0, height / 2 - frame.centerValues[0] * (height * 0.44));

          if (timebaseMs <= 25) {
            // High-precision smooth curve interpolation (zero crumpling / jaggedness)
            for (let i = 1; i < numPts - 2; i++) {
              const x0 = i * stepX;
              const y0 = height / 2 - frame.centerValues[i] * (height * 0.44);
              const x1 = (i + 1) * stepX;
              const y1 = height / 2 - frame.centerValues[i + 1] * (height * 0.44);
              const midX = (x0 + x1) / 2;
              const midY = (y0 + y1) / 2;
              ctx.quadraticCurveTo(x0, y0, midX, midY);
            }
            const lastIdx = numPts - 1;
            ctx.lineTo(lastIdx * stepX, height / 2 - frame.centerValues[lastIdx] * (height * 0.44));
          } else {
            for (let i = 1; i < numPts; i++) {
              ctx.lineTo(i * stepX, height / 2 - frame.centerValues[i] * (height * 0.44));
            }
          }

          // Beam outer glow
          ctx.strokeStyle = track.color;
          ctx.lineWidth = 2.0;
          ctx.shadowColor = track.color;
          ctx.shadowBlur = 9;
          ctx.stroke();

          // White-hot inner core
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.lineWidth = 0.8;
          ctx.shadowBlur = 0;
          ctx.stroke();
        });

        // Optional Clashes / Intersection Highlighting
        if (showWaveClashes && channelFrames.length >= 2) {
          const frameA = channelFrames[0];
          const frameB = channelFrames[1];
          const trackA = tracks.find((t) => t.id === frameA.trackId);
          const trackB = tracks.find((t) => t.id === frameB.trackId);

          if (trackA && trackB) {
            const numPts = frameA.centerValues.length;
            const stepX = width / (numPts - 1);

            for (let i = 10; i < numPts - 10; i += 6) {
              const valA = frameA.centerValues[i];
              const valB = frameB.centerValues[i];

              // Collision condition: high amplitude overlap or opposing phase cross
              const ampA = Math.abs(valA);
              const ampB = Math.abs(valB);
              const isHighEnergy = ampA > 0.15 && ampB > 0.15;
              const isIntersecting = Math.abs(valA - valB) < 0.06;
              const isOpposingPhase = (valA * valB) < -0.04;

              if (isHighEnergy && (isIntersecting || isOpposingPhase)) {
                const px = i * stepX;
                const py = height / 2 - ((valA + valB) / 2) * (height * 0.44);

                ctx.strokeStyle = isOpposingPhase ? '#F43F5E' : '#F59E0B';
                ctx.fillStyle = isOpposingPhase ? 'rgba(244, 63, 94, 0.3)' : 'rgba(245, 158, 11, 0.3)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(px, py, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
              }
            }
          }
        }
      }

      // --- RENDER MODE 2: SEPARATED LANES MODE ---
      else {
        const laneCount = Math.max(1, channelFrames.length);
        const laneHeight = height / laneCount;

        channelFrames.forEach((frame, idx) => {
          const track = tracks.find((t) => t.id === frame.trackId);
          if (!track) return;

          const laneTop = idx * laneHeight;
          const laneCenter = laneTop + laneHeight / 2;

          // Lane Separator
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, laneTop);
          ctx.lineTo(width, laneTop);
          ctx.stroke();

          // Center Line (0V)
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
          ctx.beginPath();
          ctx.moveTo(0, laneCenter);
          ctx.lineTo(width, laneCenter);
          ctx.stroke();

          // Lane Header Pill
          ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
          ctx.fillStyle = track.color;
          ctx.textAlign = 'left';
          ctx.fillText(`● ${track.name}`, 10, laneTop + 16);

          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
          ctx.fillText(`Peak: ${(frame.peakVoltage * 100).toFixed(0)}% · RMS: ${(frame.rmsVoltage * 100).toFixed(0)}%`, 10, laneTop + 30);

          // Draw Lane Waveform
          const numPts = frame.centerValues.length;
          const stepX = width / (numPts - 1);
          const ampScale = laneHeight * 0.42;

          if (timebaseMs >= 50) {
            ctx.beginPath();
            ctx.moveTo(0, laneCenter - frame.maxValues[0] * ampScale);
            for (let i = 1; i < numPts; i++) {
              ctx.lineTo(i * stepX, laneCenter - frame.maxValues[i] * ampScale);
            }
            for (let i = numPts - 1; i >= 0; i--) {
              ctx.lineTo(i * stepX, laneCenter - frame.minValues[i] * ampScale);
            }
            ctx.closePath();
            ctx.fillStyle = `${track.color}20`;
            ctx.fill();
          }

          // Center line with smooth curve
          ctx.beginPath();
          ctx.moveTo(0, laneCenter - frame.centerValues[0] * ampScale);
          if (timebaseMs <= 25) {
            for (let i = 1; i < numPts - 2; i++) {
              const x0 = i * stepX;
              const y0 = laneCenter - frame.centerValues[i] * ampScale;
              const x1 = (i + 1) * stepX;
              const y1 = laneCenter - frame.centerValues[i + 1] * ampScale;
              ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
            }
            ctx.lineTo((numPts - 1) * stepX, laneCenter - frame.centerValues[numPts - 1] * ampScale);
          } else {
            for (let i = 1; i < numPts; i++) {
              ctx.lineTo(i * stepX, laneCenter - frame.centerValues[i] * ampScale);
            }
          }

          ctx.strokeStyle = track.color;
          ctx.lineWidth = 1.8;
          ctx.shadowColor = track.color;
          ctx.shadowBlur = 6;
          ctx.stroke();
          ctx.shadowBlur = 0;
        });
      }

      ctx.restore();
      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      isDestroyed = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [tracks, displayMode, timebaseMs, triggerMode, triggerTrackId, triggerLevel, triggerEdge, showWaveClashes, isHoveringTrigger, isDraggingTrigger, voltageToY]);

  return (
    <div className="w-full h-full flex flex-col gap-2 select-none overflow-hidden">
      {/* Top Deck: Structured Master Control Ribbon (Zero Overlap Guaranteed, Fixed Width Telemetry) */}
      <div className="p-2.5 rounded-xl bg-slate-950/85 backdrop-blur-xl border border-white/10 shadow-sm flex flex-col gap-2 shrink-0">
        {/* Row 1: Mode Switches, Trigger Configuration Engine, and Passive Phase Alignment Readout */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left Block: View Mode & Trigger Master Mode */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Overlay vs Separated Lanes */}
            <div className="flex items-center gap-0.5 bg-slate-900 p-0.5 rounded-lg border border-white/10">
              <button
                onClick={() => setDisplayMode('overlay')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-all cursor-pointer
                  ${
                    displayMode === 'overlay'
                      ? 'bg-slate-700 text-cyan-400 shadow-sm font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Overlay
              </button>
              <button
                onClick={() => setDisplayMode('lanes')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-all cursor-pointer
                  ${
                    displayMode === 'lanes'
                      ? 'bg-slate-700 text-cyan-400 shadow-sm font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
              >
                <Columns className="w-3.5 h-3.5" />
                Lanes
              </button>
            </div>

            {/* Trigger Engine Mode */}
            <div className="flex items-center gap-0.5 bg-slate-900 p-0.5 rounded-lg border border-white/10">
              <button
                onClick={() => setTriggerMode('trigger')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1 cursor-pointer
                  ${
                    triggerMode === 'trigger'
                      ? 'bg-amber-500 text-black font-bold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
              >
                <Crosshair className="w-3.5 h-3.5" />
                Sync (Edge)
              </button>
              <button
                onClick={() => setTriggerMode('free')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer
                  ${
                    triggerMode === 'free'
                      ? 'bg-cyan-500 text-white font-bold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
              >
                Free Run
              </button>
              <button
                onClick={() => setTriggerMode('freeze')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1 transition-all cursor-pointer
                  ${
                    triggerMode === 'freeze'
                      ? 'bg-rose-500 text-white font-bold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
              >
                <Snowflake className="w-3.5 h-3.5" />
                Freeze
              </button>
            </div>

            {/* Waveform Clashes / Intersection Highlight Toggle (Pure Original vs Clash Overlay) */}
            <button
              onClick={() => setShowWaveClashes(!showWaveClashes)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer border
                ${
                  showWaveClashes
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                    : 'bg-slate-900 text-slate-400 border-white/10 hover:text-white'
                }`}
              title="Toggle highlighting waveform intersection clashes"
            >
              <AlertOctagon className="w-3.5 h-3.5 text-amber-400" />
              <span>{showWaveClashes ? 'Конфлікти хвиль: УВІМК' : 'Оригінальна хвиля'}</span>
            </button>
          </div>

          {/* Center Block: Complete Trigger Parameter Suite */}
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

              {/* Edge Direction */}
              <button
                onClick={() => setTriggerEdge(triggerEdge === 'rising' ? 'falling' : 'rising')}
                className={`w-24 justify-center px-2 py-1 text-xs font-mono font-bold rounded-lg flex items-center gap-1 transition-colors cursor-pointer shrink-0
                  ${
                    triggerEdge === 'rising'
                      ? 'bg-amber-500 text-black'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                title="Toggle Rising ↗ or Falling ↘ Trigger Slope"
              >
                {triggerEdge === 'rising' ? 'Rising ↗' : 'Falling ↘'}
              </button>

              {/* Trigger Level Stepper */}
              <div className="flex items-center gap-1.5 pl-1 border-l border-amber-500/20 shrink-0">
                <span className="text-[10px] uppercase font-mono font-bold text-amber-500">Level:</span>
                <span className="w-16 text-center font-mono text-xs font-bold text-amber-400 tabular-nums inline-block">
                  {triggerLevel >= 0 ? '+' : ''}{triggerLevel.toFixed(2)}V
                </span>
              </div>

              {/* Quick Actions: Auto 50% & Reset 0V */}
              <button
                onClick={handleAutoTriggerLevel}
                className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 transition-all flex items-center gap-1 cursor-pointer shrink-0"
                title="Set Trigger Level to 50% Peak"
              >
                <Wand2 className="w-3 h-3" />
                Auto 50%
              </button>

              <button
                onClick={() => setTriggerLevel(0.0)}
                className="px-1.5 py-1 text-[10px] font-mono rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer shrink-0"
                title="Reset Trigger to 0.00V Zero Crossing"
              >
                0.0V
              </button>
            </div>
          )}

          {/* Right Block: Pure Passive Phase Coherence Readout (Strict Fixed Width - Zero Layout Twitching) */}
          <div className="w-52 flex items-center gap-2.5 shrink-0 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-white/10 shadow-lg">
            <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[9px] uppercase font-mono font-bold text-slate-400 tracking-wider truncate">
                Kick/Bass Phase
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`w-14 inline-block font-mono text-xs font-bold tabular-nums shrink-0 ${
                    phaseCoherence > 0.6 ? 'text-emerald-400' : phaseCoherence > 0.2 ? 'text-amber-400' : 'text-rose-400'
                  }`}
                >
                  {phaseCoherence > 0 ? '+' : ''}{(phaseCoherence * 100).toFixed(0)}%
                </span>
                <span className="w-24 inline-block text-left text-[10px] font-semibold text-slate-400 truncate shrink-0">
                  {phaseCoherence > 0.6 ? 'In Phase' : phaseCoherence > 0.2 ? 'Partial' : 'Phase Cancel!'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2: 1ms to 10s Presets Deck (NO Redundant Slider as Requested) */}
        <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2.5">
          {/* Timebase Label & Fixed-Width Readout */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              Timebase:
            </span>
            <span className="w-24 font-mono text-cyan-400 text-xs sm:text-sm font-bold tabular-nums">
              {timebaseMs >= 1000
                ? `${(timebaseMs / 1000).toFixed(1)}s`
                : `${Math.round(timebaseMs)}ms`}
            </span>
            <span className="text-[10px] font-mono text-slate-500">
              ({timebaseMs >= 1000 ? `${(timebaseMs / 10000).toFixed(2)}s` : `${(timebaseMs / 10).toFixed(1)}ms`}/div)
            </span>
          </div>

          {/* Quick Preset Buttons (1ms to 10s) */}
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            {presets.map((p) => {
              const isSelected = Math.abs(timebaseMs - p.ms) < 0.5;
              return (
                <button
                  key={p.ms}
                  onClick={() => setTimebaseMs(p.ms)}
                  className={`px-2.5 py-1 text-xs font-mono rounded-lg transition-all cursor-pointer border
                    ${
                      isSelected
                        ? 'bg-cyan-500 text-slate-950 font-bold border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.4)]'
                        : 'bg-slate-900 text-slate-400 border-white/5 hover:text-white hover:bg-slate-800'
                    }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Oscilloscope Display Canvas */}
      <div
        className={`relative flex-1 rounded-xl overflow-hidden border border-white/10 shadow-2xl bg-[#05070D]
          ${isHoveringTrigger || isDraggingTrigger ? 'cursor-ns-resize' : 'cursor-crosshair'}`}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          className="w-full h-full block touch-none"
        />

        {/* Live Drag Floating Indicator Toast */}
        {isDraggingTrigger && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none px-3 py-1 rounded-full bg-amber-500 text-black font-mono text-xs font-bold shadow-lg backdrop-blur-md flex items-center gap-1.5 animate-pulse">
            <MoveVertical className="w-3.5 h-3.5" />
            <span>TRIGGER LEVEL: {(triggerLevel >= 0 ? '+' : '') + triggerLevel.toFixed(2)} V</span>
          </div>
        )}
      </div>
    </div>
  );
};
