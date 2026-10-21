/**
 * LiquidSpectra Real-Time Audio DSP Engine
 * Multitrack Web Audio Engine with FFT analysis, Psychoacoustic Collision Detection,
 * ITU-R BS.1770 Loudness Metering, Stereo Goniometer, and Synchronized Oscilloscope.
 */

import { AudioTrack, CollisionEvent, LoudnessMetrics, StereoMetrics } from '../types/audio';
import { BS1770Meter } from './loudness';
import { ScopeRing, ScopeTrace, findTriggerCrossing, acquireTrace } from './scope';

// Seconds of audio kept per track: the 10 s timebase plus room to search for a trigger
const RING_SECONDS = 13;

interface TrackNodes {
  sourceNode: AudioNode | null;
  inputNode: GainNode;
  gainNode: GainNode;
  panNode: StereoPannerNode;
  analyserNode: AnalyserNode;
  splitterNode: ChannelSplitterNode;
  leftAnalyserNode: AnalyserNode;
  rightAnalyserNode: AnalyserNode;
  processorNode: ScriptProcessorNode;
}

// Smaller blocks = fresher scope data (~47 updates/s at 48 kHz) for smooth persistence
const TRACK_TAP_BLOCK = 1024;

export interface ScopeFrameRequest {
  trackIds: string[];
  timebaseMs: number;
  columns: number;
  mode: 'trigger' | 'roll';
  triggerTrackId?: string;
  triggerLevel?: number;
  triggerEdge?: 'rising' | 'falling';
  /** Fraction of the window shown before the trigger point (0..0.9). */
  preTrigger?: number;
}

export interface ScopeFrame {
  traces: Map<string, ScopeTrace>;
  /** True when a trigger edge was found; false = auto (free-running) acquisition. */
  triggered: boolean;
  /** Absolute sample at the left edge of the screen (identical for every channel). */
  startSample: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private fftSize: number = 4096;
  private tracks: Map<string, TrackNodes> = new Map();
  private trackRingBuffers: Map<string, ScopeRing> = new Map();
  private silentGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private masterAnalyser: AnalyserNode | null = null;
  private masterSplitter: ChannelSplitterNode | null = null;
  private masterAnalyserL: AnalyserNode | null = null;
  private masterAnalyserR: AnalyserNode | null = null;
  private masterTimeL: Float32Array = new Float32Array(2048);
  private masterTimeR: Float32Array = new Float32Array(2048);
  private smoothedPeakL: number = -60;
  private smoothedPeakR: number = -60;
  private smoothedRmsL: number = -60;
  private smoothedRmsR: number = -60;
  private peakHoldL: number = -60;
  private peakHoldR: number = -60;
  private peakHoldTimerL: number = 0;
  private peakHoldTimerR: number = 0;
  private masterIsClip: boolean = false;
  private masterMaxPeakDb: number = -60;

  // Synthesized stem generators & state
  private schedulerTimer: number | null = null;
  private beatStep: number = 0;
  private tempoBpm: number = 124;
  private nextNoteTime: number = 0;
  private isPlaying: boolean = false;

  // Mic input and generated test-signal sources
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micTrackId: string | null = null;
  private customAudioSources: Map<string, AudioBufferSourceNode> = new Map();

  // Test Signal Generator
  private testSignalOsc: OscillatorNode | null = null;
  private testSignalGain: GainNode | null = null;

  // ITU-R BS.1770-4 loudness meter fed by a stereo tap on the master bus
  private loudnessMeter: BS1770Meter | null = null;
  private loudnessTap: ScriptProcessorNode | null = null;
  private trackMeters: Map<string, BS1770Meter> = new Map();

  constructor() {
    // AudioContext will be initialized on first user gesture
  }

  public async initAudio(): Promise<void> {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx({ latencyHint: 'interactive' });

      // Master output
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(1.0, this.ctx.currentTime);

      this.masterAnalyser = this.ctx.createAnalyser();
      this.masterAnalyser.fftSize = 4096;
      this.masterAnalyser.smoothingTimeConstant = 0.8;

      this.masterGain.connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.ctx.destination);

      // Stereo Left / Right Metering Splitter
      this.masterSplitter = this.ctx.createChannelSplitter(2);
      this.masterAnalyserL = this.ctx.createAnalyser();
      this.masterAnalyserL.fftSize = 2048;
      this.masterAnalyserL.smoothingTimeConstant = 0.2;

      this.masterAnalyserR = this.ctx.createAnalyser();
      this.masterAnalyserR.fftSize = 2048;
      this.masterAnalyserR.smoothingTimeConstant = 0.2;

      this.masterGain.connect(this.masterSplitter);
      this.masterSplitter.connect(this.masterAnalyserL, 0);
      this.masterSplitter.connect(this.masterAnalyserR, 1);

      // Silent sink for ScriptProcessor nodes so they run continuously
      this.silentGain = this.ctx.createGain();
      this.silentGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.silentGain.connect(this.ctx.destination);

      // Stereo loudness tap (explicit 2-channel input so the master is not down-mixed)
      this.loudnessMeter = new BS1770Meter(this.ctx.sampleRate, 2);
      const meter = this.loudnessMeter;
      this.loudnessTap = this.ctx.createScriptProcessor(2048, 2, 1);
      this.loudnessTap.channelCount = 2;
      this.loudnessTap.channelCountMode = 'explicit';
      this.loudnessTap.channelInterpretation = 'speakers';
      this.loudnessTap.onaudioprocess = (e) => {
        meter.process([e.inputBuffer.getChannelData(0), e.inputBuffer.getChannelData(1)]);
      };
      this.masterGain.connect(this.loudnessTap);
      this.loudnessTap.connect(this.silentGain);
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  public registerTrack(track: AudioTrack, fftSize: number = this.fftSize): void {
    if (!this.ctx || !this.masterGain) return;

    // Remove existing nodes if any
    this.unregisterTrack(track.id);

    // 100% Bit-Transparent Unity Input Gain Node (Zero Phase Distortion, Zero Coloring)
    const inputNode = this.ctx.createGain();
    inputNode.gain.setValueAtTime(1.0, this.ctx.currentTime);

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(track.isMuted ? 0 : track.volume, this.ctx.currentTime);

    const panNode = this.ctx.createStereoPanner();
    panNode.pan.setValueAtTime(track.pan, this.ctx.currentTime);

    const analyserNode = this.ctx.createAnalyser();
    analyserNode.fftSize = fftSize;
    analyserNode.smoothingTimeConstant = 0.20;
    analyserNode.minDecibels = -100;
    analyserNode.maxDecibels = 0;

    const splitterNode = this.ctx.createChannelSplitter(2);
    const leftAnalyserNode = this.ctx.createAnalyser();
    leftAnalyserNode.fftSize = 1024;
    const rightAnalyserNode = this.ctx.createAnalyser();
    rightAnalyserNode.fftSize = 1024;

    // Pristine Bit-Transparent Signal Path: inputNode -> gainNode -> panNode -> analyserNode -> masterGain
    inputNode.connect(gainNode);
    gainNode.connect(panNode);
    panNode.connect(analyserNode);
    analyserNode.connect(this.masterGain);

    panNode.connect(splitterNode);
    splitterNode.connect(leftAnalyserNode, 0);
    splitterNode.connect(rightAnalyserNode, 1);

    // Continuous 10-second recorder on the shared absolute sample timeline
    const sampleRate = this.ctx.sampleRate;
    const ring = new ScopeRing(RING_SECONDS, sampleRate);
    this.trackRingBuffers.set(track.id, ring);
    const mono = new Float32Array(TRACK_TAP_BLOCK);

    // Per-track K-weighted meter (true peak skipped: it runs on the main thread for every track)
    const trackMeter = new BS1770Meter(this.ctx.sampleRate, 2, { truePeak: false });
    this.trackMeters.set(track.id, trackMeter);

    const processorNode = this.ctx.createScriptProcessor(TRACK_TAP_BLOCK, 2, 1);
    processorNode.channelCount = 2;
    processorNode.channelCountMode = 'explicit';
    processorNode.onaudioprocess = (e) => {
      const left = e.inputBuffer.getChannelData(0);
      const right = e.inputBuffer.getChannelData(1);
      trackMeter.process([left, right]);

      const len = left.length;
      const block = len === mono.length ? mono : new Float32Array(len);
      for (let i = 0; i < len; i++) block[i] = 0.5 * (left[i] + right[i]);
      // playbackTime is shared by every processor in the graph, so all tracks land on one timeline
      ring.write(block, Math.round(e.playbackTime * sampleRate), performance.now());
    };

    panNode.connect(processorNode);
    if (this.silentGain) {
      processorNode.connect(this.silentGain);
    }

    this.tracks.set(track.id, {
      sourceNode: null,
      inputNode,
      gainNode,
      panNode,
      analyserNode,
      splitterNode,
      leftAnalyserNode,
      rightAnalyserNode,
      processorNode,
    });
  }

  public unregisterTrack(trackId: string): void {
    const nodes = this.tracks.get(trackId);
    if (nodes) {
      try {
        nodes.inputNode.disconnect();
        nodes.gainNode.disconnect();
        nodes.panNode.disconnect();
        nodes.analyserNode.disconnect();
        nodes.splitterNode.disconnect();
        nodes.leftAnalyserNode.disconnect();
        nodes.rightAnalyserNode.disconnect();
        nodes.processorNode.disconnect();
      } catch {
        // Disconnection fallback
      }
      nodes.processorNode.onaudioprocess = null;
      this.tracks.delete(trackId);
      this.trackRingBuffers.delete(trackId);
      this.trackMeters.delete(trackId);
    }
  }

  public hasTrack(trackId: string): boolean {
    return this.tracks.has(trackId);
  }

  public getTrackIds(): string[] {
    return Array.from(this.tracks.keys());
  }

  /** Applies volume / pan / mute; when any track is soloed every non-solo track is silenced. */
  public updateTrackParameters(track: AudioTrack, anySolo: boolean = false): void {
    if (!this.ctx) return;
    const nodes = this.tracks.get(track.id);
    if (!nodes) return;

    const isSilenced = track.isMuted || (anySolo && !track.isSolo);
    const targetGain = isSilenced ? 0 : track.volume;
    nodes.gainNode.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.02);
    nodes.panNode.pan.setTargetAtTime(track.pan, this.ctx.currentTime, 0.02);
  }

  public setFftSize(size: number): void {
    this.fftSize = size;
    this.tracks.forEach((nodes) => {
      try {
        nodes.analyserNode.fftSize = size;
      } catch {
        // Fallback
      }
    });
    if (this.masterAnalyser) {
      try {
        this.masterAnalyser.fftSize = size;
      } catch {
        // Fallback
      }
    }
  }

  public getMasterOutputLevels(): {
    peakL: number;
    peakR: number;
    rmsL: number;
    rmsR: number;
    peakHoldL: number;
    peakHoldR: number;
    maxPeakDb: number;
    isClip: boolean;
  } {
    if (!this.ctx || !this.masterAnalyserL || !this.masterAnalyserR) {
      return {
        peakL: -60,
        peakR: -60,
        rmsL: -60,
        rmsR: -60,
        peakHoldL: -60,
        peakHoldR: -60,
        maxPeakDb: -60,
        isClip: this.masterIsClip,
      };
    }

    this.masterAnalyserL.getFloatTimeDomainData(this.masterTimeL as unknown as Float32Array<ArrayBuffer>);
    this.masterAnalyserR.getFloatTimeDomainData(this.masterTimeR as unknown as Float32Array<ArrayBuffer>);

    let maxL = 0;
    let sumL = 0;
    for (let i = 0; i < this.masterTimeL.length; i++) {
      const v = Math.abs(this.masterTimeL[i]);
      if (v > maxL) maxL = v;
      sumL += v * v;
    }

    let maxR = 0;
    let sumR = 0;
    for (let i = 0; i < this.masterTimeR.length; i++) {
      const v = Math.abs(this.masterTimeR[i]);
      if (v > maxR) maxR = v;
      sumR += v * v;
    }

    const instPeakDbL = maxL > 0.00001 ? 20 * Math.log10(maxL) : -90;
    const instPeakDbR = maxR > 0.00001 ? 20 * Math.log10(maxR) : -90;
    const rmsValL = Math.sqrt(sumL / this.masterTimeL.length);
    const rmsValR = Math.sqrt(sumR / this.masterTimeR.length);
    const instRmsDbL = rmsValL > 0.00001 ? 20 * Math.log10(rmsValL) : -90;
    const instRmsDbR = rmsValR > 0.00001 ? 20 * Math.log10(rmsValR) : -90;

    // Instant attack, smooth ballistics decay (~1.5 dB per frame)
    if (instPeakDbL >= this.smoothedPeakL) {
      this.smoothedPeakL = instPeakDbL;
    } else {
      this.smoothedPeakL = Math.max(-90, this.smoothedPeakL - 1.5);
    }

    if (instPeakDbR >= this.smoothedPeakR) {
      this.smoothedPeakR = instPeakDbR;
    } else {
      this.smoothedPeakR = Math.max(-90, this.smoothedPeakR - 1.5);
    }

    // RMS smoothing
    this.smoothedRmsL = this.smoothedRmsL * 0.85 + instRmsDbL * 0.15;
    this.smoothedRmsR = this.smoothedRmsR * 0.85 + instRmsDbR * 0.15;

    // Peak Hold
    const now = performance.now();
    if (instPeakDbL >= this.peakHoldL) {
      this.peakHoldL = instPeakDbL;
      this.peakHoldTimerL = now + 1500;
    } else if (now > this.peakHoldTimerL) {
      this.peakHoldL = Math.max(-90, this.peakHoldL - 0.8);
    }

    if (instPeakDbR >= this.peakHoldR) {
      this.peakHoldR = instPeakDbR;
      this.peakHoldTimerR = now + 1500;
    } else if (now > this.peakHoldTimerR) {
      this.peakHoldR = Math.max(-90, this.peakHoldR - 0.8);
    }

    const currentMax = Math.max(instPeakDbL, instPeakDbR);
    if (currentMax >= 0.0) {
      this.masterIsClip = true;
    }
    this.masterMaxPeakDb = Math.max(this.masterMaxPeakDb, currentMax);

    return {
      peakL: this.smoothedPeakL,
      peakR: this.smoothedPeakR,
      rmsL: this.smoothedRmsL,
      rmsR: this.smoothedRmsR,
      peakHoldL: this.peakHoldL,
      peakHoldR: this.peakHoldR,
      maxPeakDb: this.masterMaxPeakDb,
      isClip: this.masterIsClip,
    };
  }

  public resetMasterClip(): void {
    this.masterIsClip = false;
    this.masterMaxPeakDb = -60;
    this.peakHoldL = -60;
    this.peakHoldR = -60;
  }

  // Multi-track Stem Synthesizer Playback
  public startPlayback(): void {
    if (this.isPlaying) return;
    this.isPlaying = true;
    if (this.ctx) {
      this.nextNoteTime = this.ctx.currentTime;
      this.scheduleLoop();
    }
  }

  public stopPlayback(): void {
    this.isPlaying = false;
    if (this.schedulerTimer !== null) {
      window.clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this.stopTestSignal();
  }

  public togglePlayback(): boolean {
    if (this.isPlaying) {
      this.stopPlayback();
    } else {
      this.startPlayback();
    }
    return this.isPlaying;
  }

  private scheduleLoop = (): void => {
    if (!this.isPlaying || !this.ctx) return;

    const secondsPer16th = 60 / this.tempoBpm / 4;
    while (this.nextNoteTime < this.ctx.currentTime + 0.15) {
      this.triggerStep(this.beatStep, this.nextNoteTime);
      this.nextNoteTime += secondsPer16th;
      this.beatStep = (this.beatStep + 1) % 32; // 2 bars of 16ths
    }

    this.schedulerTimer = window.setTimeout(this.scheduleLoop, 25);
  };

  private triggerStep(step: number, time: number): void {
    if (!this.ctx) return;

    // 1. Kick Drum (4-on-the-floor: steps 0, 4, 8, 12, 16, 20, 24, 28)
    const kickNodes = this.tracks.get('track_kick');
    if (kickNodes && step % 4 === 0) {
      this.synthKick(time, kickNodes.inputNode);
    }

    // 2. 808 Sub-Bass (Off-beats and rhythmic syncopation - intentionally shares 45-75Hz with kick for clash detection)
    const bassNodes = this.tracks.get('track_bass');
    if (bassNodes) {
      // 808 pattern: plays sustained sub notes on steps 0, 2, 6, 8, 10, 14, 16, 18, 22, 24, 26, 30
      if ([0, 2, 6, 8, 10, 14, 16, 18, 22, 24, 26, 30].includes(step)) {
        const notes = [46.25, 46.25, 51.91, 55.0, 51.91, 41.2, 46.25]; // F#1, G#1, A1, E1
        const pitch = notes[(step / 4 | 0) % notes.length];
        this.synth808(time, bassNodes.inputNode, pitch, 0.45);
      }
    }

    // 3. Vocals / Melody (harmonic sweeps and formants around 300Hz - 3.5kHz)
    const vocalNodes = this.tracks.get('track_vocal');
    if (vocalNodes) {
      if ([4, 7, 12, 15, 20, 23, 28].includes(step)) {
        const pitches = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25]; // C4, D4, E4, G4, A4, C5
        const p = pitches[(step + 2) % pitches.length];
        this.synthVocalFormant(time, vocalNodes.inputNode, p, 0.35);
      }
    }

    // 4. Synth Lead / Pad (Rich saw chords with stereo chorus & shimmer)
    const synthNodes = this.tracks.get('track_synth');
    if (synthNodes) {
      if (step % 8 === 0) {
        this.synthPad(time, synthNodes.inputNode, step < 16 ? [220, 277.18, 329.63] : [196, 246.94, 293.66], 0.9);
      }
    }
  }

  // --- Sound Synthesizers for Demonstration ---

  private synthKick(time: number, dest: AudioNode): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Pitch envelope: drops rapidly from 160Hz down to 52Hz fundamental
    osc.frequency.setValueAtTime(165, time);
    osc.frequency.exponentialRampToValueAtTime(52, time + 0.08);
    osc.frequency.exponentialRampToValueAtTime(35, time + 0.35);

    gain.gain.setValueAtTime(1.0, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.38);

    // Click transient
    const clickOsc = this.ctx.createOscillator();
    const clickGain = this.ctx.createGain();
    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(600, time);
    clickGain.gain.setValueAtTime(0.4, time);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.02);

    osc.connect(gain);
    gain.connect(dest);
    clickOsc.connect(clickGain);
    clickGain.connect(dest);

    osc.start(time);
    osc.stop(time + 0.4);
    clickOsc.start(time);
    clickOsc.stop(time + 0.03);
  }

  private synth808(time: number, dest: AudioNode, freq: number, duration: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const saturation = this.ctx.createWaveShaper();

    // Subtle distortion curve for 2nd/3rd harmonics
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      curve[i] = (Math.PI + 3) * x / (Math.PI + 3 * Math.abs(x));
    }
    saturation.curve = curve;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.5, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.04);

    gain.gain.setValueAtTime(0.85, time);
    gain.gain.setValueAtTime(0.8, time + duration * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(saturation);
    saturation.connect(gain);
    gain.connect(dest);

    osc.start(time);
    osc.stop(time + duration);
  }

  private synthVocalFormant(time: number, dest: AudioNode, freq: number, duration: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const formant1 = this.ctx.createBiquadFilter();
    const formant2 = this.ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    // Formant filters to simulate 'Ah' and 'Oh' vowels
    formant1.type = 'bandpass';
    formant1.frequency.setValueAtTime(750, time);
    formant1.Q.setValueAtTime(4.0, time);

    formant2.type = 'bandpass';
    formant2.frequency.setValueAtTime(1350, time);
    formant2.Q.setValueAtTime(5.0, time);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.5, time + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(formant1);
    osc.connect(formant2);
    formant1.connect(gain);
    formant2.connect(gain);
    gain.connect(dest);

    osc.start(time);
    osc.stop(time + duration);
  }

  private synthPad(time: number, dest: AudioNode, freqs: number[], duration: number): void {
    if (!this.ctx) return;
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(0.001, time);
    masterGain.gain.linearRampToValueAtTime(0.35, time + 0.2);
    masterGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    masterGain.connect(dest);

    freqs.forEach((f, idx) => {
      const osc = this.ctx!.createOscillator();
      osc.type = idx % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(f * (1 + (idx - 1) * 0.003), time); // slight detune for lushness

      const filter = this.ctx!.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1800, time);
      filter.frequency.linearRampToValueAtTime(3200, time + duration * 0.5);
      filter.frequency.linearRampToValueAtTime(1200, time + duration);

      osc.connect(filter);
      filter.connect(masterGain);

      osc.start(time);
      osc.stop(time + duration);
    });
  }

  // --- Live Microphone Input ---
  public async enableMicrophone(trackId: string): Promise<boolean> {
    try {
      await this.initAudio();
      if (!this.ctx) return false;

      const nodes = this.tracks.get(trackId);
      if (!nodes) return false;

      // Release any previous capture so the device is never held twice
      this.disableMicrophone();

      // Raw capture: browser voice processing would colour the measurement
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      this.micStream = stream;
      this.micSource = this.ctx.createMediaStreamSource(stream);
      this.micSource.connect(nodes.inputNode);

      // Analyse the mic but keep it off the speakers to avoid acoustic feedback
      if (this.masterGain) {
        try {
          nodes.analyserNode.disconnect(this.masterGain);
        } catch {}
      }
      this.micTrackId = trackId;
      return true;
    } catch (err) {
      console.warn('Microphone access rejected or failed:', err);
      return false;
    }
  }

  public disableMicrophone(): void {
    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {}
      this.micSource = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.micTrackId) {
      const nodes = this.tracks.get(this.micTrackId);
      if (nodes && this.masterGain) nodes.analyserNode.connect(this.masterGain);
      this.micTrackId = null;
    }
  }

  // --- Test Signal Generators (Sine Sweep, Pink Noise, White Noise, 1kHz) ---
  public startTestSignal(
    type: 'sine' | 'sweep' | 'pink' | 'white' | '1khz' | '50hz' | '100hz' | '440hz',
    trackId: string
  ): void {
    this.stopTestSignal();
    if (!this.ctx) return;

    const nodes = this.tracks.get(trackId);
    if (!nodes) return;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    this.testSignalGain = gain;
    gain.connect(nodes.inputNode);

    if (type === '50hz') {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(50, this.ctx.currentTime);
      osc.connect(gain);
      osc.start();
      this.testSignalOsc = osc;
    } else if (type === '100hz') {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(100, this.ctx.currentTime);
      osc.connect(gain);
      osc.start();
      this.testSignalOsc = osc;
    } else if (type === '440hz') {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, this.ctx.currentTime);
      osc.connect(gain);
      osc.start();
      this.testSignalOsc = osc;
    } else if (type === '1khz' || type === 'sine') {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000, this.ctx.currentTime);
      osc.connect(gain);
      osc.start();
      this.testSignalOsc = osc;
    } else if (type === 'sweep') {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(20, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(20000, this.ctx.currentTime + 6.0);
      osc.connect(gain);
      osc.start();
      this.testSignalOsc = osc;
    } else if (type === 'pink' || type === 'white') {
      // Buffer-based noise generator
      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = buffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        if (type === 'white') {
          output[i] = white * 0.3;
        } else {
          // Paul Kellet's filtered pink noise algorithm
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.05;
          b6 = white * 0.115926;
        }
      }

      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = buffer;
      noiseSource.loop = true;
      noiseSource.connect(gain);
      noiseSource.start();
      this.customAudioSources.set('test_signal', noiseSource);
    }
  }

  public stopTestSignal(): void {
    if (this.testSignalOsc) {
      try {
        this.testSignalOsc.stop();
        this.testSignalOsc.disconnect();
      } catch {}
      this.testSignalOsc = null;
    }
    const noise = this.customAudioSources.get('test_signal');
    if (noise) {
      try {
        noise.stop();
        noise.disconnect();
      } catch {}
      this.customAudioSources.delete('test_signal');
    }
    if (this.testSignalGain) {
      try {
        this.testSignalGain.disconnect();
      } catch {}
      this.testSignalGain = null;
    }
  }

  // --- Real-Time Analysis Data Queries ---

  public getTrackFrequencyData(trackId: string, outArray: Float32Array): void {
    const nodes = this.tracks.get(trackId);
    if (nodes) {
      nodes.analyserNode.getFloatFrequencyData(outArray as unknown as Float32Array<ArrayBuffer>);
      // DC Blocking & Infrasonic roll-off:
      // AnalyserNode bin 0 is DC offset (0 Hz) which can cause false sub-bass rises.
      outArray[0] = -120;
      const binHz = this.getSampleRate() / nodes.analyserNode.fftSize;
      const subBins = Math.max(1, Math.floor(18 / binHz));
      for (let b = 1; b < subBins; b++) {
        const factor = b / subBins;
        outArray[b] = Math.max(-120, outArray[b] - (1 - factor) * 45);
      }
    } else {
      outArray.fill(-120);
    }
  }

  public getSampleRate(): number {
    return this.ctx ? this.ctx.sampleRate : 48000;
  }

  /** FFT size shared by all per-track analysers (kept in sync by setFftSize). */
  public getAnalyserFftSize(): number {
    const first = this.tracks.values().next().value as TrackNodes | undefined;
    return first ? first.analyserNode.fftSize : this.fftSize;
  }

  // --- Psychoacoustic Frequency Collision Detection ---
  public detectCollisions(activeTracks: AudioTrack[], threshold: number = 0.45): CollisionEvent[] {
    if (!this.ctx || activeTracks.length < 2) return [];

    const collisions: CollisionEvent[] = [];
    const sampleRate = this.ctx.sampleRate;
    // Must match the analysers' real FFT size, otherwise every bin maps to the wrong frequency
    const fftSize = this.getAnalyserFftSize();
    const binCount = fftSize / 2;
    const freqPerBin = sampleRate / fftSize;

    // Critical Frequency Bands (Bark Scale mapping)
    const criticalBands: { name: 'Sub' | 'Bass' | 'Low-Mid' | 'Mid' | 'High-Mid' | 'Presence'; minHz: number; maxHz: number }[] = [
      { name: 'Sub', minHz: 20, maxHz: 65 },
      { name: 'Bass', minHz: 65, maxHz: 250 },
      { name: 'Low-Mid', minHz: 250, maxHz: 500 },
      { name: 'Mid', minHz: 500, maxHz: 2000 },
      { name: 'High-Mid', minHz: 2000, maxHz: 6000 },
      { name: 'Presence', minHz: 6000, maxHz: 20000 },
    ];

    // Gather frequency data for all visible & unmuted tracks
    const trackBuffers = new Map<string, Float32Array>();
    activeTracks.forEach((t) => {
      if (t.isVisible && !t.isMuted) {
        const buf = new Float32Array(binCount);
        this.getTrackFrequencyData(t.id, buf);
        trackBuffers.set(t.id, buf);
      }
    });

    const trackList = activeTracks.filter((t) => trackBuffers.has(t.id));

    // Compare each pair of tracks
    for (let i = 0; i < trackList.length; i++) {
      for (let j = i + 1; j < trackList.length; j++) {
        const trackA = trackList[i];
        const trackB = trackList[j];
        const bufA = trackBuffers.get(trackA.id)!;
        const bufB = trackBuffers.get(trackB.id)!;

        // Inspect across each critical band
        criticalBands.forEach((band) => {
          const startBin = Math.max(1, Math.floor(band.minHz / freqPerBin));
          const endBin = Math.min(binCount - 1, Math.ceil(band.maxHz / freqPerBin));

          let maxOverlap = 0;
          let clashFreqHz = (band.minHz + band.maxHz) / 2;
          let peakA = -120;
          let peakB = -120;

          for (let b = startBin; b <= endBin; b++) {
            const dbA = bufA[b];
            const dbB = bufB[b];

            // Normalize dB (-80 to 0) into linear amplitude proxy
            if (dbA > -60 && dbB > -60) {
              const ampA = Math.pow(10, (dbA + 60) / 40);
              const ampB = Math.pow(10, (dbB + 60) / 40);
              const overlap = (2 * ampA * ampB) / (ampA * ampA + ampB * ampB);

              if (overlap > maxOverlap) {
                maxOverlap = overlap;
                clashFreqHz = Math.round(b * freqPerBin);
                peakA = dbA;
                peakB = dbB;
              }
            }
          }

          if (maxOverlap > threshold) {
            // Determine which track has lower hierarchy (e.g. Bass ducking for Kick, Synth ducking for Vocal)
            const isTrackAKick = trackA.type === 'kick';
            const isTrackBVocal = trackB.type === 'vocal';
            const targetTrack = isTrackAKick ? trackB : (isTrackBVocal ? trackA : (peakA > peakB ? trackB : trackA));
            const dominantTrack = targetTrack.id === trackA.id ? trackB : trackA;

            const recGain = Math.round(-3.0 - (maxOverlap * 4.5));
            const recQ = band.name === 'Sub' || band.name === 'Bass' ? 2.8 : 2.0;

            collisions.push({
              trackAId: trackA.id,
              trackBId: trackB.id,
              trackAName: trackA.name,
              trackBName: trackB.name,
              trackAColor: trackA.color,
              trackBColor: trackB.color,
              frequencyHz: clashFreqHz,
              bandwidthHz: Math.round(band.maxHz - band.minHz),
              maskingSeverity: Math.min(0.98, maxOverlap),
              criticalBand: band.name,
              description: `${dominantTrack.name} is masking ${targetTrack.name} in the ${band.name} band (${Math.round(maxOverlap * 100)}% clash).`,
              suggestedAction: {
                targetTrackId: targetTrack.id,
                targetTrackName: targetTrack.name,
                filterType: 'bell',
                frequencyHz: clashFreqHz,
                recommendedGainDb: recGain,
                q: recQ,
                duckingDb: Math.abs(recGain),
              },
            });
          }
        });
      }
    }

    return collisions;
  }

  // --- ITU-R BS.1770-4 EBU R128 Loudness Metering ---
  public calculateLoudness(): LoudnessMetrics {
    if (!this.masterAnalyser || !this.loudnessMeter) {
      return {
        momentaryLufs: -70,
        shortTermLufs: -70,
        integratedLufs: -70,
        truePeakDb: -70,
        crestFactorDb: 0,
        loudnessRangeLu: 0,
      };
    }

    const reading = this.loudnessMeter.read();

    // Crest factor (sample peak to RMS) from the latest master snapshot
    const timeData = new Float32Array(this.masterAnalyser.fftSize);
    this.masterAnalyser.getFloatTimeDomainData(timeData);
    let peak = 0;
    let sumSquares = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = timeData[i];
      const abs = Math.abs(v);
      if (abs > peak) peak = abs;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / timeData.length);
    const crestFactorDb = rms > 0.000001 && peak > 0 ? 20 * Math.log10(peak / rms) : 0;

    return {
      momentaryLufs: Math.max(-90, Math.min(3, reading.momentaryLufs)),
      shortTermLufs: Math.max(-90, Math.min(3, reading.shortTermLufs)),
      integratedLufs: Math.max(-90, Math.min(3, reading.integratedLufs)),
      truePeakDb: Math.max(-90, Math.min(6, reading.shortTermTruePeakDb)),
      crestFactorDb: Math.max(0, Math.min(30, crestFactorDb)),
      loudnessRangeLu: reading.loudnessRangeLu,
    };
  }

  public resetLoudness(): void {
    this.loudnessMeter?.reset();
  }

  public calculateTrackLoudness(trackId: string): { momentaryLufs: number; truePeakDb: number } {
    const nodes = this.tracks.get(trackId);
    const meter = this.trackMeters.get(trackId);
    if (!nodes || !meter) return { momentaryLufs: -90, truePeakDb: -90 };

    const momentaryLufs = meter.read().momentaryLufs;

    // Sample peak over the analyser window (per-track true peak would be too costly on the main thread)
    const timeData = new Float32Array(nodes.analyserNode.fftSize);
    nodes.analyserNode.getFloatTimeDomainData(timeData as unknown as Float32Array<ArrayBuffer>);
    let maxAbs = 0;
    for (let i = 0; i < timeData.length; i++) {
      const s = Math.abs(timeData[i]);
      if (s > maxAbs) maxAbs = s;
    }
    const truePeakDb = maxAbs > 0.000001 ? 20 * Math.log10(maxAbs) : -90;

    return {
      momentaryLufs: Math.max(-90, Math.min(3, momentaryLufs)),
      truePeakDb: Math.max(-90, Math.min(6, truePeakDb)),
    };
  }

  // --- Stereo Goniometer, Lissajous & Phase Correlation ---
  public calculateStereoMetrics(trackId?: string): StereoMetrics & { lissajousPoints: { x: number; y: number }[] } {
    let leftAnalyser: AnalyserNode | null = null;
    let rightAnalyser: AnalyserNode | null = null;

    if (trackId && this.tracks.has(trackId)) {
      const nodes = this.tracks.get(trackId)!;
      leftAnalyser = nodes.leftAnalyserNode;
      rightAnalyser = nodes.rightAnalyserNode;
    }

    if (!leftAnalyser || !rightAnalyser) {
      // Fallback to first available track or defaults
      const first = Array.from(this.tracks.values())[0];
      if (first) {
        leftAnalyser = first.leftAnalyserNode;
        rightAnalyser = first.rightAnalyserNode;
      }
    }

    if (!leftAnalyser || !rightAnalyser) {
      return {
        correlation: 1.0,
        widthPercent: 100,
        midLevelDb: -70,
        sideLevelDb: -70,
        balance: 0,
        lissajousPoints: [],
      };
    }

    const leftData = new Float32Array(512);
    const rightData = new Float32Array(512);
    leftAnalyser.getFloatTimeDomainData(leftData);
    rightAnalyser.getFloatTimeDomainData(rightData);

    let sumDot = 0;
    let sumL2 = 0;
    let sumR2 = 0;
    let sumMid2 = 0;
    let sumSide2 = 0;

    const lissajousPoints: { x: number; y: number }[] = [];
    const step = 4; // Sample every 4th point for high performance 60fps rendering

    for (let i = 0; i < leftData.length; i += step) {
      const l = leftData[i];
      const r = rightData[i];

      sumDot += l * r;
      sumL2 += l * l;
      sumR2 += r * r;

      const mid = (l + r) * 0.7071;
      const side = (l - r) * 0.7071;

      sumMid2 += mid * mid;
      sumSide2 += side * side;

      // Goniometer projection rotated 45 degrees (standard orientation: +L upper-left, +R upper-right)
      // X = (R - L) / sqrt(2)  [-Side]
      // Y = (L + R) / sqrt(2)  [Mid]
      lissajousPoints.push({
        x: -side,
        y: mid,
      });
    }

    // Pearson Correlation Coefficient r in [-1, 1]
    const denominator = Math.sqrt(sumL2 * sumR2);
    const correlation = denominator > 0.00001 ? Math.max(-1, Math.min(1, sumDot / denominator)) : 1.0;

    // Stereo Width: Ratio of Side energy to Mid energy
    const midEnergy = Math.sqrt(sumMid2);
    const sideEnergy = Math.sqrt(sumSide2);
    const widthPercent = midEnergy > 0.0001 ? Math.min(200, (sideEnergy / midEnergy) * 100) : 100;

    const midLevelDb = midEnergy > 0.00001 ? 20 * Math.log10(midEnergy) : -90;
    const sideLevelDb = sideEnergy > 0.00001 ? 20 * Math.log10(sideEnergy) : -90;

    const totalL = Math.sqrt(sumL2);
    const totalR = Math.sqrt(sumR2);
    const balance = (totalL + totalR) > 0.0001 ? (totalR - totalL) / (totalL + totalR) : 0;

    return {
      correlation,
      widthPercent,
      midLevelDb,
      sideLevelDb,
      balance,
      lissajousPoints,
    };
  }

  // --- Oscilloscope acquisition (shared timeline, sub-sample trigger) ---
  public getScopeFrame(req: ScopeFrameRequest): ScopeFrame | null {
    const sampleRate = this.getSampleRate();
    const rings = req.trackIds
      .map((id) => [id, this.trackRingBuffers.get(id)] as const)
      .filter((entry): entry is readonly [string, ScopeRing] => entry[1] !== undefined && entry[1].endSample > 0);
    if (rings.length === 0) return null;

    const triggerRing = req.triggerTrackId ? this.trackRingBuffers.get(req.triggerTrackId) : undefined;
    const capacity = rings[0][1].size;
    const length = Math.max(8, Math.min(capacity * 0.95, (req.timebaseMs / 1000) * sampleRate));

    // Newest instant that every channel (and the trigger source) has already delivered
    let commonEnd = Math.min(...rings.map(([, r]) => r.endSample));
    if (triggerRing && triggerRing.endSample > 0) commonEnd = Math.min(commonEnd, triggerRing.endSample);

    let start: number | null = null;
    let triggered = false;

    if (req.mode === 'trigger' && triggerRing) {
      const pre = Math.min(0.9, Math.max(0, req.preTrigger ?? 0.1));
      const post = length * (1 - pre);
      // Look for the newest edge first, widening the window only when needed; slow material
      // may need a long look-back, but most frames resolve within the first few milliseconds
      const searchEnd = commonEnd - post - 2;
      const maxSpan = Math.max(0, Math.min(capacity - length - 2, Math.max(length * 3, sampleRate * 0.25)));
      let crossing: number | null = null;
      for (let span = Math.min(maxSpan, 2048); crossing === null; span = Math.min(maxSpan, span * 4)) {
        crossing = findTriggerCrossing(
          triggerRing,
          searchEnd - span,
          searchEnd,
          req.triggerLevel ?? 0,
          req.triggerEdge ?? 'rising',
          0.01
        );
        if (span >= maxSpan) break;
      }
      if (crossing !== null) {
        start = crossing - pre * length;
        triggered = true;
      }
    }

    if (start === null) {
      // Roll / auto: glide between audio callbacks so the trace scrolls instead of jumping
      const newest = rings.reduce((r, [, ring]) => (ring.lastWriteMs > r.lastWriteMs ? ring : r), rings[0][1]);
      const blockLen = newest.lastBlockLength || TRACK_TAP_BLOCK;
      const elapsed = ((performance.now() - newest.lastWriteMs) / 1000) * sampleRate;
      const end = commonEnd - blockLen + Math.min(blockLen, Math.max(0, elapsed));
      start = end - length;
    }

    const traces = new Map<string, ScopeTrace>();
    for (const [id, ring] of rings) traces.set(id, acquireTrace(ring, start, length, Math.max(2, Math.round(req.columns))));
    return { traces, triggered, startSample: start };
  }

  // --- Phase Alignment Coherence Calculation ---
  public calculatePhaseAlignmentScore(trackAId: string, trackBId: string, phaseOffsetMs: number): number {
    const ringA = this.trackRingBuffers.get(trackAId);
    const ringB = this.trackRingBuffers.get(trackBId);
    if (!ringA || !ringB) return 1.0;

    const sampleRate = this.getSampleRate();
    const testSamples = 2048;
    const phaseSamples = Math.round((phaseOffsetMs / 1000) * sampleRate);

    let dot = 0;
    let sumA2 = 0;
    let sumB2 = 0;

    // Compare the same absolute instants of both tracks
    const start = Math.min(ringA.endSample, ringB.endSample - phaseSamples) - testSamples;

    for (let i = 0; i < testSamples; i += 2) {
      const a = ringA.sample(start + i);
      const b = ringB.sample(start + i + phaseSamples);
      dot += a * b;
      sumA2 += a * a;
      sumB2 += b * b;
    }

    const denom = Math.sqrt(sumA2 * sumB2);
    return denom > 0.00001 ? Math.max(-1.0, Math.min(1.0, dot / denom)) : 1.0;
  }

  // --- Get Track Amplitude Metrics for Auto-Trigger & Metering ---
  public getTrackPeak(trackId: string): { peakPos: number; peakNeg: number; maxPeak: number } {
    const ring = this.trackRingBuffers.get(trackId);
    if (!ring) return { peakPos: 0, peakNeg: 0, maxPeak: 0 };

    let peakPos = 0.001;
    let peakNeg = -0.001;
    const inspectSamples = Math.min(ring.size, Math.round(this.getSampleRate() * 0.2)); // ~200ms

    for (let s = ring.endSample - inspectSamples; s < ring.endSample; s++) {
      const v = ring.sample(s);
      if (v > peakPos) peakPos = v;
      if (v < peakNeg) peakNeg = v;
    }

    return {
      peakPos,
      peakNeg,
      maxPeak: Math.max(peakPos, Math.abs(peakNeg)),
    };
  }
}

// Singleton Engine Instance
export const audioEngine = new AudioEngine();
