import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { compositionRuntimeScript } from './runtime.js';

/**
 * §5.13 (Z) 41-1·41-2 — 런타임 심: 부모 창이 건넨 포트로 요청·답이 오가고(창 메시지 = 앱 본체를 거치는 길 ❌), `play` 를 받으면
 * 자기 진짜 프레임마다 에포크 시계로 제 시각을 계산해 맞춘다(문서 프레임 격자 · min~until 안). 창 없이 vm 문맥에서 돌린다.
 */

type Msg = Record<string, unknown>;

class FakePort {
  readonly sent: Msg[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  closed = false;
  postMessage(message: unknown): void { this.sent.push(JSON.parse(JSON.stringify(message)) as Msg); }
  close(): void { this.closed = true; }
}

const ORIGIN = 1_700_000_000_000;

function boot() {
  const parentMessages: Msg[] = [];
  const listeners = new Map<string, Array<(e: unknown) => void>>();
  const frames: Array<(t: number) => void> = [];
  const clock = { now: 0 };
  const parent = { postMessage: (m: unknown) => parentMessages.push(JSON.parse(JSON.stringify(m)) as Msg) };
  const sandbox: Record<string, unknown> = {
    parent,
    performance: { now: () => clock.now, timeOrigin: ORIGIN },
    requestAnimationFrame: (cb: (t: number) => void) => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: () => undefined,
    setTimeout,
    clearTimeout,
    addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    document: { readyState: 'complete', images: [], addEventListener: () => undefined, getAnimations: () => [], querySelector: () => null, querySelectorAll: () => [] },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext('var window = globalThis;', ctx);
  vm.runInContext(compositionRuntimeScript({ props: {}, seed: 1, itemId: 'c', fps: 30, duration: 10, width: 100, height: 100 }), ctx);
  vm.runInContext('var seen = []; window.__vibi.seek = function (t) { seen.push(t); };', ctx);
  const dispatch = (event: unknown): void => {
    for (const fn of listeners.get('message') ?? []) fn(event);
  };
  const fromParent = (data: unknown, ports?: unknown[]): void => dispatch({ source: parent, data, ports: ports ?? [] });
  /** 진짜 프레임 하나 — 쌓인 rAF 를 부르고 약속들을 흘린다. */
  const frame = async (advanceMs: number): Promise<void> => {
    clock.now += advanceMs;
    const due = frames.splice(0);
    for (const cb of due) cb(clock.now);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  const seen = (): number[] => JSON.parse(vm.runInContext('JSON.stringify(seen)', ctx) as string) as number[];
  return { parentMessages, fromParent, dispatch, frame, seen, clock };
}

describe('§5.13 (Z) 41-1 런타임의 직통 채널', () => {
  it('부모 창이 건넨 포트를 받으면 그 뒤 답은 포트로만 간다', async () => {
    const b = boot();
    const port = new FakePort();
    b.fromParent({ __vibi: 'port' }, [port]);
    expect(typeof port.onmessage).toBe('function');
    port.onmessage!({ data: { __vibi: 'seek', t: 1, seq: 7, preview: true } });
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(port.sent).toContainEqual({ __vibi: 'ready', seq: 7, t: 1, mode: 'random' });
    expect(b.parentMessages.some((m) => m.__vibi === 'ready')).toBe(false);
  });

  it('부모가 아닌 곳에서 온 포트는 받지 않는다(답도 계속 부모 창으로 간다)', async () => {
    const b = boot();
    const port = new FakePort();
    b.dispatch({ source: {}, data: { __vibi: 'port' }, ports: [port] });
    expect(port.onmessage).toBeNull();
    b.fromParent({ __vibi: 'seek', t: 0.5, seq: 2, preview: true });
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(b.parentMessages).toContainEqual({ __vibi: 'ready', seq: 2, t: 0.5, mode: 'random' });
    expect(port.sent).toHaveLength(0);
  });
});

describe('§5.13 (Z) 41-2 스스로 재생', () => {
  it('기준식대로 제 프레임마다 시각을 계산하고(문서 격자 위), 첫 장을 한 번 알린다', async () => {
    const b = boot();
    const port = new FakePort();
    b.fromParent({ __vibi: 'port' }, [port]);
    // 에포크 ORIGIN+0 에 시각 2.0초, 격자는 0(아이템 시작 = 트림), 4초까지.
    port.onmessage!({ data: { __vibi: 'play', base: 2, anchor: ORIGIN, min: 0, until: 4, grid: 0, fps: 30 } });
    await b.frame(0); // 2.000초 → 격자 60
    await b.frame(110); // 2.110초 → 격자 63
    await b.frame(10); // 2.120초 → 아직 63 — 같은 프레임은 다시 맞추지 않는다
    await b.frame(20); // 2.140초 → 64
    await b.frame(30); // 2.170초 → 65
    const seen = b.seen();
    expect(seen).toHaveLength(4);
    [60, 63, 64, 65].forEach((g, i) => expect(seen[i]).toBeCloseTo(g / 30, 9));
    expect(port.sent.filter((m) => m.__vibi === 'played')).toHaveLength(1);
  });

  it('격자는 아이템 시작 − 트림 — 무대가 프레임마다 청했을 바로 그 시각이다', async () => {
    const b = boot();
    const port = new FakePort();
    b.fromParent({ __vibi: 'port' }, [port]);
    // 아이템이 문서 0.51초에 시작, 트림 0 → 격자 0.51 → 문서 프레임 k/30 에서 컴포지션 시각 k/30 − 0.51.
    port.onmessage!({ data: { __vibi: 'play', base: 0.2, anchor: ORIGIN, min: 0, until: 2, grid: 0.51, fps: 30 } });
    await b.frame(0);
    const t = b.seen()[0]!;
    // 0.2 + 0.51 = 0.71 → 격자 floor(0.71·30)=21 → 0.7 − 0.51 = 0.19
    expect(t).toBeCloseTo(0.7 - 0.51, 9);
  });

  it('시작 전에는 첫 장(min)에, 끝에서는 마지막 장(until 앞)에 머문다', async () => {
    const b = boot();
    const port = new FakePort();
    b.fromParent({ __vibi: 'port' }, [port]);
    port.onmessage!({ data: { __vibi: 'play', base: -1, anchor: ORIGIN, min: 0, until: 1, grid: 0, fps: 30 } });
    await b.frame(0);
    expect(b.seen()).toEqual([0]);
    await b.frame(2500); // 1.5초 → until(1) 넘음 → 마지막 장 29/30
    expect(b.seen().at(-1)).toBeCloseTo(29 / 30, 9);
  });

  it('pause 는 멈춘 시각을 답하고, 그 뒤 프레임이 와도 더 맞추지 않는다 · seek 도 스스로 재생을 세운다', async () => {
    const b = boot();
    const port = new FakePort();
    b.fromParent({ __vibi: 'port' }, [port]);
    port.onmessage!({ data: { __vibi: 'play', base: 1, anchor: ORIGIN, min: 0, until: 5, grid: 0, fps: 30 } });
    await b.frame(0);
    port.onmessage!({ data: { __vibi: 'pause', seq: 3 } });
    await b.frame(0);
    expect(port.sent).toContainEqual({ __vibi: 'paused', seq: 3, t: 1 });
    const before = b.seen().length;
    await b.frame(500);
    expect(b.seen()).toHaveLength(before);
    port.onmessage!({ data: { __vibi: 'play', base: 1, anchor: ORIGIN + 500, min: 0, until: 5, grid: 0, fps: 30 } });
    await b.frame(0);
    port.onmessage!({ data: { __vibi: 'seek', t: 3, seq: 9 } });
    await b.frame(100);
    await b.frame(100);
    expect(b.seen().at(-1)).toBe(3);
  });
});
