/**
 * BottomParameterShelf - Apple Liquid Glass Precision Parameter Dock
 * Tactile rotary knobs and segmented buttons matching MMultiAnalyzer DSP parameter controls:
 * Resolution (FFT size), Smoothing (Octaves), Frequency Scale, Tilt, Decay, and Range Min/Max.
 */

import React from 'react';
import { AnalyzerSettings, FrequencyScale, SmoothingMode, SpectralTilt } from '../../types/audio';
import { LiquidKnob } from '../common/LiquidKnob';

interface BottomParameterShelfProps {
  settings: AnalyzerSettings;
  onUpdateSettings: (settings: AnalyzerSettings) => void;
  masterVolume: number;
  onChangeMasterVolume: (vol: number) => void;
}

export const BottomParameterShelf: React.FC<BottomParameterShelfProps> = ({
  settings,
  onUpdateSettings,
  masterVolume,
  onChangeMasterVolume,
}) => {
  return (
    <footer className="px-5 py-2.5 bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl border-t border-white/60 dark:border-white/10 shadow-lg flex items-center justify-between gap-6 overflow-x-auto min-h-[84px] shrink-0 z-30">
      {/* Group 1: FFT Resolution & Scale */}
      <div className="flex items-center gap-4 border-r border-slate-200/60 dark:border-white/10 pr-5 shrink-0">
        {/* FFT Resolution */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
            Resolution (FFT)
          </span>
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200/50 dark:border-white/5">
            {[1024, 2048, 4096, 8192].map((size) => (
              <button
                key={size}
                onClick={() => onUpdateSettings({ ...settings, fftSize: size as 1024 | 2048 | 4096 | 8192 })}
                className={`px-2 py-0.5 text-xs font-mono rounded transition-colors
                  ${
                    settings.fftSize === size
                      ? 'bg-cyan-500 text-white font-bold shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        {/* Frequency Scale */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
            Freq Scale
          </span>
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200/50 dark:border-white/5">
            {(['log', 'bark', 'mel', 'linear'] as FrequencyScale[]).map((scale) => (
              <button
                key={scale}
                onClick={() => onUpdateSettings({ ...settings, frequencyScale: scale })}
                className={`px-2 py-0.5 text-xs font-semibold rounded uppercase transition-colors
                  ${
                    settings.frequencyScale === scale
                      ? 'bg-cyan-500 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
              >
                {scale}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Group 2: Smoothing & Tilt */}
      <div className="flex items-center gap-4 border-r border-slate-200/60 dark:border-white/10 pr-5 shrink-0">
        {/* Spectrum Mode: Curve vs Octave Bars vs Stepped */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
            Mode
          </span>
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200/50 dark:border-white/5">
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
                className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors whitespace-nowrap
                  ${
                    (settings.spectrumStyle || 'curve') === m.id
                      ? 'bg-cyan-500 text-white shadow-sm font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Smoothing Octave */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
            Octave Smooth
          </span>
          <select
            value={settings.smoothing}
            onChange={(e) => onUpdateSettings({ ...settings, smoothing: e.target.value as SmoothingMode })}
            className="px-2.5 py-1 text-xs font-mono font-medium rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10 outline-none cursor-pointer"
          >
            <option value="none">None (Raw FFT)</option>
            <option value="1/48">1/48 Octave</option>
            <option value="1/24">1/24 Octave</option>
            <option value="1/12">1/12 Octave</option>
            <option value="1/6">1/6 Octave</option>
            <option value="1/3">1/3 Octave</option>
            <option value="1/1">1/1 Octave</option>
          </select>
        </div>

        {/* Spectral Tilt */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
            Tilt / Slope
          </span>
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200/50 dark:border-white/5">
            {(['0dB', '+3dB', '+4.5dB'] as SpectralTilt[]).map((t) => (
              <button
                key={t}
                onClick={() => onUpdateSettings({ ...settings, tilt: t })}
                className={`px-2 py-0.5 text-xs font-mono font-medium rounded transition-colors
                  ${
                    settings.tilt === t
                      ? 'bg-amber-500 text-white font-bold shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Decay Speed */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
            Decay
          </span>
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200/50 dark:border-white/5">
            {(['fast', 'medium', 'slow', 'hold'] as const).map((d) => (
              <button
                key={d}
                onClick={() => onUpdateSettings({ ...settings, decaySpeed: d })}
                className={`px-2 py-0.5 text-xs font-medium rounded capitalize transition-colors
                  ${
                    settings.decaySpeed === d
                      ? 'bg-cyan-500 text-white font-semibold shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Group 3: Tactile Rotary Knobs (Range Min, Range Max - Pure visual calibration) */}
      <div className="flex items-center gap-5 shrink-0 py-0.5">
        <LiquidKnob
          label="Range Min"
          value={settings.minDb}
          min={-100}
          max={-36}
          step={2}
          defaultValue={-90}
          unit="dB"
          size={48}
          accentColor="#06B6D4"
          displayFormat={(val) => `${val} dB`}
          onChange={(val) => onUpdateSettings({ ...settings, minDb: val })}
        />

        <LiquidKnob
          label="Range Max"
          value={settings.maxDb}
          min={-18}
          max={6}
          step={1}
          defaultValue={0}
          unit="dB"
          size={48}
          accentColor="#F59E0B"
          displayFormat={(val) => `${val > 0 ? '+' : ''}${val} dB`}
          onChange={(val) => onUpdateSettings({ ...settings, maxDb: val })}
        />
      </div>
    </footer>
  );
};
