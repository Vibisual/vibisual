import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOfflineRecognition } from '../utils/offlineRecognition.js';
import type { SpeechRecognitionLike } from '../utils/speechRecognition.js';
import { useVoiceDictation, type VoiceDictationHandle, type UseVoiceDictationOptions } from './useVoiceDictation.js';

vi.mock('../utils/offlineRecognition.js', () => ({ createOfflineRecognition: vi.fn() }));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((done) => { resolve = done; }), resolve: (value) => resolve(value) };
}

let renderer: ReactTestRenderer | null = null;
let handle: VoiceDictationHandle;
let order: string[];
let contexts: FakeAudioContext[];
let stream: MediaStream;
let stopTrack: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;
let rec: SpeechRecognitionLike;
let stuckAudio: boolean;

class FakeAudioContext {
  state: AudioContextState = 'suspended';
  onstatechange: (() => void) | null = null;
  resume = vi.fn(() => {
    order.push('resume');
    if (stuckAudio) return new Promise<void>(() => undefined);
    this.state = 'running';
    return Promise.resolve();
  });
  close = vi.fn(() => { this.state = 'closed'; return Promise.resolve(); });
  createAnalyser = vi.fn(() => ({ fftSize: 0, smoothingTimeConstant: 0 }));
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  constructor() { order.push('context'); contexts.push(this); }
}

function mount(overrides: Partial<UseVoiceDictationOptions> = {}): UseVoiceDictationOptions {
  const opts: UseVoiceDictationOptions = {
    locale: 'ko', enabled: true, onCommit: vi.fn(), onNeedsInstall: vi.fn(), onSessionEnd: vi.fn(),
    resolvePort: vi.fn(async () => { order.push('engine'); return { ok: true as const, port: 12345 }; }),
    ...overrides,
  };
  function Probe(): null { handle = useVoiceDictation(opts); return null; }
  act(() => { renderer = create(createElement(Probe)); });
  return opts;
}

beforeEach(() => {
  vi.useFakeTimers();
  order = [];
  contexts = [];
  stuckAudio = false;
  stopTrack = vi.fn();
  const track = { stop: stopTrack, getSettings: () => ({ echoCancellation: true }) };
  stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  getUserMedia = vi.fn(async () => { order.push('microphone'); return stream; });
  vi.stubGlobal('window', { isSecureContext: true, AudioContext: FakeAudioContext });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices: vi.fn(async () => []) } });
  rec = {
    lang: '', continuous: false, interimResults: false, maxAlternatives: 1,
    start: vi.fn(() => rec.onstart?.()), stop: vi.fn(), abort: vi.fn(),
    onstart: null, onend: null, onresult: null, onerror: null, onspeechend: null,
  };
  vi.mocked(createOfflineRecognition).mockReset().mockReturnValue(rec);
});

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('voice capture on desktop and mobile browsers', () => {
  it('reports insecure LAN HTTP before touching the engine or microphone', () => {
    vi.stubGlobal('window', { isSecureContext: false });
    vi.stubGlobal('navigator', {});
    const opts = mount();
    act(() => handle.start());
    expect(handle.error).toBe('insecure-context');
    expect(opts.resolvePort).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('unlocks Web Audio during the tap, before awaiting the engine; mic still waits for readiness', async () => {
    const pending = deferred<{ ok: true; port: number }>();
    mount({ resolvePort: () => { order.push('engine'); return pending.promise; } });
    act(() => handle.start());
    expect(order).toEqual(['context', 'resume', 'engine']);
    expect(getUserMedia).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ ok: true, port: 12345 }));
    expect(handle.status).toBe('listening');
    expect(createOfflineRecognition).toHaveBeenCalledWith({ port: 12345, stream, audioContext: contexts[0] });
    act(() => handle.cancel());
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(contexts[0]!.close).toHaveBeenCalledTimes(1);
  });

  it('supports the prefixed WebKit audio constructor', async () => {
    vi.stubGlobal('window', { isSecureContext: true, webkitAudioContext: FakeAudioContext });
    mount();
    await act(async () => handle.start());
    expect(handle.status).toBe('listening');
  });

  it('closes the unlocked context when the engine needs installing', async () => {
    const opts = mount({ resolvePort: async () => ({ ok: false, reason: 'needs-install' }) });
    await act(async () => handle.start());
    expect(opts.onNeedsInstall).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(contexts[0]!.close).toHaveBeenCalledTimes(1);
    expect(handle.status).toBe('idle');
  });

  it('handles a rejected engine lookup without leaking the context or staying in starting', async () => {
    mount({ resolvePort: async () => { throw new Error('offline'); } });
    await act(async () => handle.start());
    expect(handle.error).toBe('engine');
    expect(contexts[0]!.close).toHaveBeenCalledTimes(1);
  });

  it('releases a session acquired after cancel when there is no newer opening', async () => {
    const pending = deferred<{ ok: true; port: number }>();
    const opts = mount({ resolvePort: () => pending.promise });
    act(() => handle.start());
    act(() => handle.cancel());
    expect(opts.onSessionEnd).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ ok: true, port: 12345 }));
    expect(opts.onSessionEnd).toHaveBeenCalledTimes(2);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('keeps a newer session alive if the stopped recognizer fails while draining final results', async () => {
    mount();
    await act(async () => handle.start());
    const previous = rec;
    act(() => handle.stop());
    rec = { ...rec, start: vi.fn(() => rec.onstart?.()), onstart: null, onend: null, onerror: null, onresult: null };
    vi.mocked(createOfflineRecognition).mockReturnValue(rec);
    await act(async () => handle.start());
    act(() => previous.onerror?.({ error: 'network' }));
    expect(handle.status).toBe('listening');
    expect(contexts[1]!.close).not.toHaveBeenCalled();
  });

  it('stops the late microphone after cancel without closing a newer session', async () => {
    const pending = deferred<MediaStream>();
    getUserMedia.mockReturnValueOnce(pending.promise);
    mount();
    await act(async () => handle.start());
    act(() => handle.cancel());
    await act(async () => handle.start());
    expect(handle.status).toBe('listening');
    const lateStop = vi.fn();
    await act(async () => pending.resolve({ getTracks: () => [{ stop: lateStop }] } as unknown as MediaStream));
    expect(lateStop).toHaveBeenCalledOnce();
    expect(contexts[1]!.close).not.toHaveBeenCalled();
    expect(handle.status).toBe('listening');
  });

  it('releases the microphone if Web Audio never leaves suspended', async () => {
    stuckAudio = true;
    mount();
    await act(async () => handle.start());
    expect(handle.status).toBe('starting');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(handle.status).toBe('error');
    expect(createOfflineRecognition).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(contexts[0]!.close).toHaveBeenCalledOnce();
  });

  it('ignores stale device enumeration after a newer session has started', async () => {
    const devices = deferred<MediaDeviceInfo[]>();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices: () => devices.promise } });
    getUserMedia.mockRejectedValueOnce(new DOMException('blocked', 'NotFoundError'));
    mount();
    await act(async () => handle.start());
    act(() => handle.cancel());
    await act(async () => handle.start());
    await act(async () => devices.resolve([]));
    expect(handle.status).toBe('listening');
    expect(handle.error).toBeNull();
  });

  it('releases capture when the OS interrupts audio after listening starts', async () => {
    mount();
    await act(async () => handle.start());
    act(() => {
      contexts[0]!.state = 'suspended';
      contexts[0]!.onstatechange?.();
    });
    expect(handle.error).toBe('device');
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(contexts[0]!.onstatechange).toBeNull();
  });
});
