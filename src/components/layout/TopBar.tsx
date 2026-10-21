/**
 * TopBar - LiquidSpectra Top Bar Contract
 * One-row, 3-zone layout: Single-element brand wordmark — Single-line module tabs — Master controls.
 */

import React, { useState } from 'react';
import { ModuleMode } from '../../types/audio';
import {
  Play,
  Square,
  Sun,
  Moon,
  Maximize2,
  Minimize2,
  ZoomIn,
  Network,
  X,
  CheckCircle2,
  Cpu,
} from 'lucide-react';

interface TopBarProps {
  activeMode: ModuleMode;
  onSelectMode: (mode: ModuleMode) => void;
  isPlaying: boolean;
  onTogglePlayback: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  zoomScale: number;
  onChangeZoom: (scale: number) => void;
}

const MODES: { id: ModuleMode; label: string }[] = [
  { id: 'spectrum', label: 'Spectrum' },
  { id: 'sonogram', label: 'Sonogram' },
  { id: 'collisions', label: 'Collisions' },
  { id: 'loudness', label: 'Loudness' },
  { id: 'stereo', label: 'Stereo' },
  { id: 'oscilloscope', label: 'Oscilloscope' },
  { id: 'cpp_export', label: 'C++ Plugin' },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeMode,
  onSelectMode,
  isPlaying,
  onTogglePlayback,
  isDark,
  onToggleTheme,
  isFullscreen,
  onToggleFullscreen,
  zoomScale,
  onChangeZoom,
}) => {
  const [showDawBusModal, setShowDawBusModal] = useState<boolean>(false);

  return (
    <>
      <header className="flex items-center justify-between gap-4 px-5 py-3 bg-white/70 dark:bg-slate-900/60 backdrop-blur-2xl border-b border-white/60 dark:border-white/10 shadow-sm shrink-0 z-40">
        {/* Zone 1: Single text element wordmark + DAW Sync Bus Badge */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#06B6D4]" />
            <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
              LiquidSpectra <span className="font-mono text-cyan-500 font-semibold text-xs ml-1">PRO</span>
            </span>
          </div>

          {/* DAW Inter-Plugin Bus Status Badge */}
          <button
            onClick={() => setShowDawBusModal(true)}
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-xs font-mono transition-all cursor-pointer shadow-sm"
            title="Click to view how DAW Inter-Plugin Shared Memory Sync operates"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold">DAW Bus: 5 Tracks Synced</span>
            <Network className="w-3 h-3 text-emerald-500" />
          </button>
        </div>

      {/* Zone 2: Module Mode Navigation Links (Zero Scrollbar Guaranteed) */}
      <nav className="flex items-center gap-1 p-1 rounded-xl bg-slate-100/80 dark:bg-slate-800/80 border border-slate-200/50 dark:border-white/5 flex-nowrap shrink-0 overflow-hidden select-none">
        {MODES.map((m) => {
          const isActive = activeMode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onSelectMode(m.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer
                ${
                  isActive
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-cyan-400 shadow-sm border border-slate-200/80 dark:border-white/10 font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-slate-700/40'
                }`}
            >
              {m.label}
              {m.id === 'collisions' && (
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Master Action, Zoom, Theme, and Fullscreen */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Zoom Scale Selector */}
        <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          <ZoomIn className="w-3.5 h-3.5" />
          <select
            value={zoomScale}
            onChange={(e) => onChangeZoom(parseFloat(e.target.value))}
            className="px-2 py-1 text-xs font-mono font-medium rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10 outline-none cursor-pointer"
          >
            <option value="0.85">85%</option>
            <option value="1.0">100%</option>
            <option value="1.15">115%</option>
            <option value="1.25">125%</option>
          </select>
        </div>

        {/* Theme Toggle (Dark / Light) */}
        <button
          onClick={onToggleTheme}
          className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
        >
          {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
        </button>

        {/* Fullscreen Toggle */}
        <button
          onClick={onToggleFullscreen}
          className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>

        {/* Primary Master Play / Stop Action */}
        <button
          onClick={onTogglePlayback}
          className={`px-4 py-2 text-xs font-semibold rounded-xl text-white shadow-md flex items-center gap-2 transition-all whitespace-nowrap shrink-0
            ${
              isPlaying
                ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/20'
                : 'bg-gradient-to-r from-cyan-500 to-indigo-500 hover:from-cyan-400 hover:to-indigo-400 shadow-cyan-500/20'
            }`}
        >
          {isPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
          <span>{isPlaying ? 'Stop Stems' : 'Play Stems'}</span>
        </button>
      </div>
    </header>

    {/* DAW Inter-Plugin Communication Architecture Modal */}
    {showDawBusModal && (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
        <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl border border-white/60 dark:border-white/10 shadow-2xl p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-500 border border-cyan-500/20">
                <Network className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  DAW Inter-Plugin Shared Memory Bus
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Zero-routing automatic cross-track synchronization (MMultiAnalyzer Principle)
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowDawBusModal(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Explanation Content */}
          <div className="flex flex-col gap-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-white/5 flex flex-col gap-2">
              <span className="font-bold text-slate-800 dark:text-white flex items-center gap-2 text-sm">
                <Cpu className="w-4 h-4 text-cyan-500" />
                Як це працює у вашій DAW (Ableton, FL Studio, Logic, Reaper, Cubase):
              </span>
              <p>
                Точно так само, як у <b>MMultiAnalyzer</b>, ви просто вставляєте плагін на будь-яку кількість доріжок у вашому міксі (Kick, 808 Bass, Lead Synth, Vocals тощо). Вам <b>НЕ потрібно налаштовувати складні Sidechain-посили</b> вручну!
              </p>
              <p>
                Кожен екземпляр плагіна автоматично підключається до глобальної шини памʼяті (<b>MultiInstanceBus</b> через lock-free Shared Memory / IPC). Кожен трек публікує свої FFT-спектри, вейвформи та фазові координати.
              </p>
              <p>
                Коли ви відкриваєте вікно плагіна на <b>будь-якій одній</b> доріжці, плагін бачить <b>усі інші треки сесії</b>! Ви можете обирати, які доріжки порівнювати, бачити частотні колізії, накладення в сонограмі та фазовий взаємозвʼязок.
              </p>
            </div>

            {/* Active Registered Instances Table */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-mono font-bold uppercase text-slate-400">
                Зареєстровані треки в поточному сеансі (Shared Memory Slots):
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { id: '1', name: 'Kick Drum (Stem #1)', color: '#06B6D4', role: 'Low-end transient master' },
                  { id: '2', name: '808 Sub Bass (Stem #2)', color: '#F59E0B', role: 'Sub-bass fundamental 40-90Hz' },
                  { id: '3', name: 'Lead Vocals (Stem #3)', color: '#F43F5E', role: 'Lead presence 1k-6kHz' },
                  { id: '4', name: 'Synth / Chords (Stem #4)', color: '#10B981', role: 'Mid-range harmonic bed' },
                  { id: '5', name: 'Sidechain / Aux (Stem #5)', color: '#8B5CF6', role: 'Dynamic sidechain trigger' },
                ].map((slot) => (
                  <div
                    key={slot.id}
                    className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-white/10 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: slot.color, boxShadow: `0 0 6px ${slot.color}` }}
                      />
                      <div>
                        <div className="font-bold text-slate-800 dark:text-white">{slot.name}</div>
                        <div className="text-[10px] text-slate-400">{slot.role}</div>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-500 font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Active
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer Close */}
          <div className="pt-2 border-t border-slate-200 dark:border-white/10 flex justify-end">
            <button
              onClick={() => setShowDawBusModal(false)}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-cyan-500 text-white hover:bg-cyan-600 transition-colors shadow-sm"
            >
              Зрозуміло
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};
