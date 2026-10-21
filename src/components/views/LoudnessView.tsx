/**
 * LoudnessView - ITU-R BS.1770-4 & EBU R128 Precision Loudness Suite
 * Precision metering: Integrated LUFS, Short-Term LUFS, Momentary LUFS, True Peak (dBTP),
 * with real-time decay dynamics (Fast 70dB/s, Medium 20dB/s, Slow 5dB/s, Hold Infinite),
 * synchronized with bottom parameter shelf Decay buttons, peak hold needles, and multitrack stem meters.
 */

import React, { useEffect, useState, useRef } from 'react';
import { AudioTrack, AnalyzerSettings, LoudnessMetrics } from '../../types/audio';
import { audioEngine } from '../../audio/AudioEngine';
import { RotateCcw, Activity, Target, Clock, Zap } from 'lucide-react';

interface LoudnessViewProps {
  tracks: AudioTrack[];
  settings: AnalyzerSettings;
  onUpdateSettings?: (settings: AnalyzerSettings) => void;
}

interface DecayedValues {
  momentary: number;
  shortTerm: number;
  truePeak: number;
  peakHoldMomentary: number;
  peakHoldTruePeak: number;
}

interface TrackLoudnessEntry {
  id: string;
  name: string;
  color: string;
  lufs: number;
  peakDb: number;
  decayedLufs: number;
}

export const LoudnessView: React.FC<LoudnessViewProps> = ({
  tracks,
  settings,
  onUpdateSettings,
}) => {
  // Directly driven by settings.decaySpeed - synchronized everywhere!
  const currentDecay = settings.decaySpeed || 'medium';
  const [selectedTarget, setSelectedTarget] = useState<number>(-14); // -14 LUFS default

  const [rawMetrics, setRawMetrics] = useState<LoudnessMetrics>({
    momentaryLufs: -70,
    shortTermLufs: -70,
    integratedLufs: -70,
    truePeakDb: -70,
    crestFactorDb: 0,
    loudnessRangeLu: 0,
  });

  const [decayed, setDecayed] = useState<DecayedValues>({
    momentary: -70,
    shortTerm: -70,
    truePeak: -70,
    peakHoldMomentary: -70,
    peakHoldTruePeak: -70,
  });

  const [trackLoudness, setTrackLoudness] = useState<TrackLoudnessEntry[]>([]);
  const [history, setHistory] = useState<number[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Keep ref for current decayed state so polling interval doesn't close over stale values
  const decayedRef = useRef<DecayedValues>(decayed);
  decayedRef.current = decayed;

  const trackDecayedRef = useRef<Map<string, number>>(new Map());

  // Set decay speed helper
  const handleSelectDecay = (speed: 'fast' | 'medium' | 'slow' | 'hold') => {
    if (onUpdateSettings) {
      onUpdateSettings({ ...settings, decaySpeed: speed });
    }
  };

  // Reset metering and peak holds
  const handleReset = () => {
    audioEngine.resetLoudness();
    const minVal = -70;
    const fresh = {
      momentary: minVal,
      shortTerm: minVal,
      truePeak: minVal,
      peakHoldMomentary: minVal,
      peakHoldTruePeak: minVal,
    };
    setDecayed(fresh);
    decayedRef.current = fresh;
    setHistory([]);
    trackDecayedRef.current.clear();
  };

  // High-frequency 50ms audio polling and Decay simulation
  useEffect(() => {
    const interval = window.setInterval(() => {
      const m = audioEngine.calculateLoudness();
      setRawMetrics(m);

      // Determine decay rates in dB per tick (50ms interval = 20 ticks/sec)
      // Fast: ~70 dB/sec -> 3.5 dB per 50ms tick
      // Medium: ~20 dB/sec -> 1.0 dB per 50ms tick
      // Slow: ~5 dB/sec -> 0.25 dB per 50ms tick
      // Hold: 0.0 dB per tick (frozen peak until reset)
      let fallRateDb = 1.0;
      let peakHoldFallRateDb = 0.35;

      if (currentDecay === 'fast') {
        fallRateDb = 3.5;
        peakHoldFallRateDb = 1.5;
      } else if (currentDecay === 'medium') {
        fallRateDb = 1.0;
        peakHoldFallRateDb = 0.35;
      } else if (currentDecay === 'slow') {
        fallRateDb = 0.25;
        peakHoldFallRateDb = 0.08;
      } else if (currentDecay === 'hold') {
        fallRateDb = 0.0; // Infinite peak hold!
        peakHoldFallRateDb = 0.0;
      }

      const prev = decayedRef.current;

      // Momentary bar: instant attack on louder audio, decay falloff when quiet
      const nextMom =
        currentDecay === 'hold'
          ? Math.max(prev.momentary, m.momentaryLufs)
          : m.momentaryLufs > prev.momentary
          ? m.momentaryLufs
          : Math.max(-70, prev.momentary - fallRateDb);

      // Short term bar: smooth attack & decay
      const nextSt =
        currentDecay === 'hold'
          ? Math.max(prev.shortTerm, m.shortTermLufs)
          : m.shortTermLufs > prev.shortTerm
          ? m.shortTermLufs
          : Math.max(-70, prev.shortTerm - fallRateDb * 0.7);

      // True peak bar: instant attack, decay release
      const nextTp =
        currentDecay === 'hold'
          ? Math.max(prev.truePeak, m.truePeakDb)
          : m.truePeakDb > prev.truePeak
          ? m.truePeakDb
          : Math.max(-70, prev.truePeak - fallRateDb * 1.4);

      // Peak Hold needles: jump to new maximum, decay slowly or hold forever
      const nextHoldMom =
        currentDecay === 'hold'
          ? Math.max(prev.peakHoldMomentary, m.momentaryLufs)
          : m.momentaryLufs > prev.peakHoldMomentary
          ? m.momentaryLufs
          : Math.max(-70, prev.peakHoldMomentary - peakHoldFallRateDb);

      const nextHoldTp =
        currentDecay === 'hold'
          ? Math.max(prev.peakHoldTruePeak, m.truePeakDb)
          : m.truePeakDb > prev.peakHoldTruePeak
          ? m.truePeakDb
          : Math.max(-70, prev.peakHoldTruePeak - peakHoldFallRateDb);

      const newDecayed = {
        momentary: nextMom,
        shortTerm: nextSt,
        truePeak: nextTp,
        peakHoldMomentary: nextHoldMom,
        peakHoldTruePeak: nextHoldTp,
      };

      setDecayed(newDecayed);
      decayedRef.current = newDecayed;
      setHistory((prevH) => [...prevH.slice(-140), nextMom]);

      // Calculate individual active track loudness with decay
      const visibleTracks = tracks.filter((t) => t.isVisible);
      const trackEntries: TrackLoudnessEntry[] = visibleTracks.map((t) => {
        const tMetrics = audioEngine.calculateTrackLoudness(t.id);
        const prevDecayed = trackDecayedRef.current.get(t.id) ?? -70;
        const nextDecayed =
          currentDecay === 'hold'
            ? Math.max(prevDecayed, tMetrics.momentaryLufs)
            : tMetrics.momentaryLufs > prevDecayed
            ? tMetrics.momentaryLufs
            : Math.max(-70, prevDecayed - fallRateDb);

        trackDecayedRef.current.set(t.id, nextDecayed);

        return {
          id: t.id,
          name: t.name,
          color: t.color,
          lufs: tMetrics.momentaryLufs,
          peakDb: tMetrics.truePeakDb,
          decayedLufs: nextDecayed,
        };
      });
      setTrackLoudness(trackEntries);
    }, 50);

    return () => clearInterval(interval);
  }, [currentDecay, tracks]);

  // Draw continuous loudness timeline graph
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Background
    const isDark = document.documentElement.classList.contains('dark');
    ctx.fillStyle = isDark ? '#06080E' : '#F8FAFC';
    ctx.fillRect(0, 0, width, height);

    // Reference Target Lines
    const targets = [
      { lufs: -9, label: 'Club Master (-9 LUFS)', color: 'rgba(239, 68, 68, 0.45)' },
      { lufs: -14, label: 'Spotify / YouTube (-14 LUFS)', color: 'rgba(16, 185, 129, 0.65)' },
      { lufs: -16, label: 'Apple Music (-16 LUFS)', color: 'rgba(6, 182, 212, 0.65)' },
      { lufs: -23, label: 'EBU R128 (-23 LUFS)', color: 'rgba(245, 158, 11, 0.55)' },
    ];

    const lufsToY = (l: number) => {
      const minL = -45;
      const maxL = 0;
      const norm = (l - minL) / (maxL - minL);
      return height - norm * height;
    };

    // Draw active target highlight band (±1 LU)
    const targetBandTop = lufsToY(selectedTarget + 1);
    const targetBandBottom = lufsToY(selectedTarget - 1);
    ctx.fillStyle = 'rgba(6, 182, 212, 0.08)';
    ctx.fillRect(0, targetBandTop, width, targetBandBottom - targetBandTop);

    targets.forEach((t) => {
      const y = lufsToY(t.lufs);
      const isSelected = t.lufs === selectedTarget;

      ctx.strokeStyle = isSelected ? '#06B6D4' : t.color;
      ctx.lineWidth = isSelected ? 1.5 : 1;
      ctx.setLineDash(isSelected ? [] : [3, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.font = isSelected ? 'bold 10px "JetBrains Mono", monospace' : '10px "JetBrains Mono", monospace';
      ctx.fillStyle = isSelected ? '#06B6D4' : t.color;
      ctx.textAlign = 'right';
      ctx.fillText(t.label, width - 8, y - 4);
    });
    ctx.setLineDash([]);

    // Draw History Line with Smooth Glow
    if (history.length > 1) {
      // Area Fill
      ctx.beginPath();
      const step = width / (history.length - 1);
      ctx.moveTo(0, height);
      history.forEach((l, idx) => {
        const x = idx * step;
        const y = Math.max(0, Math.min(height, lufsToY(l)));
        ctx.lineTo(x, y);
      });
      ctx.lineTo(width, height);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, 'rgba(6, 182, 212, 0.25)');
      grad.addColorStop(1, 'rgba(6, 182, 212, 0.0)');
      ctx.fillStyle = grad;
      ctx.fill();

      // Line Trace
      ctx.beginPath();
      history.forEach((l, idx) => {
        const x = idx * step;
        const y = Math.max(0, Math.min(height, lufsToY(l)));
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      ctx.strokeStyle = '#06B6D4';
      ctx.lineWidth = 2.2;
      ctx.shadowColor = '#06B6D4';
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }, [history, selectedTarget]);

  // Convert LUFS to meter bar height percentage (-60 to 0)
  const lufsToPct = (lufs: number) => {
    return Math.max(0, Math.min(100, ((lufs + 60) / 60) * 100));
  };

  return (
    <div className="w-full h-full flex flex-col gap-3 select-none overflow-hidden">
      {/* Top Precision Toolbar: Decay Speed, Target Profile, and Reset */}
      <div className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/75 backdrop-blur-xl border border-white/60 dark:border-white/10 shadow-sm flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Left: Interactive Decay Ballistics Selector (Synced with Bottom Shelf) */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
            <Clock className="w-3.5 h-3.5 text-cyan-500" />
            <span>Decay Ballistics:</span>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-white/5">
            {[
              { id: 'fast', label: 'Fast (70 dB/s)', desc: 'Snappy punchy falloff' },
              { id: 'medium', label: 'Medium (20 dB/s)', desc: 'Standard EBU broadcast response' },
              { id: 'slow', label: 'Slow (5 dB/s)', desc: 'Smooth sustained monitoring' },
              { id: 'hold', label: 'Peak Hold (∞)', desc: 'Infinite highest peak hold' },
            ].map((d) => (
              <button
                key={d.id}
                onClick={() => handleSelectDecay(d.id as 'fast' | 'medium' | 'slow' | 'hold')}
                title={d.desc}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all
                  ${
                    currentDecay === d.id
                      ? 'bg-cyan-500 text-white font-bold shadow-sm ring-1 ring-cyan-400'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
              >
                {d.label}
              </button>
            ))}
          </div>

          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Zap className="w-3 h-3 text-cyan-400 animate-pulse" />
            {currentDecay.toUpperCase()} ACTIVE
          </span>
        </div>

        {/* Center: Target Loudness Profiles */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
            <Target className="w-3.5 h-3.5 text-emerald-500" />
            <span>Target:</span>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-white/5">
            {[
              { lufs: -14, label: 'Spotify (-14)' },
              { lufs: -16, label: 'Apple (-16)' },
              { lufs: -23, label: 'EBU (-23)' },
              { lufs: -9, label: 'Club (-9)' },
            ].map((t) => (
              <button
                key={t.lufs}
                onClick={() => setSelectedTarget(t.lufs)}
                className={`px-2 py-0.5 text-xs font-mono rounded transition-all
                  ${
                    selectedTarget === t.lufs
                      ? 'bg-emerald-500 text-white font-bold shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Reset Metering Engine */}
        <button
          onClick={handleReset}
          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-rose-500/20 text-slate-700 dark:text-slate-300 hover:text-rose-400 border border-slate-300 dark:border-white/10 transition-all flex items-center gap-1.5"
          title="Reset Integrated LUFS, History and Peak Holds"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset LUFS</span>
        </button>
      </div>

      {/* Main Loudness Area: Towers + KPI + History + Multitrack Matrix */}
      <div className="flex-1 flex flex-col md:flex-row gap-3 min-h-0 overflow-hidden">
        {/* Precision Vertical Meter Towers (Direct Real-time Decayed Heights & Peak Needles) */}
        <div className="flex items-end gap-2.5 p-3 rounded-xl bg-white/75 dark:bg-slate-900/70 backdrop-blur-xl border border-white/60 dark:border-white/10 shadow-sm shrink-0">
          {/* Momentary Bar with Decay & Peak Hold */}
          <div className="flex flex-col items-center gap-1.5 w-14 h-full">
            <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 uppercase">
              Momentary
            </span>
            <div className="relative flex-1 w-8 bg-slate-200 dark:bg-slate-800/90 rounded-lg overflow-hidden flex items-end p-0.5">
              {/* Active decaying meter fill with smooth physics interpolation */}
              <div
                className="w-full rounded bg-gradient-to-t from-cyan-500 via-emerald-400 to-rose-500"
                style={{
                  height: `${lufsToPct(decayed.momentary)}%`,
                  transition: 'height 40ms ease-out',
                }}
              />

              {/* Peak Hold Needle */}
              <div
                className="absolute left-0 right-0 h-1 bg-white shadow-md z-10"
                style={{
                  bottom: `${lufsToPct(decayed.peakHoldMomentary)}%`,
                  transition: 'bottom 40ms ease-out',
                }}
              />
            </div>
            <span className="text-xs font-mono font-bold text-slate-800 dark:text-white tabular-nums">
              {decayed.momentary.toFixed(1)}
            </span>
            <span className="text-[9px] font-mono text-slate-400">LUFS</span>
          </div>

          {/* Short-Term Bar */}
          <div className="flex flex-col items-center gap-1.5 w-14 h-full">
            <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 uppercase">
              Short-Term
            </span>
            <div className="relative flex-1 w-8 bg-slate-200 dark:bg-slate-800/90 rounded-lg overflow-hidden flex items-end p-0.5">
              <div
                className="w-full rounded bg-gradient-to-t from-cyan-500 via-emerald-400 to-rose-500"
                style={{
                  height: `${lufsToPct(decayed.shortTerm)}%`,
                  transition: 'height 40ms ease-out',
                }}
              />
            </div>
            <span className="text-xs font-mono font-bold text-slate-800 dark:text-white tabular-nums">
              {decayed.shortTerm.toFixed(1)}
            </span>
            <span className="text-[9px] font-mono text-slate-400">LUFS</span>
          </div>

          {/* Integrated Bar */}
          <div className="flex flex-col items-center gap-1.5 w-14 h-full">
            <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 uppercase">
              Integrated
            </span>
            <div className="relative flex-1 w-8 bg-slate-200 dark:bg-slate-800/90 rounded-lg overflow-hidden flex items-end p-0.5">
              <div
                className="w-full rounded bg-gradient-to-t from-cyan-500 via-emerald-400 to-amber-500"
                style={{
                  height: `${lufsToPct(rawMetrics.integratedLufs)}%`,
                  transition: 'height 60ms ease-out',
                }}
              />
            </div>
            <span className="text-xs font-mono font-bold text-cyan-500 dark:text-cyan-400 tabular-nums">
              {rawMetrics.integratedLufs.toFixed(1)}
            </span>
            <span className="text-[9px] font-mono text-slate-400">LUFS</span>
          </div>

          {/* True Peak Bar with Decay & Clip Alert */}
          <div className="flex flex-col items-center gap-1.5 w-14 h-full">
            <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 uppercase">
              True Peak
            </span>
            <div className="relative flex-1 w-8 bg-slate-200 dark:bg-slate-800/90 rounded-lg overflow-hidden flex items-end p-0.5">
              <div
                className={`w-full rounded ${
                  decayed.truePeak > -0.1 ? 'bg-rose-500' : 'bg-emerald-400'
                }`}
                style={{
                  height: `${Math.max(0, Math.min(100, ((decayed.truePeak + 40) / 46) * 100))}%`,
                  transition: 'height 40ms ease-out',
                }}
              />

              {/* Peak Hold Needle */}
              <div
                className="absolute left-0 right-0 h-1 bg-amber-400 shadow-md z-10"
                style={{
                  bottom: `${Math.max(0, Math.min(100, ((decayed.peakHoldTruePeak + 40) / 46) * 100))}%`,
                  transition: 'bottom 40ms ease-out',
                }}
              />
            </div>
            <span
              className={`text-xs font-mono font-bold tabular-nums ${
                decayed.truePeak > -0.1 ? 'text-rose-500' : 'text-slate-800 dark:text-white'
              }`}
            >
              {decayed.truePeak.toFixed(1)}
            </span>
            <span className="text-[9px] font-mono text-slate-400">dBTP</span>
          </div>
        </div>

        {/* Center: Main Loudness Timeline Graph & KPI Tiles */}
        <div className="flex-1 flex flex-col gap-2.5 min-h-0 min-w-0">
          {/* KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 shrink-0">
            <div className="p-2.5 rounded-xl bg-white/70 dark:bg-slate-800/70 border border-white/40 dark:border-white/10 backdrop-blur-md">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                Integrated LUFS
              </span>
              <div className="text-lg font-mono font-bold text-cyan-500 dark:text-cyan-400 mt-0.5 tabular-nums">
                {rawMetrics.integratedLufs.toFixed(1)} <span className="text-xs text-slate-400 font-normal">LUFS</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-white/70 dark:bg-slate-800/70 border border-white/40 dark:border-white/10 backdrop-blur-md">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                Peak Ceiling (dBTP)
              </span>
              <div
                className={`text-lg font-mono font-bold mt-0.5 tabular-nums ${
                  rawMetrics.truePeakDb > -1.0 ? 'text-amber-500' : 'text-slate-800 dark:text-white'
                }`}
              >
                {rawMetrics.truePeakDb.toFixed(1)} <span className="text-xs text-slate-400 font-normal">dBTP</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-white/70 dark:bg-slate-800/70 border border-white/40 dark:border-white/10 backdrop-blur-md">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                Crest Factor
              </span>
              <div className="text-lg font-mono font-bold text-slate-800 dark:text-white mt-0.5 tabular-nums">
                {rawMetrics.crestFactorDb.toFixed(1)} <span className="text-xs text-slate-400 font-normal">dB</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-white/70 dark:bg-slate-800/70 border border-white/40 dark:border-white/10 backdrop-blur-md">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                Loudness Range (LRA)
              </span>
              <div className="text-lg font-mono font-bold text-slate-800 dark:text-white mt-0.5 tabular-nums">
                {rawMetrics.loudnessRangeLu.toFixed(1)} <span className="text-xs text-slate-400 font-normal">LU</span>
              </div>
            </div>
          </div>

          {/* Rolling Waveform / Loudness History Canvas */}
          <div className="relative flex-1 rounded-xl overflow-hidden border border-white/40 dark:border-white/10 shadow-inner bg-[#06080E] min-h-[140px]">
            <canvas ref={canvasRef} className="w-full h-full block" />
          </div>
        </div>

        {/* Right: Per-Track Stem Loudness Comparison with Real-time Decay */}
        <div className="w-full md:w-64 flex flex-col gap-2 p-3 rounded-xl bg-white/75 dark:bg-slate-900/70 backdrop-blur-xl border border-white/60 dark:border-white/10 shadow-sm shrink-0 overflow-y-auto">
          <div className="flex items-center justify-between pb-1 border-b border-slate-200/60 dark:border-white/10">
            <span className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-cyan-500" />
              Stem Loudness
            </span>
            <span className="text-[10px] font-mono text-cyan-400 font-bold uppercase">
              {currentDecay} decay
            </span>
          </div>

          <div className="flex flex-col gap-2 overflow-y-auto pr-1">
            {trackLoudness.map((tl) => (
              <div
                key={tl.id}
                className="p-2 rounded-lg bg-white/50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-white/5 flex flex-col gap-1"
                style={{ borderLeftWidth: '3px', borderLeftColor: tl.color }}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800 dark:text-white truncate">
                    {tl.name}
                  </span>
                  <span className="font-mono font-bold text-slate-600 dark:text-slate-300 text-[11px] tabular-nums">
                    {tl.decayedLufs.toFixed(1)} LUFS
                  </span>
                </div>

                {/* Horizontal Decaying Meter Bar */}
                <div className="relative h-2 bg-slate-200 dark:bg-slate-700 rounded overflow-hidden flex items-center">
                  <div
                    className="h-full rounded"
                    style={{
                      backgroundColor: tl.color,
                      width: `${lufsToPct(tl.decayedLufs)}%`,
                      transition: 'width 40ms ease-out',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
