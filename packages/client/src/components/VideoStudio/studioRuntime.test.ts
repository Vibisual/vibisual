import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedCommand, SubAgentStreamEvent } from '@vibisual/shared';

vi.mock('./studioMedia.js', () => ({ studioAudioMemoryBytes: () => 3 * 1024 * 1024 }));

import { deviceTier, studioBudget, urlCacheBytesFor } from './studioBudget.js';
import { __resetStudioIdleForTest, isStudioBusy, noteStudioInput, runWhenIdle, setStudioBusy, STUDIO_TYPING_QUIET_MS } from './studioIdle.js';
import { studioChatTail } from './useStudioConversation.js';
import { logStudioMemory, notePlayMove, notePlayPress, notePreviewWait, startStudioPerfSession, summarizeWaits } from './studioPerf.js';
import { emitAppEvent, onAppEvent } from '../../apps/appEvents.js';

/**
 * §5.13 (Y) 40-5 ② · 40-10 ④ · 40-11 · 40-12 · 40-7 ② — 스튜디오 실행 도우미들: 메모리 예산 등급 · 배경 일 줄 · 대화 꼬리 · 계측 ·
 * 앱 알림 통로.
 */

describe('§5.13 (Y) 40-11 — 메모리 예산(기기 등급)', () => {
  it('tiers by cores and memory — unknown is the middle, 4 cores or 4GB is low, 12 cores and 8GB is high', () => {
    expect(deviceTier({})).toBe('mid');
    expect(deviceTier({ hardwareConcurrency: 4, deviceMemory: 8 })).toBe('low');
    expect(deviceTier({ hardwareConcurrency: 16, deviceMemory: 4 })).toBe('low');
    expect(deviceTier({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe('mid');
    expect(deviceTier({ hardwareConcurrency: 32, deviceMemory: 8 })).toBe('high');
  });

  it('a 4-core / 8GB machine keeps the small limits', () => {
    const low = studioBudget({ hardwareConcurrency: 4, deviceMemory: 8 });
    expect(low).toMatchObject({ tier: 'low', audioChunkBytes: 32 * 1024 * 1024, footageReaders: 2, offscreenIdleWindows: 0 });
    expect(low.warm.aheadMax).toBe(1);
    expect(urlCacheBytesFor(low, 8)).toBe(4 * 1024 * 1024);
    expect(urlCacheBytesFor(studioBudget({ hardwareConcurrency: 32, deviceMemory: 8 }), 2)).toBe(32 * 1024 * 1024);
  });
});

describe('§5.13 (Y) 40-10 ④ — 배경 일 줄', () => {
  beforeEach(() => { __resetStudioIdleForTest(); vi.useFakeTimers(); vi.stubGlobal('scheduler', undefined); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __resetStudioIdleForTest(); });

  it('waits while playing/scrubbing and runs once idle', async () => {
    const task = vi.fn(() => 'done');
    setStudioBusy('playing', true);
    const run = runWhenIdle(task);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).not.toHaveBeenCalled();
    setStudioBusy('playing', false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(run).resolves.toBe('done');
  });

  it('counts holders and treats typing as busy for a quiet period', async () => {
    setStudioBusy('scrubbing', true);
    setStudioBusy('scrubbing', true);
    setStudioBusy('scrubbing', false);
    expect(isStudioBusy()).toBe(true);
    setStudioBusy('scrubbing', false);
    expect(isStudioBusy()).toBe(false);
    noteStudioInput();
    expect(isStudioBusy()).toBe(true);
    await vi.advanceTimersByTimeAsync(STUDIO_TYPING_QUIET_MS + 1);
    expect(isStudioBusy()).toBe(false);
  });

  it('honours the debounce delay and abort', async () => {
    const task = vi.fn();
    const abort = new AbortController();
    const run = runWhenIdle(task, { delayMs: 400, signal: abort.signal });
    await vi.advanceTimersByTimeAsync(200);
    abort.abort();
    await expect(run).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).not.toHaveBeenCalled();
  });
});

describe('§5.13 (Y) 40-5 ② — 대화 꼬리 = 전체로 만든 마지막 줄', () => {
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** 실제 스트림 모양 — 줄마다 그 턴의 도장(turnId)을 찍고(일부만), 끝난 턴은 result 로 닫는다. 대기 명령은 꼬리. */
  function conversation(seed: number, turns: number, stamp: boolean): { events: SubAgentStreamEvent[]; commands: QueuedCommand[] } {
    const rnd = mulberry32(seed);
    const events: SubAgentStreamEvent[] = [];
    const commands: QueuedCommand[] = [];
    let ts = 1_000;
    for (let k = 0; k < turns; k += 1) {
      ts += 10;
      const last = k === turns - 1;
      commands.push({ id: `c${k}`, text: `ask ${k}`, timestamp: ts - 5, startedAt: ts, subAgentId: 'S', status: last ? 'executing' : 'completed' } as QueuedCommand);
      const n = 1 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i += 1) {
        ts += 1 + Math.floor(rnd() * 3);
        const base = { id: `e${k}_${i}`, subAgentId: 'S', parentAgentId: 'P', timestamp: ts, ...(stamp && rnd() < 0.6 ? { turnId: `c${k}` } : {}) };
        const kind = rnd();
        if (kind < 0.5) events.push({ ...base, eventType: 'text', content: `answer ${k}.${i}` } as SubAgentStreamEvent);
        else if (kind < 0.75) events.push({ ...base, eventType: 'tool_use', toolName: 'Read', content: `in${k}` } as SubAgentStreamEvent);
        else events.push({ ...base, eventType: 'tool_result', toolName: 'Read', content: `out${k}` } as SubAgentStreamEvent);
      }
      if (!last) { ts += 1; events.push({ id: `r${k}`, subAgentId: 'S', parentAgentId: 'P', timestamp: ts, eventType: 'result', content: 'done', ...(stamp ? { turnId: `c${k}` } : {}) } as SubAgentStreamEvent); }
    }
    if (rnd() < 0.5) commands.push({ id: 'pending', text: 'later', timestamp: ts + 1, subAgentId: 'S', status: 'queued' } as QueuedCommand);
    return { events, commands };
  }

  it('builds the same last lines from a turn-bounded tail as from the whole stream', () => {
    for (const stamp of [true, false]) {
      for (let seed = 1; seed <= 40; seed += 1) {
        for (const max of [3, 10, 40]) {
          const { events, commands } = conversation(seed, 4 + (seed % 25), stamp);
          const all = studioChatTail(events, commands, Number.POSITIVE_INFINITY).lines;
          expect(studioChatTail(events, commands, max).lines).toEqual(all.slice(-max));
        }
      }
    }
  });

  it('stands lines in the order the IDE shows them — each ask, then its answers (not all asks first)', () => {
    const { events, commands } = conversation(3, 7, true);
    const ids = studioChatTail(events, commands, Number.POSITIVE_INFINITY).lines.map((l) => l.id);
    const ask = (k: number): number => ids.indexOf(`cmd-c${k}`);
    for (let k = 1; k < 7; k += 1) expect(ask(k)).toBeGreaterThan(ask(k - 1));
    // 첫 답은 첫 물음 뒤 · 둘째 물음 앞
    const firstAnswer = ids.findIndex((id) => id.startsWith('e0_'));
    expect(firstAnswer).toBeGreaterThan(ask(0));
    expect(firstAnswer).toBeLessThan(ask(1));
  });
});

describe('§5.13 (Y) 40-12 — 계측', () => {
  afterEach(() => { delete (globalThis as { __VIBI_PERF__?: boolean }).__VIBI_PERF__; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('summarizes preview waits', () => {
    expect(summarizeWaits([])).toBe('n=0');
    expect(summarizeWaits([10, 20, 30, 40, 100])).toBe('n=5 p50=30ms p95=100ms max=100ms');
  });

  it('is silent when the switch is off and writes one line per flush when on (console + main log)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.fn();
    vi.stubGlobal('window', { api: { perf: { log, memory: async () => ({ renderer: { privateKB: 2048 }, processes: [{ type: 'GPU', count: 1, workingSetKB: 4096 }] }) } } });
    const off = startStudioPerfSession();
    off.flush('play');
    await logStudioMemory('open');
    expect(warn).not.toHaveBeenCalled();
    (globalThis as { __VIBI_PERF__?: boolean }).__VIBI_PERF__ = true;
    const on = startStudioPerfSession();
    notePlayPress();
    notePlayMove();
    notePreviewWait(12);
    on.flush('play', { droppedFrames: 7 });
    on.stop();
    await logStudioMemory('open');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]![0])).toMatch(/^\[perf-studio\] play press→move=\d+ms preview-wait\(n=1 p50=12ms p95=12ms max=12ms\) dropped-footage=7 /);
    expect(String(warn.mock.calls[1]![0])).toContain('memory open audio-chunks=3.0MB');
    expect(String(warn.mock.calls[1]![0])).toContain('GPUx1=4MB');
    expect(log).toHaveBeenCalledTimes(2);
  });
});

describe('§5.13 (Y) 40-7 ② — 앱 알림 통로', () => {
  it('delivers to listeners of that app only, drops malformed payloads, and isolates a throwing listener', () => {
    const studio = vi.fn();
    const other = vi.fn();
    const broken = vi.fn(() => { throw new Error('x'); });
    const offA = onAppEvent('app-a', broken);
    const offB = onAppEvent('app-a', studio);
    const offC = onAppEvent('app-b', other);
    emitAppEvent({ appId: 'app-a', project: 'P', kind: 'doc-version', key: 'd1', version: 3 });
    emitAppEvent({ appId: 'app-a', project: 'P' });
    emitAppEvent(null);
    expect(studio).toHaveBeenCalledExactlyOnceWith({ appId: 'app-a', project: 'P', kind: 'doc-version', key: 'd1', version: 3 });
    expect(other).not.toHaveBeenCalled();
    offA(); offB(); offC();
    emitAppEvent({ appId: 'app-a', project: 'P', kind: 'activity', key: 'd1' });
    expect(studio).toHaveBeenCalledOnce();
  });
});
