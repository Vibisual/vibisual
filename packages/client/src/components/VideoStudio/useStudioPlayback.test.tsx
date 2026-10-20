import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc, type VideoDoc } from '@vibisual/video';

const perfMocks = vi.hoisted(() => ({ press: vi.fn(), move: vi.fn() }));
vi.mock('./studioPerf.js', () => ({ notePlayPress: perfMocks.press, notePlayMove: perfMocks.move }));

import {
  PLAYBACK_AUDIO_SLEW_MS,
  PLAYBACK_BUFFER_LAG_S,
  PLAYBACK_BUFFER_MIN_MS,
  PLAYBACK_BUFFER_SHOW_MS,
  useStudioPlayback,
  type PlaybackAudio,
  type PlaybackPreparation,
  type StudioPlayback,
} from './useStudioPlayback.js';
import { __resetStudioIdleForTest, isStudioBusy } from './studioIdle.js';

/**
 * §5.13 (Y) 40-9 · 40-10 ① — 재생은 **누르는 순간** 출발한다(첫 그림·소리를 기다리지 않는다 — R2). 소리가 붙으면 귀에 들리는 시각이
 * 시계의 주인이 되고(붙는 순간 튀지 않게 녹인다), 그림이 뒤처지면 시계와 소리가 함께 잠깐 선다(기다림 표시는 500ms 뒤 · 200ms 유지).
 * 재생 중 상태 재생 머리는 움직이지 않는다(40-5 ① — 스튜디오 전체를 다시 그리지 않게).
 */

interface Props extends PlaybackPreparation { doc: VideoDoc | null }
let handle: StudioPlayback;
let view: ReactTestRenderer | undefined;
let now = 0;
let nextRaf = 0;
const frames = new Map<number, FrameRequestCallback>();
function Harness({ doc, ...preparation }: Props): null { handle = useStudioPlayback(doc, preparation); return null; }
function document(id = 'preview', seconds = 20): VideoDoc {
  return { ...createEmptyDoc(id, 'Playback', 1), fps: 30, tracks: [
    { id: 'visual', kind: 'visual', items: [{ id: 'title', kind: 'text', at: 0, duration: seconds }] },
  ] };
}
function mount(props: Props): void { act(() => { view = create(createElement(Harness, props)); }); }
function update(props: Props): void { act(() => { view!.update(createElement(Harness, props)); }); }
function frameAt(ms: number): void {
  now = ms;
  const scheduled = [...frames.values()];
  frames.clear();
  act(() => scheduled.forEach((callback) => callback(now)));
}
function audioMock(heard: () => number | null = () => null): PlaybackAudio & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    play: vi.fn((at: number, loop: boolean, duration: number) => { calls.push(`play@${at}:${loop}:${duration}`); }),
    stop: vi.fn(() => { calls.push('stop'); }),
    now: vi.fn(heard),
    hold: vi.fn((on: boolean) => { calls.push(on ? 'hold' : 'release'); }),
  };
}

beforeEach(() => {
  now = 0; nextRaf = 0; frames.clear();
  perfMocks.press.mockReset(); perfMocks.move.mockReset();
  __resetStudioIdleForTest();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => { const id = ++nextRaf; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => { frames.delete(id); });
});
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); frames.clear(); });

describe('§5.13 (Y) 40-10 ① — 누르는 순간 출발', () => {
  it('unlocks audio synchronously, starts the audio at the press position, and moves on the next frame without waiting', () => {
    const order: string[] = [];
    const audio = audioMock();
    (audio.play as ReturnType<typeof vi.fn>).mockImplementation((at: number) => { order.push(`play@${at}`); });
    mount({ doc: document(), onStart: () => { order.push('unlock'); }, audio });
    act(() => handle.togglePlay());
    expect(order).toEqual(['unlock', 'play@0']);
    expect(handle.playing).toBe(true);
    expect(handle.preparing).toBe(false);
    expect(perfMocks.press).toHaveBeenCalledOnce();
    frameAt(500);
    expect(handle.clock.get()).toBe(0.5);
    expect(perfMocks.move).toHaveBeenCalled();
  });

  it('keeps the state playhead at the start while the clock runs (no whole-studio re-render during playback)', () => {
    mount({ doc: document() });
    act(() => handle.seek(2));
    act(() => handle.togglePlay());
    frameAt(400);
    frameAt(900);
    expect(handle.clock.get()).toBeCloseTo(2.9, 5);
    expect(handle.playhead).toBe(2);
    act(() => handle.setPlaying(false));
    expect(handle.playhead).toBeCloseTo(2.9, 5);
  });

  it('marks the studio busy while playing (background work rests)', () => {
    mount({ doc: document() });
    expect(isStudioBusy()).toBe(false);
    act(() => handle.togglePlay());
    expect(isStudioBusy()).toBe(true);
    act(() => handle.togglePlay());
    expect(isStudioBusy()).toBe(false);
  });

  it('restarts from zero at the last frame', () => {
    const audio = audioMock();
    mount({ doc: document(), audio });
    act(() => handle.seek(handle.lastFrameAt));
    act(() => handle.togglePlay());
    expect(handle.clock.get()).toBe(0);
    expect(audio.calls[0]).toBe(`play@0:false:${handle.duration}`);
  });

  it('stops at the last frame without looping and stops the audio', () => {
    const audio = audioMock();
    mount({ doc: document('short', 1), audio });
    act(() => handle.togglePlay());
    frameAt(2_000);
    expect(handle.playing).toBe(false);
    expect(handle.clock.get()).toBe(handle.lastFrameAt);
    expect(handle.playhead).toBe(handle.lastFrameAt);
    expect(audio.calls).toContain('stop');
    expect(frames.size).toBe(0);
  });

  it('wraps the clock when looping and restarts the audio with the loop rule when looping is toggled', () => {
    const audio = audioMock();
    mount({ doc: document('loop', 2), audio });
    act(() => handle.togglePlay());
    act(() => handle.toggleLoop());
    expect(audio.calls.slice(-2)).toEqual(['stop', `play@0:true:${handle.duration}`]);
    frameAt(2_500);
    expect(handle.playing).toBe(true);
    expect(handle.clock.get()).toBeCloseTo(0.5, 5);
  });

  it('stops the audio and keeps the position on pause, seek and document change', () => {
    const audio = audioMock();
    const props: Props = { doc: document(), audio, scope: 'a' };
    mount(props);
    act(() => handle.togglePlay());
    frameAt(1_000);
    act(() => handle.seek(5));
    expect(handle.playing).toBe(false);
    expect(handle.clock.get()).toBe(5);
    expect(audio.calls.filter((c) => c === 'stop')).toHaveLength(1);
    act(() => handle.togglePlay());
    update({ ...props, doc: document('other') });
    expect(handle.playing).toBe(false);
    expect(handle.clock.get()).toBe(0);
    expect(frames.size).toBe(0);
  });
});

describe('§5.13 (Y) 40-9 — 소리가 시계의 주인', () => {
  it('runs on the wall clock until the audio attaches, then follows the heard time with a short slew (no jump)', () => {
    let heard: number | null = null;
    const audio = audioMock(() => heard);
    mount({ doc: document(), audio });
    act(() => handle.togglePlay());
    frameAt(200);
    expect(handle.clock.get()).toBe(0.2);
    // 소리가 붙었다 — 출력 지연만큼(0.15초) 뒤에서 들린다. 넘기는 순간 그림이 뒤로 튀지 않는다.
    heard = 0.05;
    frameAt(200);
    expect(handle.clock.get()).toBe(0.2);
    // 녹이는 시간이 지나면 들리는 시각 그대로다.
    heard = 0.3;
    frameAt(200 + PLAYBACK_AUDIO_SLEW_MS);
    expect(handle.clock.get()).toBe(0.3);
    heard = 1.0;
    frameAt(2_000);
    expect(handle.clock.get()).toBe(1.0);
  });
});

describe('§5.13 (Y) 40-9 · 40-10 ② — 그림이 뒤처지면 잠깐 선다', () => {
  it('holds the clock and the audio while the picture lags, shows the waiting mark only after the delay and keeps it the minimum time', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let lag = 0;
    const audio = audioMock();
    mount({ doc: document(), audio, frameLag: () => lag });
    act(() => handle.togglePlay());
    frameAt(100);
    expect(handle.clock.get()).toBe(0.1);
    lag = PLAYBACK_BUFFER_LAG_S + 0.2;
    frameAt(200);
    expect(audio.calls).toContain('hold');
    const held = handle.clock.get();
    frameAt(200 + PLAYBACK_BUFFER_SHOW_MS - 50);
    expect(handle.clock.get()).toBe(held);
    expect(handle.preparing).toBe(false); // 짧은 기다림에는 표시하지 않는다.
    frameAt(200 + PLAYBACK_BUFFER_SHOW_MS + 10);
    expect(handle.preparing).toBe(true);
    // 따라잡았다 — 다시 간다. 표시는 최소 시간만큼 머문다.
    lag = 0;
    frameAt(200 + PLAYBACK_BUFFER_SHOW_MS + 20);
    expect(audio.calls).toContain('release');
    expect(handle.preparing).toBe(true);
    act(() => { vi.advanceTimersByTime(PLAYBACK_BUFFER_MIN_MS); });
    expect(handle.preparing).toBe(false);
    frameAt(200 + PLAYBACK_BUFFER_SHOW_MS + 520);
    expect(handle.clock.get()).toBeCloseTo(held + 0.5, 1);
  });

  it('releases a held audio context when playback ends while buffering', () => {
    const audio = audioMock();
    mount({ doc: document(), audio, frameLag: () => 1 });
    act(() => handle.togglePlay());
    frameAt(100);
    expect(audio.calls).toContain('hold');
    act(() => handle.setPlaying(false));
    expect(audio.calls.slice(-2)).toEqual(['stop', 'release']);
    expect(handle.preparing).toBe(false);
  });
});
