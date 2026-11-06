import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOfflineRecognition, voiceEngineUrl } from './offlineRecognition.js';

describe('voice engine transport address', () => {
  it.each([
    ['https://192.168.1.5:8443/', 'wss://192.168.1.5:8443/api/voice-asr/socket'],
    ['https://203.0.113.8:443/', 'wss://203.0.113.8/api/voice-asr/socket'],
    ['https://[2001:db8::1]:8443/', 'wss://[2001:db8::1]:8443/api/voice-asr/socket'],
    ['https://localhost:8443/', 'wss://localhost:8443/api/voice-asr/socket'],
    ['http://192.168.1.5:8000/', 'ws://192.168.1.5:8000/api/voice-asr/socket'],
    ['http://localhost:5173/', 'ws://localhost:12345'],
    ['http://127.0.0.1:5173/', 'ws://127.0.0.1:12345'],
    ['http://[::1]:5173/', 'ws://[::1]:12345'],
    ['file:///C:/app/index.html', 'ws://127.0.0.1:12345'],
  ])('routes %s without exposing a remote engine port', (page, endpoint) => {
    expect(voiceEngineUrl(new URL(page), 12345)).toBe(endpoint);
  });
});

class FakeSocket {
  static OPEN = 1;
  static latest: FakeSocket;
  readyState = 0;
  binaryType = '';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor() { FakeSocket.latest = this; }
  open(): void { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
}

describe('mobile voice connection lifetime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('window', { location: new URL('https://192.168.1.5:8443/') });
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  function recognizer() {
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    return createOfflineRecognition({ port: 12345, stream: {} as MediaStream,
      audioContext: {
        createMediaStreamSource: node, createScriptProcessor: node,
        createGain: () => ({ ...node(), gain: { value: 1 } }), destination: node(),
      } as unknown as AudioContext,
    });
  }

  it('reports a lost mobile socket instead of silently staying in listening', () => {
    const rec = recognizer();
    rec.onerror = vi.fn();
    rec.onend = vi.fn();
    rec.start();
    FakeSocket.latest.open();
    FakeSocket.latest.onclose?.();
    expect(rec.onerror).toHaveBeenCalledWith({ error: 'network' });
    expect(rec.onend).toHaveBeenCalledOnce();
  });

  it('bounds a pending connection and releases its socket', () => {
    const rec = recognizer();
    rec.onerror = vi.fn();
    rec.start();
    vi.advanceTimersByTime(10_000);
    expect(rec.onerror).toHaveBeenCalledWith({ error: 'network' });
    expect(FakeSocket.latest.close).toHaveBeenCalledOnce();
  });

  it('keeps the final transcript after stop and does not report normal completion as network failure', () => {
    const rec = recognizer();
    rec.onresult = vi.fn();
    rec.onerror = vi.fn();
    rec.onend = vi.fn();
    rec.start();
    FakeSocket.latest.open();
    rec.stop();
    expect(FakeSocket.latest.send).toHaveBeenCalledWith('Done');
    FakeSocket.latest.onmessage?.({ data: JSON.stringify({ text: '마지막 문장', is_final: true }) });
    FakeSocket.latest.onmessage?.({ data: 'Done!' });
    expect(rec.onresult).toHaveBeenCalledWith(expect.objectContaining({
      results: expect.objectContaining({ 0: expect.objectContaining({ isFinal: true, 0: { transcript: '마지막 문장', confidence: 1 } }) }),
    }));
    expect(rec.onerror).not.toHaveBeenCalled();
    expect(rec.onend).toHaveBeenCalledOnce();
  });
});
