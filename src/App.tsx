/**
 * LiquidSpectra Pro - Next-Generation Multitrack Audio Analysis Suite
 * Apple Liquid Glass aesthetic, real-time Web Audio DSP, multitrack collision detection,
 * EBU R128 loudness metering, stereo goniometer, synchronized oscilloscope, and C++20 VST3/AU architecture.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  AudioTrack,
  AnalyzerSettings,
  ModuleMode,
} from './types/audio';
import { audioEngine } from './audio/AudioEngine';
import { TopBar } from './components/layout/TopBar';
import { FabFilterBottomBar } from './components/layout/FabFilterBottomBar';

import { SpectrumView } from './components/views/SpectrumView';
import { SonogramView } from './components/views/SonogramView';
import { CollisionView } from './components/views/CollisionView';
import { LoudnessView } from './components/views/LoudnessView';
import { StereoView } from './components/views/StereoView';
import { OscilloscopeView } from './components/views/OscilloscopeView';

const INITIAL_TRACKS: AudioTrack[] = [
  {
    id: 'track_kick',
    name: 'Kick Drum',
    color: '#06B6D4', // Precision Cyan
    glowColor: 'rgba(6, 182, 212, 0.4)',
    volume: 0.9,
    pan: 0,
    isMuted: false,
    isSolo: false,
    isVisible: true,
    isSidechainActive: false,
    type: 'kick',
    filterEnabled: false,
    filterFreq: 55,
    filterGain: -4.5,
    filterQ: 2.8,
    peakLevelDb: -6,
    rmsLevelDb: -14,
    dominantFrequency: 55,
  },
  {
    id: 'track_bass',
    name: '808 Sub-Bass',
    color: '#F59E0B', // Amber Phosphor
    glowColor: 'rgba(245, 158, 11, 0.4)',
    volume: 0.85,
    pan: 0,
    isMuted: false,
    isSolo: false,
    isVisible: true,
    isSidechainActive: true,
    sidechainTargetId: 'track_kick',
    type: 'bass',
    filterEnabled: false,
    filterFreq: 55,
    filterGain: -4.0,
    filterQ: 2.5,
    peakLevelDb: -8,
    rmsLevelDb: -12,
    dominantFrequency: 50,
  },
  {
    id: 'track_vocal',
    name: 'Vocal Hook',
    color: '#F43F5E', // Neon Rose
    glowColor: 'rgba(244, 63, 94, 0.4)',
    volume: 0.8,
    pan: -0.1,
    isMuted: false,
    isSolo: false,
    isVisible: true,
    isSidechainActive: false,
    type: 'vocal',
    filterEnabled: false,
    filterFreq: 1200,
    filterGain: -2.5,
    filterQ: 1.8,
    peakLevelDb: -10,
    rmsLevelDb: -18,
    dominantFrequency: 880,
  },
  {
    id: 'track_synth',
    name: 'Synth Pad',
    color: '#10B981', // Emerald Phosphor
    glowColor: 'rgba(16, 185, 129, 0.4)',
    volume: 0.75,
    pan: 0.2,
    isMuted: false,
    isSolo: false,
    isVisible: true,
    isSidechainActive: false,
    type: 'synth',
    filterEnabled: false,
    filterFreq: 350,
    filterGain: -3.0,
    filterQ: 1.5,
    peakLevelDb: -12,
    rmsLevelDb: -20,
    dominantFrequency: 440,
  },
  {
    id: 'track_sidechain',
    name: 'Sidechain / Aux',
    color: '#8B5CF6', // Cyber Violet
    glowColor: 'rgba(139, 92, 246, 0.4)',
    volume: 0.7,
    pan: 0,
    isMuted: false,
    isSolo: false,
    isVisible: false,
    isSidechainActive: false,
    type: 'custom',
    filterEnabled: false,
    filterFreq: 100,
    filterGain: 0,
    filterQ: 1.5,
    peakLevelDb: -24,
    rmsLevelDb: -32,
    dominantFrequency: 1000,
  },
];

const DEFAULT_SETTINGS: AnalyzerSettings = {
  fftSize: 4096,
  smoothing: '1/12',
  frequencyScale: 'log',
  tilt: '0dB',
  decaySpeed: 'medium',
  minDb: -90,
  maxDb: 0,
  sonogramPalette: 'liquid',
  sonogramSpeed: 2,
  oscilloscopeTimebaseMs: 10,
  oscilloscopeTriggerMode: 'auto',
  collisionThreshold: 0.4,
  spectrumStyle: 'curve',
  octaveBandResolution: '1/1',
  showPianoRoll: true,
  spectrumGrab: true,
  showCollisionOverlay: true,
  displayRange: '90dB',
};

export default function App() {
  const [tracks, setTracks] = useState<AudioTrack[]>(INITIAL_TRACKS);
  const [settings, setSettings] = useState<AnalyzerSettings>(DEFAULT_SETTINGS);
  const [activeMode, setActiveMode] = useState<ModuleMode>('spectrum');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMicActive, setIsMicActive] = useState<boolean>(false);
  const [masterVolume, setMasterVolume] = useState<number>(1.0);

  // UI Theme & Scaling
  const [isDark, setIsDark] = useState<boolean>(() => {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [zoomScale, setZoomScale] = useState<number>(1.0);

  const appContainerRef = useRef<HTMLDivElement | null>(null);

  // Sync Dark mode class on root HTML document
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  // Listen for OS system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setIsDark(e.matches);
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Bumped once the AudioContext exists so the track sync below runs against a live engine
  const [engineReady, setEngineReady] = useState<boolean>(false);

  // Initialize Audio Engine (may stay suspended until the first user gesture)
  useEffect(() => {
    audioEngine
      .initAudio()
      .then(() => setEngineReady(true))
      .catch(() => {
        // Engine awaits user gesture
      });
  }, []);

  // Sync FFT size updates to AudioEngine
  useEffect(() => {
    audioEngine.setFftSize(settings.fftSize);
  }, [settings.fftSize]);

  // Keep the engine's track graph in step with React state: register new tracks,
  // drop removed ones and push volume / pan / mute / solo to the gain stages
  useEffect(() => {
    if (!engineReady) return;
    const anySolo = tracks.some((t) => t.isSolo);
    const ids = new Set(tracks.map((t) => t.id));
    audioEngine.getTrackIds().forEach((id) => {
      if (!ids.has(id)) audioEngine.unregisterTrack(id);
    });
    tracks.forEach((track) => {
      if (!audioEngine.hasTrack(track.id)) audioEngine.registerTrack(track, settings.fftSize);
      audioEngine.updateTrackParameters(track, anySolo);
    });
  }, [tracks, engineReady]);

  // Handle Playback Toggle
  const handleTogglePlayback = async () => {
    await audioEngine.initAudio();
    setEngineReady(true);
    const playing = audioEngine.togglePlayback();
    setIsPlaying(playing);
  };

  // Handle Live Microphone
  const handleToggleMic = async () => {
    if (isMicActive) {
      audioEngine.disableMicrophone();
      setIsMicActive(false);
    } else {
      const success = await audioEngine.enableMicrophone('track_sidechain');
      if (success) {
        setIsMicActive(true);
        // Make track visible
        setTracks((prev) =>
          prev.map((t) => (t.id === 'track_sidechain' ? { ...t, isVisible: true, isMuted: false } : t))
        );
      }
    }
  };

  // Fullscreen Toggle
  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Track the real fullscreen state (Esc / browser UI exits bypass the toggle above)
  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const handleUpdateTrack = (updatedTrack: AudioTrack) => {
    setTracks((prev) => prev.map((t) => (t.id === updatedTrack.id ? updatedTrack : t)));
  };

  const handleAddTrack = (newTrack: AudioTrack) => {
    setTracks((prev) => [...prev, newTrack]);
  };

  const handleChangeMasterVolume = (vol: number) => {
    setMasterVolume(vol);
    audioEngine.setMasterVolume(vol);
  };

  return (
    <div
      ref={appContainerRef}
      className={`h-screen max-h-screen w-full flex flex-col font-sans transition-colors duration-200 select-none overflow-hidden
        ${
          isDark
            ? 'bg-[#080B10] text-slate-100'
            : 'bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 text-slate-900'
        }`}
      style={{
        transform: zoomScale !== 1.0 ? `scale(${zoomScale})` : undefined,
        transformOrigin: 'top center',
      }}
    >
      {/* Apple Liquid Glass Ambient Background Blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div
          className="absolute -top-40 -left-40 w-96 h-96 rounded-full blur-3xl opacity-20 dark:opacity-25"
          style={{ background: 'radial-gradient(circle, #06B6D4, transparent)' }}
        />
        <div
          className="absolute top-1/3 -right-40 w-96 h-96 rounded-full blur-3xl opacity-15 dark:opacity-20"
          style={{ background: 'radial-gradient(circle, #F59E0B, transparent)' }}
        />
        <div
          className="absolute -bottom-40 left-1/3 w-96 h-96 rounded-full blur-3xl opacity-15 dark:opacity-20"
          style={{ background: 'radial-gradient(circle, #8B5CF6, transparent)' }}
        />
      </div>

      {/* Top Bar Contract (Wordmark — Modes — Master Controls) */}
      <TopBar
        activeMode={activeMode}
        onSelectMode={setActiveMode}
        isPlaying={isPlaying}
        onTogglePlayback={handleTogglePlayback}
        isDark={isDark}
        onToggleTheme={() => setIsDark(!isDark)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        zoomScale={zoomScale}
        onChangeZoom={setZoomScale}
      />

      {/* Main Workspace Stage: Edge-to-Edge FabFilter Multi-Track Analyzer Canvas */}
      <main className="relative flex-1 p-2 overflow-hidden z-10 min-h-0 min-w-0 flex flex-col">
        <div className="relative flex-1 h-full flex flex-col min-h-0 min-w-0 rounded-2xl overflow-hidden bg-[#05070B] border border-white/10 shadow-2xl">
          {/* Module Views */}
          {activeMode === 'spectrum' && (
            <SpectrumView
              tracks={tracks}
              settings={settings}
              onUpdateSettings={setSettings}
              onUpdateTrack={handleUpdateTrack}
              masterVolume={masterVolume}
              onChangeMasterVolume={handleChangeMasterVolume}
            />
          )}
          {activeMode === 'sonogram' && (
            <SonogramView tracks={tracks} settings={settings} />
          )}
          {activeMode === 'collisions' && (
            <CollisionView
              tracks={tracks}
              settings={settings}
              onUpdateTrack={handleUpdateTrack}
            />
          )}
          {activeMode === 'loudness' && (
            <LoudnessView
              tracks={tracks}
              settings={settings}
              onUpdateSettings={setSettings}
            />
          )}
          {activeMode === 'stereo' && (
            <StereoView tracks={tracks} settings={settings} />
          )}
          {activeMode === 'oscilloscope' && (
            <OscilloscopeView tracks={tracks} settings={settings} />
          )}
        </div>
      </main>

      {/* FabFilter Contextual Popover Bottom Status Bar */}
      <FabFilterBottomBar
        settings={settings}
        onUpdateSettings={setSettings}
        masterVolume={masterVolume}
        onChangeMasterVolume={handleChangeMasterVolume}
        tracks={tracks}
        onUpdateTrack={handleUpdateTrack}
        onAddTrack={handleAddTrack}
        isMicActive={isMicActive}
        onToggleMic={handleToggleMic}
      />
    </div>
  );
}
