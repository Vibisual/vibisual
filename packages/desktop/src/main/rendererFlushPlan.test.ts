/**
 * rendererFlushPlan.test.ts — 종료 직전 렌더러 초안 flush 왕복의 회귀.
 *
 * 고정하는 것은 한 줄이다: **한 창이 답하지 않아도 종료는 상한 안에 끝나고, 답한 창의 손글씨는
 * 반드시 디스크로 간다.** 판정이 electron 에 붙어 있으면 영영 검증되지 않으므로 여기 순수 모듈로
 * 나와 있다(`chat/policy.ts` 와 같은 이유).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  collectFlushAcks,
  FLUSH_DRAFTS_REQUEST_CHANNEL,
  FLUSH_DRAFTS_DONE_CHANNEL,
  FLUSH_DRAFTS_TIMEOUT_MS,
  type FlushAckTarget,
} from './rendererFlushPlan';

/** 테스트용 가짜 IPC — 창이 언제 답할지를 직접 고른다. */
function makeBus() {
  const listeners = new Set<(senderId: number, requestId: number) => void>();
  return {
    subscribe: (onAck: (senderId: number, requestId: number) => void): (() => void) => {
      listeners.add(onAck);
      return () => { listeners.delete(onAck); };
    },
    ack: (senderId: number, requestId: number): void => {
      for (const l of [...listeners]) l(senderId, requestId);
    },
    get subscriberCount(): number { return listeners.size; },
  };
}

/** 요청을 받으면 즉시(동기로) 답하는 창. */
function autoAckTarget(id: number, bus: ReturnType<typeof makeBus>): FlushAckTarget {
  return { id, send: (requestId) => bus.ack(id, requestId) };
}

/** 요청만 받고 영영 답하지 않는 창. */
function silentTarget(id: number, seen: number[]): FlushAckTarget {
  return { id, send: (requestId) => { seen.push(requestId); } };
}

describe('collectFlushAcks — 채널·상한 상수', () => {
  it('채널 이름은 preload 리터럴과 같아야 한다(양쪽이 갈리면 답이 영영 안 온다)', () => {
    expect(FLUSH_DRAFTS_REQUEST_CHANNEL).toBe('vibisual:lifecycle:flush-drafts');
    expect(FLUSH_DRAFTS_DONE_CHANNEL).toBe('vibisual:lifecycle:flush-drafts:done');
  });

  it('기다림 상한은 종료 정리 총 상한(4초)보다 넉넉히 짧다', () => {
    expect(FLUSH_DRAFTS_TIMEOUT_MS).toBeGreaterThan(0);
    expect(FLUSH_DRAFTS_TIMEOUT_MS).toBeLessThan(4000);
  });
});

describe('collectFlushAcks — 정상 경로', () => {
  it('창이 하나도 없으면 즉시 끝난다', async () => {
    const bus = makeBus();
    const r = await collectFlushAcks({ targets: [], requestId: 1, subscribe: bus.subscribe });

    expect(r).toEqual({ requested: 0, acked: 0, failed: 0, timedOut: false });
    expect(bus.subscriberCount).toBe(0); // 규약 5 — 해제됐다
  });

  it('모든 창이 답하면 상한을 기다리지 않는다', async () => {
    const bus = makeBus();
    const r = await collectFlushAcks({
      targets: [autoAckTarget(1, bus), autoAckTarget(2, bus), autoAckTarget(3, bus)],
      requestId: 7,
      subscribe: bus.subscribe,
      setTimer: () => { throw new Error('상한 타이머가 걸리면 안 된다'); },
    });

    expect(r).toEqual({ requested: 3, acked: 3, failed: 0, timedOut: false });
    expect(bus.subscriberCount).toBe(0);
  });

  it('요청은 회차 번호를 실어 보낸다', async () => {
    const bus = makeBus();
    const seen: number[] = [];
    const t: FlushAckTarget = { id: 1, send: (rid) => { seen.push(rid); bus.ack(1, rid); } };

    await collectFlushAcks({ targets: [t], requestId: 42, subscribe: bus.subscribe });
    expect(seen).toEqual([42]);
  });
});

describe('collectFlushAcks — 종료를 막지 않는다', () => {
  it('한 창이 답하지 않아도 상한에서 나온다(규약 1)', async () => {
    vi.useFakeTimers();
    try {
      const bus = makeBus();
      const seen: number[] = [];
      const p = collectFlushAcks({
        targets: [autoAckTarget(1, bus), silentTarget(2, seen)],
        requestId: 1,
        subscribe: bus.subscribe,
        timeoutMs: 600,
      });

      await vi.advanceTimersByTimeAsync(600);
      const r = await p;

      expect(r).toEqual({ requested: 2, acked: 1, failed: 0, timedOut: true });
      expect(seen).toEqual([1]); // 침묵한 창에도 요청은 갔다
      expect(bus.subscriberCount).toBe(0); // 상한 경로에서도 해제된다
    } finally {
      vi.useRealTimers();
    }
  });

  it('이미 죽은 창(send 가 던짐)은 기다리지 않는다(규약 4)', async () => {
    const bus = makeBus();
    const dead: FlushAckTarget = { id: 9, send: () => { throw new Error('window destroyed'); } };

    const r = await collectFlushAcks({
      targets: [autoAckTarget(1, bus), dead],
      requestId: 1,
      subscribe: bus.subscribe,
      setTimer: () => { throw new Error('상한 타이머가 걸리면 안 된다'); },
    });

    expect(r).toEqual({ requested: 1, acked: 1, failed: 1, timedOut: false });
  });

  it('전부 죽었으면 즉시 끝난다', async () => {
    const bus = makeBus();
    const dead = (id: number): FlushAckTarget => ({ id, send: () => { throw new Error('gone'); } });

    const r = await collectFlushAcks({
      targets: [dead(1), dead(2)],
      requestId: 1,
      subscribe: bus.subscribe,
    });

    expect(r).toEqual({ requested: 0, acked: 0, failed: 2, timedOut: false });
    expect(bus.subscriberCount).toBe(0);
  });

  it('구독조차 못 걸면 기다리지 않는다(reject ❌)', async () => {
    const r = await collectFlushAcks({
      targets: [{ id: 1, send: () => undefined }],
      requestId: 1,
      subscribe: () => { throw new Error('ipcMain gone'); },
    });

    expect(r.timedOut).toBe(false);
    expect(r.acked).toBe(0);
  });
});

describe('collectFlushAcks — 응답 판정', () => {
  it('지난 회차의 늦은 응답은 이번 회차를 끝내지 못한다(규약 2)', async () => {
    vi.useFakeTimers();
    try {
      const bus = makeBus();
      const seen: number[] = [];
      const p = collectFlushAcks({
        targets: [silentTarget(1, seen), silentTarget(2, seen)],
        requestId: 5,
        subscribe: bus.subscribe,
        timeoutMs: 600,
      });

      // 지난 회차(4) 응답이 늦게 도착 — 세어 주면 아직 안 쓴 창을 두고 나가게 된다.
      bus.ack(1, 4);
      bus.ack(2, 4);
      await vi.advanceTimersByTimeAsync(599);

      bus.ack(1, 5); // 이번 회차 응답 하나
      await vi.advanceTimersByTimeAsync(1);
      const r = await p;

      expect(r).toEqual({ requested: 2, acked: 1, failed: 0, timedOut: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('같은 창의 중복 응답은 한 번으로 센다(규약 3)', async () => {
    vi.useFakeTimers();
    try {
      const bus = makeBus();
      const seen: number[] = [];
      const p = collectFlushAcks({
        targets: [silentTarget(1, seen), silentTarget(2, seen)],
        requestId: 1,
        subscribe: bus.subscribe,
        timeoutMs: 600,
      });

      bus.ack(1, 1);
      bus.ack(1, 1);
      bus.ack(1, 1);
      await vi.advanceTimersByTimeAsync(600);
      const r = await p;

      // 3번 답했다고 2창을 다 받은 것으로 세면, 아직 안 쓴 2번 창을 두고 나간다.
      expect(r).toEqual({ requested: 2, acked: 1, failed: 0, timedOut: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('마지막 창이 뒤늦게 답하면 그 순간 끝난다(상한까지 안 기다린다)', async () => {
    vi.useFakeTimers();
    try {
      const bus = makeBus();
      const seen: number[] = [];
      const p = collectFlushAcks({
        targets: [silentTarget(1, seen), silentTarget(2, seen)],
        requestId: 3,
        subscribe: bus.subscribe,
        timeoutMs: 600,
      });

      await vi.advanceTimersByTimeAsync(10);
      bus.ack(1, 3);
      bus.ack(2, 3);
      const r = await p;

      expect(r).toEqual({ requested: 2, acked: 2, failed: 0, timedOut: false });
      expect(bus.subscriberCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
