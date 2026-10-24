/**
 * FabFilterBottomBar - Ultra-minimal, contextual popover status bar
 * Replaces bulky static shelves with FabFilter-style inline text widgets and floating dark glass popovers.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  AnalyzerSettings,
  FrequencyScale,
  SmoothingMode,
  SpectralTilt,
  AudioTrack,
  DisplayRange,
  DISPLAY_RANGE_PRESETS,
} from '../../types/audio';
import {
  Activity,
  ChevronDown,
  RotateCcw,
  SlidersHorizontal,
  X,
  Eye,
  EyeOff,
} from 'lucide-react';
import { isPluginHost } from '../../plugin/pluginBridge';

// Inside the plugin the host owns the audio: microphone, solo/mute and FFT size are not available
const pluginHost = isPluginHost();

interface FabFilterBottomBarProps {
  settings: AnalyzerSettings;
  onUpdateSettings: (settings: AnalyzerSettings) => void;
  tracks: AudioTrack[];
  onUpdateTrack: (track: AudioTrack) => void;
  isMicActive: boolean;
  onToggleMic: () => void;
}

type ActivePopover = 'analyzer' | 'range' | 'masking' | 'tracks' | 'output' | null;

export const FabFilterBottomBar: React.FC<FabFilterBottomBarProps> = ({
  settings,
  onUpdateSettings,
  tracks,
  onUpdateTrack,
  isMicActive,
  onToggleMic,
}) => {
  const [activePopover, setActivePopover] = useState<ActivePopover>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  // Close popovers on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setActivePopover(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const togglePopover = (name: ActivePopover) => {
    setActivePopover((prev) => (prev === name ? null : name));
  };

  // Exclusive solo; the engine silences non-solo tracks, so user mute states stay untouched
  const handleToggleSolo = (track: AudioTrack) => {
    const newSolo = !track.isSolo;
    tracks.forEach((t) => {
      const isSolo = t.id === track.id ? newSolo : false;
      if (t.isSolo !== isSolo) onUpdateTrack({ ...t, isSolo });
    });
  };

  return (
    <div ref={barRef} className="relative z-40 shrink-0 select-none">
      {/* ─── POPOVER 1: ANALYZER DSP SETTINGS ─── */}
      {activePopover === 'analyzer' && (
        <div className="absolute bottom-11 left-4 z-50 w-80 p-4 rounded-2xl bg-slate-950/95 backdrop-blur-2xl border border-white/15 text-white shadow-2xl flex flex-col gap-3.5 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Параметри спектроаналізатора
              </span>
            </div>
            <button
              onClick={() => setActivePopover(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Mode: Curve / Octave Bars / Stepped */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
              Режим відображення
            </span>
            <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-xl border border-white/5 text-xs font-semibold">
              {[
                { id: 'curve', label: 'Curve' },
                { id: 'bars', label: 'Octave Bars' },
                { id: 'stepped', label: 'Stepped' },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() =>
                    onUpdateSettings({
                      ...settings,
                      spectrumStyle: m.id as 'curve' | 'bars' | 'stepped',
                    })
                  }
                  className={`py-1 rounded-lg transition-all text-center ${
                    (settings.spectrumStyle || 'curve') === m.id
                      ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Resolution (FFT Size): the plugin host runs a fixed 4096-point analysis */}
          {!pluginHost && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                Роздільність FFT
              </span>
              <div className="grid grid-cols-4 gap-1 bg-slate-900 p-1 rounded-xl border border-white/5 text-xs font-mono font-semibold">
                {[1024, 2048, 4096, 8192].map((size) => (
                  <button
                    key={size}
                    onClick={() =>
                      onUpdateSettings({
                        ...settings,
                        fftSize: size as 1024 | 2048 | 4096 | 8192,
                      })
                    }
                    className={`py-1 rounded-lg transition-all text-center ${
                      settings.fftSize === size
                        ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Octave Smoothing */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
              Октавне згладжування (Smoothing)
            </span>
            <div className="grid grid-cols-5 gap-1 bg-slate-900 p-1 rounded-xl border border-white/5 text-[11px] font-mono font-semibold">
              {(['none', '1/24', '1/12', '1/6', '1/3'] as SmoothingMode[]).map((sm) => (
                <button
                  key={sm}
                  onClick={() => onUpdateSettings({ ...settings, smoothing: sm })}
                  className={`py-1 rounded-lg transition-all text-center ${
                    settings.smoothing === sm
                      ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {sm === 'none' ? 'None' : sm}
                </button>
              ))}
            </div>
          </div>

          {/* Scale & Tilt */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                Шкала
              </span>
              <select
                value={settings.frequencyScale}
                onChange={(e) =>
                  onUpdateSettings({
                    ...settings,
                    frequencyScale: e.target.value as FrequencyScale,
                  })
                }
                className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-xs text-white outline-none cursor-pointer"
              >
                <option value="log">Logarithmic</option>
                <option value="bark">Bark Scale</option>
                <option value="mel">Mel Scale</option>
                <option value="linear">Linear</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                Спектральний Tilt
              </span>
              <select
                value={settings.tilt}
                onChange={(e) =>
                  onUpdateSettings({
                    ...settings,
                    tilt: e.target.value as SpectralTilt,
                  })
                }
                className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-xs text-white outline-none cursor-pointer"
              >
                <option value="0dB">0.0 dB/oct (Flat)</option>
                <option value="+3dB">+3.0 dB/oct</option>
                <option value="+4.5dB">+4.5 dB/oct (FabFilter)</option>
              </select>
            </div>
          </div>

          {/* Quick Toggles: Freeze, Peak Hold */}
          <div className="flex items-center justify-between pt-1 border-t border-white/5 text-xs">
            <button
              onClick={() => onUpdateSettings({ ...settings, isFrozen: !settings.isFrozen })}
              className={`px-3 py-1.5 rounded-lg border font-semibold flex items-center gap-1.5 transition-all ${
                settings.isFrozen
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-slate-900 text-slate-400 border-white/10 hover:text-white'
              }`}
            >
              <RotateCcw className="w-3 h-3" />
              <span>{settings.isFrozen ? 'Unfreeze' : 'Freeze'}</span>
            </button>

            <button
              onClick={() => onUpdateSettings({ ...settings, peakHold: !settings.peakHold })}
              className={`px-3 py-1.5 rounded-lg border font-semibold flex items-center gap-1.5 transition-all ${
                settings.peakHold
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                  : 'bg-slate-900 text-slate-400 border-white/10 hover:text-white'
              }`}
            >
              <span>Peak Hold: {settings.peakHold ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        </div>
      )}

      {/* ─── POPOVER 2: DISPLAY RANGE ─── */}
      {activePopover === 'range' && (
        <div className="absolute bottom-11 left-48 z-50 w-56 p-3.5 rounded-2xl bg-slate-950/95 backdrop-blur-2xl border border-white/15 text-white shadow-2xl flex flex-col gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Діапазон dB (Range)
            </span>
            <button onClick={() => setActivePopover(null)} className="text-slate-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1.5 font-mono text-xs">
            {(Object.keys(DISPLAY_RANGE_PRESETS) as DisplayRange[]).map((id) => ({ id, min: DISPLAY_RANGE_PRESETS[id].minDb, max: DISPLAY_RANGE_PRESETS[id].maxDb })).map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  onUpdateSettings({
                    ...settings,
                    displayRange: r.id,
                    minDb: r.min,
                    maxDb: r.max,
                    rangeDb: Math.abs(r.min - r.max),
                  });
                  setActivePopover(null);
                }}
                className={`py-1.5 rounded-lg border transition-all text-center ${
                  (settings.displayRange || '90dB') === r.id
                    ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40 font-bold'
                    : 'bg-slate-900 text-slate-400 border-white/5 hover:text-white'
                }`}
              >
                {r.id}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── POPOVER 3: MULTI-TRACK MANAGER HUD ─── */}
      {activePopover === 'tracks' && (
        <div className="absolute bottom-11 left-1/2 -translate-x-1/2 z-50 w-96 max-h-[380px] p-4 rounded-2xl bg-slate-950/95 backdrop-blur-2xl border border-cyan-500/30 text-white shadow-2xl flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Доріжки сесії ({tracks.length})
              </span>
            </div>

            <div className="flex items-center gap-2">
              {!pluginHost && (
                <button
                  onClick={onToggleMic}
                  className={`px-2 py-0.5 rounded text-[11px] font-semibold border flex items-center gap-1 transition-all ${
                    isMicActive
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                      : 'bg-slate-900 text-slate-400 border-white/10 hover:text-white'
                  }`}
                >
                  <span>Мікрофон {isMicActive ? 'ON' : 'OFF'}</span>
                </button>
              )}
              <button onClick={() => setActivePopover(null)} className="text-slate-400 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Track List */}
          <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
            {tracks.map((t) => (
              <div
                key={t.id}
                className="p-2.5 rounded-xl bg-slate-900/80 border border-white/10 flex items-center justify-between gap-3"
              >
                {/* Color Dot & Name */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className="w-3 h-3 rounded-full shrink-0 shadow-[0_0_8px_currentColor]"
                    style={{ backgroundColor: t.color, color: t.color }}
                  />
                  <span className="text-xs font-semibold text-white truncate">{t.name}</span>
                </div>

                {/* Controls: Solo, Mute, Visibility (Multi-analyzer display controls) */}
                <div className="flex items-center gap-1.5 shrink-0">

                  {/* Solo and mute only route the web engine's own tracks; the plugin host does not use them */}
                  {!pluginHost && (
                    <>
                      {/* Solo Button (S) */}
                      <button
                        onClick={() => handleToggleSolo(t)}
                        className={`w-6 h-6 rounded text-[11px] font-bold font-mono transition-all flex items-center justify-center ${
                          t.isSolo
                            ? 'bg-amber-500 text-slate-950 font-extrabold shadow-sm'
                            : 'bg-slate-800 text-slate-400 hover:text-white'
                        }`}
                        title="Solo"
                      >
                        S
                      </button>

                      {/* Mute Button (M) */}
                      <button
                        onClick={() => onUpdateTrack({ ...t, isMuted: !t.isMuted })}
                        className={`w-6 h-6 rounded text-[11px] font-bold font-mono transition-all flex items-center justify-center ${
                          t.isMuted
                            ? 'bg-rose-500 text-white font-extrabold shadow-sm'
                            : 'bg-slate-800 text-slate-400 hover:text-white'
                        }`}
                        title="Mute"
                      >
                        M
                      </button>
                    </>
                  )}

                  {/* Visibility Eyeball */}
                  <button
                    onClick={() => onUpdateTrack({ ...t, isVisible: !t.isVisible })}
                    className={`p-1.5 rounded transition-all ${
                      t.isVisible ? 'text-cyan-400' : 'text-slate-600 hover:text-slate-400'
                    }`}
                    title={t.isVisible ? 'Hide spectrum curve' : 'Show spectrum curve'}
                  >
                    {t.isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── POPOVER 4: BIT-TRANSPARENT PASS-THROUGH TELEMETRY ─── */}
      {activePopover === 'output' && (
        <div className="absolute bottom-11 right-6 z-50 w-72 p-4 rounded-2xl bg-slate-950/95 backdrop-blur-2xl border border-white/15 text-white shadow-2xl flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Signal Routing & Output
            </span>
            <button onClick={() => setActivePopover(null)} className="text-slate-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-col gap-2 py-1 text-xs">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-semibold text-emerald-400">Bit-Transparent Pass-Through</span>
              </div>
              <span className="font-mono text-xs font-bold text-emerald-300">0.0 dB (Unity)</span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Плагін працює як чистий аналізатор: звук проходить крізь нього без найменших змін амплітуди, фази чи затримки.
            </p>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[11px] font-mono text-slate-400">
            <span>In/Out Gain Offset:</span>
            <span className="text-emerald-400 font-bold">±0.00 dB (100% Pass)</span>
          </div>
        </div>
      )}

      {/* ─── THE MASTER BOTTOM STATUS BAR (36px FabFilter Design) ─── */}
      <footer className="h-9 px-4 bg-slate-950/90 backdrop-blur-2xl border-t border-white/10 flex items-center justify-between gap-4 text-xs font-medium text-slate-400 select-none">
        {/* Left Side: Analyzer & Range Triggers */}
        <div className="flex items-center gap-1.5 sm:gap-3 overflow-x-auto">
          {/* Analyzer Mode Trigger */}
          <button
            onClick={() => togglePopover('analyzer')}
            className={`px-2 py-1 rounded-md transition-all flex items-center gap-1 font-mono text-[11px] ${
              activePopover === 'analyzer'
                ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                : 'hover:text-white hover:bg-white/5'
            }`}
          >
            <Activity className="w-3 h-3 text-cyan-400" />
            <span>Analyzer: {settings.fftSize} · {settings.spectrumStyle || 'Curve'}</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {/* Range Trigger */}
          <button
            onClick={() => togglePopover('range')}
            className={`px-2 py-1 rounded-md transition-all flex items-center gap-1 font-mono text-[11px] ${
              activePopover === 'range'
                ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                : 'hover:text-white hover:bg-white/5'
            }`}
          >
            <span>Range: {settings.displayRange || '90dB'}</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {/* Speed / Decay Status */}
          <span className="hidden md:inline text-slate-600">·</span>
          <span className="hidden md:inline text-[11px] text-slate-500 font-mono">
            Tilt: {settings.tilt || 4.5} dB/oct
          </span>
        </div>

        {/* Center: Multi-Track Quick-Switch Bar */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => togglePopover('tracks')}
            className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-2 text-xs font-semibold border ${
              activePopover === 'tracks'
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm'
                : 'bg-slate-900/80 text-slate-300 border-white/10 hover:border-white/20 hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-3 h-3 text-cyan-400" />
            <span>Tracks ({tracks.length})</span>
            {/* Colored Track Dots */}
            <div className="flex items-center -space-x-1">
              {tracks.slice(0, 5).map((t) => (
                <div
                  key={t.id}
                  className="w-2 h-2 rounded-full border border-slate-950"
                  style={{ backgroundColor: t.color }}
                />
              ))}
            </div>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>
        </div>

        {/* Right Side: Master Volume & Freeze Indicator */}
        <div className="flex items-center gap-2 shrink-0">
          {settings.isFrozen && (
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40">
              FROZEN
            </span>
          )}

          <button
            onClick={() => togglePopover('output')}
            className={`px-2 py-1 rounded-md transition-all flex items-center gap-1 font-mono text-[11px] ${
              activePopover === 'output'
                ? 'bg-emerald-500/20 text-emerald-300 font-bold'
                : 'hover:text-white hover:bg-white/5 text-slate-400'
            }`}
            title="Bit-Transparent Pass-Through (Unity Gain 0.0 dB)"
          >
            <Activity className="w-3 h-3 text-emerald-400" />
            <span>Pass-thru: 0.0 dB</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>
        </div>
      </footer>
    </div>
  );
};
