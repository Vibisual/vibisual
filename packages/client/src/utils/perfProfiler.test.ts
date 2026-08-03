import { describe, it, expect, vi, afterEach } from 'vitest';
import { describeTarget, perfProfiler, PERF_SESSION_MS } from './perfProfiler.js';

// SCENARIO.md §7.7 — 성능 프로파일러가 리포트를 만들다 죽던 회귀 방지.
//
// 수집 60초가 끝나는 순간 `Cannot read properties of undefined (reading 'toLowerCase')` 로
// 렌더러 에러가 났다. 원인은 Event Timing 의 `target` 을 Element 라고 믿고 `tagName.toLowerCase()`
// 를 바로 부른 것 — 실제로는 `document` 처럼 tagName 이 없는 대상이 온다. 게다가 이 예외가
// finish() 밖으로 새면서 state 가 'profiling' 에 묶여 이후 수집이 영구히 막혔다.

describe('describeTarget — 대상은 Element 라고 믿을 수 없다', () => {
  it('tagName 이 없는 대상(document 등)에서도 죽지 않는다 (그 크래시)', () => {
    expect(describeTarget({ nodeName: '#document' })).toBe('#document');
    expect(describeTarget({ nodeName: '#text' })).toBe('#text');
  });

  it('tagName 도 nodeName 도 없으면 (unknown) 으로 떨어뜨린다', () => {
    expect(describeTarget({})).toBe('(unknown)');
    expect(describeTarget({ tagName: 42, nodeName: null })).toBe('(unknown)');
  });

  it('대상이 없으면 undefined', () => {
    expect(describeTarget(null)).toBeUndefined();
    expect(describeTarget(undefined)).toBeUndefined();
    expect(describeTarget('div')).toBeUndefined();
  });

  it('진단용 data 속성이 있으면 셀렉터에 살린다', () => {
    const el = {
      tagName: 'TEXTAREA',
      hasAttribute: (a: string): boolean => a === 'data-ide-input',
      getAttribute: (): string | null => null,
    };
    expect(describeTarget(el)).toBe('textarea[data-ide-input]');
  });

  it('data 속성이 없으면 첫 클래스로, 그것도 없으면 태그명만', () => {
    const withClass = {
      tagName: 'DIV',
      hasAttribute: (): boolean => false,
      getAttribute: (n: string): string | null => (n === 'class' ? 'ide-input  flex' : null),
    };
    expect(describeTarget(withClass)).toBe('div.ide-input');

    const bare = {
      tagName: 'BUTTON',
      hasAttribute: (): boolean => false,
      getAttribute: (): string | null => null,
    };
    expect(describeTarget(bare)).toBe('button');
  });

  it('hasAttribute/getAttribute 가 없는 노드도 태그명까지는 뽑는다', () => {
    expect(describeTarget({ tagName: 'SVG' })).toBe('svg');
  });
});

/** 세션 중 PerformanceObserver 콜백을 붙잡아 원하는 엔트리를 흘려 넣는 스텁. */
interface StubbedObserver {
  type: string;
  emit: (entries: unknown[]) => void;
}

function stubPerformanceObserver(): StubbedObserver[] {
  const observers: StubbedObserver[] = [];
  class FakeObserver {
    static supportedEntryTypes = ['long-animation-frame', 'event'];
    constructor(private cb: (list: { getEntries: () => unknown[] }) => void) {}
    observe(init: { type: string }): void {
      observers.push({ type: init.type, emit: (entries) => this.cb({ getEntries: () => entries }) });
    }
    disconnect(): void {}
  }
  vi.stubGlobal('PerformanceObserver', FakeObserver);
  return observers;
}

describe('perfProfiler 세션 종료', () => {
  afterEach(() => {
    perfProfiler.cancel();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('tagName 없는 target 이 섞여도 리포트를 만들고 idle 로 돌아온다', () => {
    vi.useFakeTimers();
    const observers = stubPerformanceObserver();
    perfProfiler.forceStart(30, () => ({
      nodes: 1,
      edges: 0,
      agents: 1,
      activeEdges: 0,
      domNodes: 10,
      view: 'ide',
    }));

    const events = observers.filter((o) => o.type === 'event');
    expect(events.length).toBeGreaterThan(0);
    events[0]?.emit([
      {
        name: 'keydown',
        startTime: 100,
        duration: 240,
        processingStart: 120,
        processingEnd: 300,
        interactionId: 7,
        target: { nodeName: '#document' }, // ← 종전에 여기서 TypeError
      },
    ]);

    vi.advanceTimersByTime(PERF_SESSION_MS);

    expect(perfProfiler.getState()).toBe('idle');
    const report = perfProfiler.getReport();
    expect(report?.interactions.worst[0]?.target).toBe('#document');
    expect(report?.interactions.worstMs).toBe(240);
  });

  it('리포트 생성이 실패해도 profiling 에 묶이지 않는다', () => {
    vi.useFakeTimers();
    const observers = stubPerformanceObserver();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    perfProfiler.forceStart(30, () => ({
      nodes: 0,
      edges: 0,
      agents: 0,
      activeEdges: 0,
      domNodes: 0,
      view: 'canvas',
    }));

    // duration getter 가 던지는 악성 엔트리 — 집계 도중 예외를 강제한다.
    const poisoned = {
      name: 'keydown',
      startTime: 0,
      processingStart: 0,
      processingEnd: 0,
      get duration(): number {
        throw new Error('boom');
      },
    };
    observers.find((o) => o.type === 'event')?.emit([poisoned]);

    vi.advanceTimersByTime(PERF_SESSION_MS);

    expect(perfProfiler.getState()).toBe('idle');
    expect(errorSpy).toHaveBeenCalledWith('[perfProfiler] 성능 리포트 생성 실패', expect.any(Error));
    errorSpy.mockRestore();
  });
});
