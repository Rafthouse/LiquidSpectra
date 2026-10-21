/**
 * CollisionView - Intelligent Psychoacoustic Frequency Collision & Masking Resolver
 * Features a Collapsible / Floating Conflict Drawer so it NEVER obstructs the spectrum magnitude,
 * complete horizontal dB scale grid (+12 to -90 dB), frequency scale, and stationary auditionable EQ fixes.
 */

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { AudioTrack, AnalyzerSettings, PersistentCollision } from '../../types/audio';
import { audioEngine } from '../../audio/AudioEngine';
import {
  AlertTriangle,
  Sliders,
  Sparkles,
  Pin,
  Trash2,
  Activity,
  X,
} from 'lucide-react';

interface CollisionViewProps {
  tracks: AudioTrack[];
  settings: AnalyzerSettings;
  onUpdateTrack: (track: AudioTrack) => void;
}

// Stable order: pinned first, then frequent, then by peak severity
function sortRegistry(registry: Map<string, PersistentCollision>): PersistentCollision[] {
  return Array.from(registry.values()).sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    if (a.isFrequent !== b.isFrequent) return a.isFrequent ? -1 : 1;
    return b.peakSeverity - a.peakSeverity;
  });
}

export const CollisionView: React.FC<CollisionViewProps> = ({ tracks, settings, onUpdateTrack }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [threshold, setThreshold] = useState<number>(settings.collisionThreshold || 0.4);
  const [filterMode, setFilterMode] = useState<'frequent' | 'all'>('frequent');

  // Side Drawer state to prevent obstructing the spectrum magnitude
  const [isSideDrawerOpen, setIsSideDrawerOpen] = useState<boolean>(false);

  // Persistent registry map: Key -> PersistentCollision
  const registryRef = useRef<Map<string, PersistentCollision>>(new Map());
  const [persistentList, setPersistentList] = useState<PersistentCollision[]>([]);

  // Periodic collision detection & stability accumulator (runs every 100ms)
  useEffect(() => {
    const interval = window.setInterval(() => {
      const liveEvents = audioEngine.detectCollisions(tracks, threshold);
      const now = Date.now();
      const registry = registryRef.current;

      // Mark all current entries as inactive for this tick
      registry.forEach((entry) => {
        entry.isCurrentlyActive = false;
        // Slow natural decay over 6 seconds if not re-triggered
        entry.smoothedSeverity = Math.max(0, entry.smoothedSeverity - 0.04);
      });

      // Update or insert live collisions
      liveEvents.forEach((ev) => {
        const key = `${ev.trackAId}__${ev.trackBId}__${ev.criticalBand}`;
        const existing = registry.get(key);

        if (existing) {
          existing.occurrenceCount += 1;
          existing.lastSeenTime = now;
          existing.isCurrentlyActive = true;
          existing.peakSeverity = Math.max(existing.peakSeverity, ev.maskingSeverity);
          existing.smoothedSeverity = existing.smoothedSeverity * 0.65 + ev.maskingSeverity * 0.35;
          existing.frequencyHz = ev.frequencyHz;
          existing.suggestedAction = ev.suggestedAction;
          if (existing.occurrenceCount >= 2) {
            existing.isFrequent = true;
          }
        } else {
          const newEntry: PersistentCollision = {
            ...ev,
            key,
            occurrenceCount: 1,
            recentHits: 1,
            isFrequent: false,
            isPinned: false,
            peakSeverity: ev.maskingSeverity,
            smoothedSeverity: ev.maskingSeverity,
            lastSeenTime: now,
            isCurrentlyActive: true,
          };
          registry.set(key, newEntry);
        }
      });

      // Prune entries that have been inactive for > 15 seconds UNLESS they are pinned or frequent
      registry.forEach((entry, key) => {
        if (!entry.isPinned && !entry.isFrequent && now - entry.lastSeenTime > 15000) {
          registry.delete(key);
        }
      });

      setPersistentList(sortRegistry(registry));
    }, 100);

    return () => clearInterval(interval);
  }, [tracks, threshold]);

  // Filtered displayed conflicts (Frequent by default)
  const displayedCollisions = useMemo(() => {
    if (filterMode === 'frequent') {
      const filtered = persistentList.filter((c) => c.isFrequent || c.isPinned);
      return filtered.length > 0 ? filtered : persistentList.slice(0, 4);
    }
    return persistentList;
  }, [persistentList, filterMode]);

  // Canvas visual clash spectrum renderer with smooth curves & full dB magnitude scale
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isDestroyed = false;

    const render = () => {
      if (isDestroyed) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = rect.width;
      const height = rect.height;

      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Background
      const isDark = document.documentElement.classList.contains('dark');
      ctx.fillStyle = isDark ? '#07090E' : '#F8FAFC';
      ctx.fillRect(0, 0, width, height);

      // Draw Critical Bark Frequency Band Columns
      const bands = [
        { name: 'Sub (20-65Hz)', min: 20, max: 65, color: 'rgba(244, 63, 94, 0.06)' },
        { name: 'Bass (65-250Hz)', min: 65, max: 250, color: 'rgba(245, 158, 11, 0.06)' },
        { name: 'Low-Mid (250-500Hz)', min: 250, max: 500, color: 'rgba(16, 185, 129, 0.06)' },
        { name: 'Mid (500-2kHz)', min: 500, max: 2000, color: 'rgba(6, 182, 212, 0.06)' },
        { name: 'High-Mid (2-6kHz)', min: 2000, max: 6000, color: 'rgba(99, 102, 241, 0.06)' },
        { name: 'Presence (6-20kHz)', min: 6000, max: 20000, color: 'rgba(168, 85, 247, 0.06)' },
      ];

      const minLog = Math.log10(20);
      const maxLog = Math.log10(20000);
      const freqToX = (f: number) => ((Math.log10(f) - minLog) / (maxLog - minLog)) * width;

      bands.forEach((b) => {
        const x1 = freqToX(b.min);
        const x2 = freqToX(b.max);

        ctx.fillStyle = b.color;
        ctx.fillRect(x1, 0, x2 - x1, height);

        // Divider
        ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
        ctx.beginPath();
        ctx.moveTo(x2, 0);
        ctx.lineTo(x2, height);
        ctx.stroke();

        // Band Label (Top)
        ctx.font = '10px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.40)' : 'rgba(100, 116, 139, 0.50)';
        ctx.textAlign = 'center';
        ctx.fillText(b.name, (x1 + x2) / 2, 16);
      });

      // ── Complete Horizontal dB Magnitude Grid Lines & Labels ──
      const dbLevels = [0, -12, -24, -36, -48, -60, -72, -90];
      dbLevels.forEach((db) => {
        const y = height - ((db + 90) / 90) * height;

        ctx.strokeStyle = db === 0 ? 'rgba(239, 68, 68, 0.45)' : (isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.07)');
        ctx.lineWidth = db === 0 ? 1.5 : 1;
        ctx.setLineDash(db === 0 ? [] : [3, 4]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // dB Label (Right-aligned or left-aligned on magnitude axis)
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillStyle = db === 0 ? 'rgba(239, 68, 68, 0.85)' : (isDark ? 'rgba(148, 163, 184, 0.60)' : 'rgba(100, 116, 139, 0.70)');
        ctx.textAlign = 'left';
        ctx.fillText(`${db} dB`, 10, Math.min(height - 6, Math.max(14, y - 4)));
      });

      // ── Bottom Frequency Scale Labels ──
      const freqLabels = [30, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 16000];
      freqLabels.forEach((f) => {
        const x = freqToX(f);
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.45)' : 'rgba(100, 116, 139, 0.55)';
        ctx.textAlign = 'center';
        ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x, height - 6);
      });

      // ── Draw Collision Hotspot Beacons directly on the spectrum ──
      displayedCollisions.forEach((c) => {
        if (c.smoothedSeverity < 0.1) return;

        const cx = freqToX(c.frequencyHz);
        const radius = 22 + c.smoothedSeverity * 16;
        const beaconY = height * 0.38;

        // Radial glow
        const glow = ctx.createRadialGradient(cx, beaconY, 0, cx, beaconY, radius * 2);
        glow.addColorStop(0, `rgba(239, 68, 68, ${c.smoothedSeverity * 0.55})`);
        glow.addColorStop(0.5, `rgba(245, 158, 11, ${c.smoothedSeverity * 0.25})`);
        glow.addColorStop(1, 'transparent');

        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, beaconY, radius * 2, 0, Math.PI * 2);
        ctx.fill();

        // Vertical guide line
        ctx.strokeStyle = `rgba(239, 68, 68, ${c.smoothedSeverity * 0.75})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, height);
        ctx.stroke();
        ctx.setLineDash([]);

        // Badge indicator on canvas
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.fillStyle = '#EF4444';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(c.peakSeverity * 100)}% CLASH`, cx, beaconY - radius - 6);

        ctx.fillStyle = isDark ? '#F8FAFC' : '#0F172A';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(`${c.frequencyHz} Hz`, cx, beaconY - radius + 8);
      });

      // ── Draw Smooth Multitrack Curves ──
      const fftSize = audioEngine.getAnalyserFftSize();
      const binCount = fftSize / 2;
      const sampleRate = audioEngine.getSampleRate();
      const binHz = sampleRate / fftSize;
      const buf = new Float32Array(binCount);

      tracks.forEach((track) => {
        if (!track.isVisible) return;
        audioEngine.getTrackFrequencyData(track.id, buf);

        ctx.beginPath();
        const steps = Math.min(width, 450);
        for (let i = 0; i <= steps; i++) {
          const x = (i / steps) * width;
          const normX = x / width;
          const freq = 20 * Math.pow(1000, normX);
          const bin = Math.min(binCount - 1, Math.max(1, Math.round(freq / binHz)));
          const db = buf[bin];
          const y = height - ((db + 90) / 90) * height;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = track.color;
        ctx.lineWidth = 2.0;
        ctx.stroke();
      });

      ctx.restore();
      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      isDestroyed = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [tracks, displayedCollisions]);

  // Focus Pair on Visualizer (Zero sound distortion - purely visual isolation)
  const handleFocusClash = (collision: PersistentCollision) => {
    tracks.forEach((t) => {
      const isClashing = t.id === collision.trackAId || t.id === collision.trackBId;
      onUpdateTrack({
        ...t,
        isVisible: isClashing,
      });
    });
  };

  // Toggle Pin on a conflict
  const handleTogglePin = (key: string) => {
    const registry = registryRef.current;
    const entry = registry.get(key);
    if (entry) {
      entry.isPinned = !entry.isPinned;
      setPersistentList(sortRegistry(registry));
    }
  };

  // Clear / Reset All Detected Conflicts
  const handleClearCollisions = () => {
    registryRef.current.clear();
    setPersistentList([]);
  };

  return (
    <div className="relative w-full h-full flex flex-col select-none overflow-hidden rounded-xl border border-white/20 dark:border-white/10 shadow-inner bg-[#07090E]">
      {/* ── Main Full-Screen Visual Clash Spectrum Canvas ── */}
      <div className="relative w-full flex-1 min-h-0 overflow-hidden">
        <canvas ref={canvasRef} className="w-full h-full block" />

        {/* Top Control Bar (HUD Title, Sensitivity, and Conflicts Trigger Button) */}
        <div className="absolute top-2.5 left-3 right-3 z-30 flex items-center justify-between pointer-events-none">
          {/* Left: Section Title & Live Status */}
          <div className="flex items-center gap-2 bg-slate-900/90 backdrop-blur-xl px-3 py-1.5 rounded-xl border border-white/10 text-white shadow-xl pointer-events-auto">
            <Activity className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Psychoacoustic Collision Scope
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 font-semibold hidden md:inline">
              Critical Bands
            </span>
          </div>

          {/* Right: Sensitivity + Side Drawer Open Trigger */}
          <div className="flex items-center gap-2 pointer-events-auto">
            {/* Sensitivity Slider */}
            <div className="hidden sm:flex items-center gap-2 bg-slate-900/90 backdrop-blur-xl px-3 py-1.5 rounded-xl border border-white/10 text-white shadow-xl">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                Sensitivity:
              </span>
              <input
                type="range"
                min="0.2"
                max="0.8"
                step="0.05"
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
                className="w-16 accent-cyan-400 cursor-pointer"
              />
              <span className="text-xs font-mono text-cyan-400 font-bold tabular-nums">
                {Math.round((1 - threshold) * 100)}%
              </span>
            </div>

            {/* Clear History */}
            <button
              onClick={handleClearCollisions}
              className="p-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-400 hover:text-rose-400 border border-white/10 shadow-xl transition-colors cursor-pointer"
              title="Скинути історію конфліктів"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            {/* Top Side-Menu Trigger Button */}
            <button
              onClick={() => setIsSideDrawerOpen(!isSideDrawerOpen)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl backdrop-blur-xl border text-xs font-semibold transition-all cursor-pointer shadow-xl
                ${
                  isSideDrawerOpen
                    ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold shadow-amber-500/20'
                    : displayedCollisions.length > 0
                    ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.25)]'
                    : 'bg-slate-900/90 hover:bg-slate-800 text-slate-300 border-white/10'
                }`}
              title={isSideDrawerOpen ? 'Закрити панель конфліктів' : 'Відкрити бокове меню конфліктів'}
            >
              <AlertTriangle className={`w-3.5 h-3.5 ${isSideDrawerOpen ? 'text-slate-950' : 'text-amber-400 animate-pulse'}`} />
              <span>Конфлікти ({displayedCollisions.length})</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-black/25">
                {isSideDrawerOpen ? '✕' : '☰'}
              </span>
            </button>
          </div>
        </div>

        {/* ── Slide-Out Side Drawer (Випадаюче бокове меню праворуч) ── */}
        {isSideDrawerOpen && (
          <aside className="absolute top-0 right-0 bottom-0 z-40 w-80 md:w-96 bg-slate-950/95 backdrop-blur-2xl border-l border-amber-500/30 shadow-2xl flex flex-col p-3.5 animate-in fade-in slide-in-from-right-4 duration-200">
            {/* Drawer Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 animate-pulse" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Частотні конфлікти ({displayedCollisions.length})
                </h3>
              </div>

              <div className="flex items-center gap-1.5">
                {/* Filter: Frequent vs All */}
                <div className="flex items-center gap-0.5 bg-slate-900 p-0.5 rounded-lg border border-white/10 text-[11px]">
                  <button
                    onClick={() => setFilterMode('frequent')}
                    className={`px-2 py-0.5 rounded transition-all font-semibold ${
                      filterMode === 'frequent'
                        ? 'bg-cyan-500 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Frequent
                  </button>
                  <button
                    onClick={() => setFilterMode('all')}
                    className={`px-2 py-0.5 rounded transition-all font-semibold ${
                      filterMode === 'all'
                        ? 'bg-cyan-500 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    All ({persistentList.length})
                  </button>
                </div>

                {/* Close Drawer Button (X) */}
                <button
                  onClick={() => setIsSideDrawerOpen(false)}
                  className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer border border-white/5"
                  title="Закрити бічну панель"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Sub-Header Controls: Sensitivity slider */}
            <div className="flex items-center justify-between py-2 border-b border-white/5 text-xs text-slate-400 shrink-0">
              <span className="text-[11px] uppercase font-semibold">Поріг чутливості:</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.2"
                  max="0.8"
                  step="0.05"
                  value={threshold}
                  onChange={(e) => setThreshold(parseFloat(e.target.value))}
                  className="w-20 accent-cyan-400 cursor-pointer"
                />
                <span className="text-xs font-mono text-cyan-400 font-bold tabular-nums">
                  {Math.round((1 - threshold) * 100)}%
                </span>
              </div>
            </div>

            {/* Scrollable Conflict Cards List */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 pt-2.5 pr-1">
              {displayedCollisions.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 flex flex-col items-center justify-center text-center gap-2 my-auto">
                  <Activity className="w-6 h-6 text-cyan-500 animate-pulse" />
                  <p className="text-xs font-semibold text-white">
                    Не виявлено частотних конфліктів
                  </p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Увімкніть відтворення доріжок або підніміть чутливість для виявлення зон маскування.
                  </p>
                </div>
              ) : (
                displayedCollisions.map((c) => {
                  return (
                    <div
                      key={c.key}
                      className={`p-3 rounded-xl transition-all duration-200 border flex flex-col gap-2 shadow-sm
                        ${
                          c.isCurrentlyActive
                            ? 'bg-slate-900/95 border-amber-500/50 ring-1 ring-amber-500/30'
                            : 'bg-slate-900/70 border-white/10'
                        }`}
                    >
                      {/* Top line: Clash tag, Track names, Frequency */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] font-mono font-bold text-rose-400 bg-rose-500/15 px-1.5 py-0.5 rounded border border-rose-500/20 shrink-0">
                            {Math.round(c.peakSeverity * 100)}% CLASH
                          </span>

                          <span className="text-xs font-bold text-white truncate">
                            {c.trackAName} <span className="text-slate-400 font-normal">vs</span> {c.trackBName}
                          </span>

                          {c.occurrenceCount > 1 && (
                            <span className="text-[10px] font-mono text-cyan-400 font-semibold px-1 py-0.2 rounded bg-cyan-500/10 shrink-0">
                              {c.occurrenceCount}x
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-xs font-mono font-bold text-amber-400">
                            {c.frequencyHz} Hz
                          </span>

                          <button
                            onClick={() => handleTogglePin(c.key)}
                            className={`p-1 rounded text-xs transition-colors cursor-pointer ${
                              c.isPinned ? 'text-cyan-400' : 'text-slate-500 hover:text-white'
                            }`}
                            title={c.isPinned ? 'Відкріпити конфлікт' : 'Закріпити конфлікт'}
                          >
                            <Pin className="w-3 h-3 fill-current" />
                          </button>
                        </div>
                      </div>

                      {/* Conflict Description */}
                      <p className="text-[11px] text-slate-400 leading-tight">
                        {c.description}
                      </p>

                      {/* Recommendation Action Bar */}
                      <div className="flex items-center justify-between pt-1.5 border-t border-white/5 gap-2">
                        <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-300 truncate">
                          <Sliders className="w-3 h-3 text-cyan-400 shrink-0" />
                          <span className="truncate">
                            Overlap zone: {c.frequencyHz} Hz (Critical Band)
                          </span>
                        </div>

                        <button
                          onClick={() => handleFocusClash(c)}
                          className="px-2.5 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 shadow-sm shrink-0 cursor-pointer bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40"
                          title="Isolate these two tracks on the spectrum display to visually inspect masking"
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>Focus Tracks</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
