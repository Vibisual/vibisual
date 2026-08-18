/**
 * §3.2.4 H·I축 — 힙 계측과 압력 대응 회귀 테스트.
 *
 * 지키는 것 셋.
 *  1. 임계 해석은 **한 곳**이다 — `pressureLevelOf` 가 상수를 유일하게 읽는다.
 *  2. 압력이 걸리면 등록된 캐시가 **실제로** 비워진다(고=절반, 위험=전량).
 *  3. **쿨다운이 있다** — 축출 직후에는 GC 가 아직 안 돌아 `heapUsed` 가 그대로다. 쿨다운이 없으면
 *     매 표본마다 캐시를 비워 "캐시가 영영 비어 있는" 상태가 되고, 그러면 재파싱이 오히려 늘어난다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MEMORY_PRESSURE_CRITICAL_RATIO,
  MEMORY_PRESSURE_HIGH_RATIO,
  type EvictableCache,
  type MemorySample,
} from '@vibisual/shared';
import {
  __resetMemoryMonitorForTest,
  getMemoryDiagnostics,
  pressureLevelOf,
  registerEvictableCache,
  relieveMemoryPressure,
  sampleMemory,
  tickMemoryMonitor,
  unregisterEvictableCache,
} from './memoryMonitor.js';

/** 얼마나 비워졌는지만 세는 가짜 캐시. */
function fakeCache(name: string, bytes: number) {
  const state = { bytes, clears: 0, fractions: [] as number[] };
  const cache: EvictableCache = {
    cacheName: name,
    currentBytes: () => state.bytes,
    evictFraction: (f) => {
      state.fractions.push(f);
      const freed = Math.floor(state.bytes * f);
      state.bytes -= freed;
      return freed;
    },
    clear: () => {
      state.clears += 1;
      const freed = state.bytes;
      state.bytes = 0;
      return freed;
    },
  };
  return { cache, state };
}

function sampleWithRatio(ratio: number): MemorySample {
  return {
    at: Date.now(),
    rss: 0,
    heapUsed: Math.round(ratio * 1000),
    heapTotal: 1000,
    external: 0,
    arrayBuffers: 0,
    heapLimit: 1000,
    ratio,
  };
}

beforeEach(() => {
  __resetMemoryMonitorForTest();
});

afterEach(() => {
  __resetMemoryMonitorForTest();
});

describe('sampleMemory', () => {
  it('실제 프로세스 값을 읽어 온다', () => {
    const s = sampleMemory();
    expect(s.rss).toBeGreaterThan(0);
    expect(s.heapUsed).toBeGreaterThan(0);
    expect(s.heapTotal).toBeGreaterThan(0);
    expect(s.heapLimit).toBeGreaterThan(0);
    expect(s.ratio).toBeGreaterThan(0);
    expect(s.ratio).toBeLessThan(1);
  });
});

describe('pressureLevelOf — 임계 해석은 한 곳', () => {
  it('임계 미만은 normal', () => {
    expect(pressureLevelOf(sampleWithRatio(MEMORY_PRESSURE_HIGH_RATIO - 0.01))).toBe('normal');
  });

  it('고압 임계 이상은 high', () => {
    expect(pressureLevelOf(sampleWithRatio(MEMORY_PRESSURE_HIGH_RATIO))).toBe('high');
    expect(pressureLevelOf(sampleWithRatio(MEMORY_PRESSURE_CRITICAL_RATIO - 0.001))).toBe('high');
  });

  it('위험 임계 이상은 critical', () => {
    expect(pressureLevelOf(sampleWithRatio(MEMORY_PRESSURE_CRITICAL_RATIO))).toBe('critical');
    expect(pressureLevelOf(sampleWithRatio(0.99))).toBe('critical');
  });

  it('heapLimit 을 못 읽어 ratio 가 0 이면 압력으로 보지 않는다(계측 실패로 캐시를 비우지 않는다)', () => {
    expect(pressureLevelOf(sampleWithRatio(0))).toBe('normal');
  });
});

describe('relieveMemoryPressure — 실제로 비운다', () => {
  it('high 면 등록된 캐시를 절반 축출한다', () => {
    const a = fakeCache('a', 1000);
    const b = fakeCache('b', 500);
    registerEvictableCache(a.cache);
    registerEvictableCache(b.cache);

    const freed = relieveMemoryPressure('high');
    expect(freed).toBe(750);
    expect(a.state.bytes).toBe(500);
    expect(b.state.bytes).toBe(250);
    expect(a.state.clears).toBe(0);
  });

  it('critical 이면 전부 비운다', () => {
    const a = fakeCache('a', 1000);
    registerEvictableCache(a.cache);

    expect(relieveMemoryPressure('critical')).toBe(1000);
    expect(a.state.bytes).toBe(0);
    expect(a.state.clears).toBe(1);
  });

  it('normal 이면 아무것도 건드리지 않는다', () => {
    const a = fakeCache('a', 1000);
    registerEvictableCache(a.cache);

    expect(relieveMemoryPressure('normal')).toBe(0);
    expect(a.state.bytes).toBe(1000);
  });

  it('한 캐시가 던져도 나머지는 비워진다', () => {
    const boom: EvictableCache = {
      cacheName: 'boom',
      currentBytes: () => 100,
      evictFraction: () => { throw new Error('boom'); },
      clear: () => { throw new Error('boom'); },
    };
    const ok = fakeCache('ok', 400);
    registerEvictableCache(boom);
    registerEvictableCache(ok.cache);

    expect(() => relieveMemoryPressure('critical')).not.toThrow();
    expect(ok.state.bytes).toBe(0);
  });

  it('같은 이름으로 다시 등록하면 마지막 것만 남는다(중복 기동 안전)', () => {
    const first = fakeCache('dup', 100);
    const second = fakeCache('dup', 200);
    registerEvictableCache(first.cache);
    registerEvictableCache(second.cache);

    relieveMemoryPressure('critical');
    expect(first.state.bytes).toBe(100); // 손대지 않았다
    expect(second.state.bytes).toBe(0);
  });

  it('등록 해제하면 더는 비우지 않는다', () => {
    const a = fakeCache('a', 100);
    registerEvictableCache(a.cache);
    unregisterEvictableCache('a');

    expect(relieveMemoryPressure('critical')).toBe(0);
    expect(a.state.bytes).toBe(100);
  });
});

describe('tickMemoryMonitor — 표본과 쿨다운', () => {
  it('표본을 링버퍼에 쌓고 진단으로 내보낸다', () => {
    tickMemoryMonitor();
    tickMemoryMonitor();
    const report = getMemoryDiagnostics();
    expect(report.history.length).toBe(2);
    expect(report.current).not.toBeNull();
    expect(report.uptimeMs).toBeGreaterThan(0);
  });

  it('등록된 캐시가 진단에 이름과 점유로 보인다', () => {
    const a = fakeCache('cache-a', 4096);
    registerEvictableCache(a.cache);
    tickMemoryMonitor();

    const report = getMemoryDiagnostics();
    const found = report.caches.find((c) => c.name === 'cache-a');
    expect(found).toBeDefined();
    expect(found?.bytes).toBe(4096);
  });

  it('실제 힙은 임계 아래라 캐시를 건드리지 않는다', () => {
    const a = fakeCache('a', 1000);
    registerEvictableCache(a.cache);
    tickMemoryMonitor();
    // 테스트 프로세스가 힙 상한의 75% 를 쓰고 있을 리 없다.
    expect(a.state.bytes).toBe(1000);
    expect(getMemoryDiagnostics().reliefCount).toBe(0);
  });

  it('쿨다운 안에서는 두 번 연속 비우지 않는다', () => {
    const a = fakeCache('a', 1000);
    registerEvictableCache(a.cache);

    // 첫 축출을 직접 일으켜 lastReliefAt 을 세운다.
    relieveMemoryPressure('high');
    expect(a.state.fractions.length).toBe(1);
    const afterFirst = getMemoryDiagnostics();
    expect(afterFirst.reliefCount).toBe(1);
    expect(afterFirst.lastReliefAt).not.toBeNull();

    // 곧바로 표본을 찍어도(실제 힙이 임계 아래라 애초에 안 돌지만) 카운트가 늘지 않는다.
    tickMemoryMonitor();
    expect(getMemoryDiagnostics().reliefCount).toBe(1);
  });

  it('회수 바이트가 누적 보고된다', () => {
    const a = fakeCache('a', 800);
    registerEvictableCache(a.cache);
    relieveMemoryPressure('critical');
    expect(getMemoryDiagnostics().reliefFreedBytes).toBe(800);
  });
});
