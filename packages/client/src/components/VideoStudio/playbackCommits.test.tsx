import { createElement, Profiler, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc, type VideoDoc } from '@vibisual/video';

vi.mock('./studioPerf.js', () => ({ notePlayPress: vi.fn(), notePlayMove: vi.fn() }));

import { useStudioPlayback, type StudioPlayback } from './useStudioPlayback.js';
import { usePlayheadTransform, playheadTranslate, type PlayheadClock } from './playheadClock.js';
import { memoLatest } from './studioMemo.js';
import { __resetStudioIdleForTest } from './studioIdle.js';

/**
 * §5.13 (Y) 40-5 ①③④ — 재생하는 동안 스튜디오가 다시 그려지지 않는다: 프레임마다 가는 것은 시계뿐이고 재생 머리 선은 렌더 없이 `transform` 만 바꾼다.
 * React Profiler 로 실제 커밋 수를 센다.
 */

let view: ReactTestRenderer | undefined;
let now = 0;
const frames = new Map<number, FrameRequestCallback>();
let nextRaf = 0;
let playback: StudioPlayback;

function doc(): VideoDoc {
  return { ...createEmptyDoc('d', 'Doc', 1), fps: 30, tracks: [{ id: 'visual', kind: 'visual', items: [{ id: 't', kind: 'text', at: 0, duration: 30 }] }] };
}

function frameAt(ms: number): void {
  now = ms;
  const due = [...frames.values()];
  frames.clear();
  act(() => due.forEach((cb) => cb(now)));
}

beforeEach(() => {
  now = 0; nextRaf = 0; frames.clear();
  __resetStudioIdleForTest();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => { const id = ++nextRaf; frames.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => { frames.delete(id); });
});
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** 무거운 판 대역 — 재생 머리 상태·시계·손잡이를 받는다(셸이 장면 구슬 줄에 넘기는 모양). */
const HeavyPanel = memoLatest(function HeavyPanel(p: { readonly playhead: number; readonly clock: PlayheadClock; readonly onSeek: (t: number) => void; readonly duration: number }): React.JSX.Element {
  const line = useRef<HTMLSpanElement>(null);
  const transform = usePlayheadTransform(line, p.clock, p.playhead, p.duration);
  return createElement('span', { ref: line, style: { transform } });
});

function Shell(): React.JSX.Element {
  const doc0 = useRef(doc()).current;
  playback = useStudioPlayback(doc0);
  return createElement(Profiler, { id: 'panel', onRender: () => { commits.panel += 1; } },
    createElement(HeavyPanel, { playhead: playback.playhead, clock: playback.clock, onSeek: playback.seek, duration: playback.duration }));
}
const commits = { panel: 0 };

describe('§5.13 (Y) 40-5 — 재생 중 커밋', () => {
  it('plays 60 frames without committing the heavy panel, while the playhead line follows the clock', () => {
    commits.panel = 0;
    const nodes: { style: Record<string, string> }[] = [];
    act(() => {
      view = create(createElement(Shell), { createNodeMock: () => { const node = { style: {} as Record<string, string> }; nodes.push(node); return node; } });
    });
    expect(commits.panel).toBe(1);
    act(() => playback.togglePlay());
    const afterPress = commits.panel;
    for (let i = 1; i <= 60; i += 1) frameAt(i * (1000 / 30));
    expect(playback.clock.get()).toBeCloseTo(2, 1);
    // 누름(재생 상태) 이후로 판은 한 번도 다시 커밋되지 않았다.
    expect(commits.panel).toBe(afterPress);
    expect(afterPress).toBeLessThanOrEqual(2);
    // 선은 렌더 없이 옮겨졌다.
    expect(nodes[0]!.style['transform']).toBe(playheadTranslate(playback.clock.get(), playback.duration));
  });
});
