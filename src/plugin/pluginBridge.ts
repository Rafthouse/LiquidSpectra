/**
 * Bridge to the native plugin host.
 *
 * Inside the plugin the page runs in a JUCE WebBrowserComponent, which injects `window.__JUCE__`.
 * The native side pushes one frame per UI tick through `window.__LS_FRAME__` and receives UI events
 * through the "ui" event channel. In a normal browser nothing here is active.
 */

export interface PluginTrackFrame {
  slot: number;
  self: boolean;
  name: string;
  argb: number;
  /** Full-resolution spectrum in dB (FFT bins, DC first). */
  spectrum: Float32Array;
  /** 24 critical-band levels in dB. */
  bark: Float32Array;
  /** Absolute sample index one past the newest waveform frame (present when waveforms were requested). */
  end?: number;
  left?: Float32Array;
  right?: Float32Array;
}

export interface PluginCollisionFrame {
  a: number;
  b: number;
  aName: string;
  bName: string;
  band: number;
  hz: number;
  severity: number;
  cutDb: number;
  q: number;
}

export interface PluginFrame {
  t: number;
  sr: number;
  self: number;
  tracks: PluginTrackFrame[];
  collisions: PluginCollisionFrame[];
  loud: { m: number; s: number; i: number; lra: number; tp: number };
  meter: { peakL: number; peakR: number };
}

type FrameListener = (frame: PluginFrame) => void;

interface JuceBackend {
  emitEvent: (eventId: string, data: unknown) => void;
  addEventListener?: (eventId: string, callback: (data: unknown) => void) => unknown;
}

interface HostWindow {
  __JUCE__?: { backend?: JuceBackend };
  __LS_FRAME__?: (raw: RawFrame) => void;
  __LS_RESTORE__?: (state: unknown) => void;
}

// Shape as it arrives from the native side (arrays are base64-encoded float32 buffers)
interface RawTrack {
  slot: number;
  self: boolean;
  name: string;
  argb: number;
  spec: string | Float32Array;
  bark: string | Float32Array;
  end?: number;
  wl?: string | Float32Array;
  wr?: string | Float32Array;
}
interface RawFrame {
  t: number;
  sr: number;
  self: number;
  tracks: RawTrack[];
  collisions: PluginCollisionFrame[];
  loud: PluginFrame['loud'];
  meter: PluginFrame['meter'];
}

const hostWindow = (): HostWindow => window as unknown as HostWindow;

const frameListeners = new Set<FrameListener>();
let latestFrame: PluginFrame | null = null;
let pendingRestore: unknown = undefined;
let restoreHandler: ((state: unknown) => void) | null = null;

// Dev-only synthetic feed: `?fakePlugin` in `npm run dev` simulates the plugin host so the plugin UI can be tested in a browser
const fakeFeedRequested = import.meta.env.DEV && new URLSearchParams(window.location.search).has('fakePlugin');

export function isPluginHost(): boolean {
  return fakeFeedRequested || hostWindow().__JUCE__ !== undefined;
}

function decodeFloat32(value: string | Float32Array): Float32Array {
  if (value instanceof Float32Array) return value;
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function toFrame(raw: RawFrame): PluginFrame {
  return {
    t: raw.t,
    sr: raw.sr,
    self: raw.self,
    collisions: raw.collisions,
    loud: raw.loud,
    meter: raw.meter,
    tracks: raw.tracks.map((track) => ({
      slot: track.slot,
      self: track.self,
      name: track.name,
      argb: track.argb,
      spectrum: decodeFloat32(track.spec),
      bark: decodeFloat32(track.bark),
      end: track.end,
      left: track.wl !== undefined ? decodeFloat32(track.wl) : undefined,
      right: track.wr !== undefined ? decodeFloat32(track.wr) : undefined,
    })),
  };
}

function receiveFrame(raw: RawFrame): void {
  latestFrame = toFrame(raw);
  frameListeners.forEach((listener) => listener(latestFrame!));
}

/** Sends a UI event to the native side (no-op outside the plugin). */
export function sendToHost(op: string, payload: Record<string, unknown> = {}): void {
  hostWindow().__JUCE__?.backend?.emitEvent('ui', { op, ...payload });
}

/** Subscribes to frames pushed by the native side. Returns an unsubscribe function. */
export function subscribeFrames(listener: FrameListener): () => void {
  frameListeners.add(listener);
  return () => frameListeners.delete(listener);
}

export function getLatestFrame(): PluginFrame | null {
  return latestFrame;
}

/** Registers the handler for the state saved by the host. Replays a state that arrived earlier. */
export function onHostRestore(handler: (state: unknown) => void): void {
  restoreHandler = handler;
  if (pendingRestore !== undefined) {
    handler(pendingRestore);
    pendingRestore = undefined;
  }
}

/** Saves web UI state into the plugin project (stored by the host, handed back on the next load). */
export function saveHostState(state: unknown): void {
  sendToHost('saveState', { json: JSON.stringify(state) });
}

// --- Host installation -------------------------------------------------------

if (typeof window !== 'undefined') {
  const host = hostWindow();

  if (fakeFeedRequested && host.__JUCE__ === undefined) {
    host.__JUCE__ = { backend: { emitEvent: () => undefined } };
    startFakeFeed();
  }

  host.__LS_FRAME__ = receiveFrame;
  host.__LS_RESTORE__ = (state: unknown) => {
    if (restoreHandler) restoreHandler(state);
    else pendingRestore = state;
  };

  if (host.__JUCE__ !== undefined) sendToHost('ready');
}

function startFakeFeed(): void {
  const sr = 48000;
  const tracks = [
    { slot: 0, self: true, name: 'Track 1', argb: 0xff06b6d4, f0: 180, w: 1.2 },
    { slot: 3, self: false, name: 'Bass', argb: 0xffa855f7, f0: 70, w: 1.0 },
    { slot: 7, self: false, name: 'Vocal', argb: 0xfff59e0b, f0: 1800, w: 1.4 },
  ];
  const bins = 2048;
  const encode = (values: Float32Array): string => {
    const bytes = new Uint8Array(values.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  };

  let samplePos = 0;
  setInterval(() => {
    const frameSamples = 1600;
    const rawTracks: RawTrack[] = tracks.map((track) => {
      const spectrum = new Float32Array(bins);
      const bark = new Float32Array(24);
      for (let k = 0; k < bins; k++) {
        const f = (k * sr) / (2 * bins);
        const lf = Math.log2(Math.max(f, 1) / track.f0);
        spectrum[k] = -20 - 60 * Math.abs(lf) / track.w - Math.random() * 3;
      }
      for (let b = 0; b < 24; b++) bark[b] = spectrum[Math.min(bins - 1, Math.round(b * bins / 24))];
      const left = new Float32Array(2048);
      const right = new Float32Array(2048);
      for (let i = 0; i < 2048; i++) {
        const t = (samplePos + i) / sr;
        const s = 0.6 * Math.sin(2 * Math.PI * track.f0 * t) + 0.05 * (Math.random() - 0.5);
        left[i] = s;
        right[i] = 0.8 * s + 0.1 * Math.sin(2 * Math.PI * (track.f0 * 2) * t);
      }
      return {
        slot: track.slot,
        self: track.self,
        name: track.name,
        argb: track.argb,
        spec: encode(spectrum),
        bark: encode(bark),
        end: samplePos + frameSamples,
        wl: encode(left),
        wr: encode(right),
      };
    });

    samplePos += frameSamples;
    receiveFrame({
      t: samplePos,
      sr,
      self: 0,
      tracks: rawTracks,
      collisions: [{ a: 0, b: 3, aName: 'Track 1', bName: 'Bass', band: 3, hz: 110, severity: 0.42, cutDb: -3.5, q: 1.4 }],
      loud: { m: -14.2, s: -15.1, i: -16.0, lra: 6.3, tp: -1.2 },
      meter: { peakL: -4.5, peakR: -5.1 },
    });
  }, 33);
}
