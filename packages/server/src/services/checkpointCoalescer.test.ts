/**
 * checkpointCoalescer.test.ts — §9 v3.45 체크포인트 창 + §3.2.1 종료 flush 회귀.
 *
 * 이 파일이 고정하는 것은 **"정상 종료 시 마지막 창을 잃지 않는다"** 한 줄이다.
 * 종전에는 그 마무리가 `process.on('exit')` 한 곳에만 있었는데, Electron 의 종료 경로는
 * `app.exit(0)` 으로 끝나 그 이벤트가 돌지 않을 수 있었다 — `before-quit` 가 부르는
 * `flushPendingCheckpointSave()` 가 그 자리를 메운다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CheckpointCoalescer,
  setActiveCheckpointCoalescer,
  flushPendingCheckpointSave,
  hasPendingCheckpointSave,
} from './checkpointCoalescer.js';

const BASE = 500;
const MAX = 5000;
const FACTOR = 4;

function makeCoalescer(save: (opts?: { dirtyOnly?: boolean }) => void, now?: () => number) {
  return new CheckpointCoalescer({
    save,
    baseIntervalMs: BASE,
    maxIntervalMs: MAX,
    backoffFactor: FACTOR,
    ...(now ? { now } : {}),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  setActiveCheckpointCoalescer(null);
});

describe('CheckpointCoalescer — 창 예약', () => {
  it('예약은 창이 끝난 뒤 한 번만 저장한다(trailing)', () => {
    const save = vi.fn();
    const c = makeCoalescer(save);

    c.schedule();
    c.schedule();
    c.schedule();
    expect(save).not.toHaveBeenCalled();
    expect(c.pending).toBe(true);

    vi.advanceTimersByTime(BASE);
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.pending).toBe(false);
  });

  it('예약 발화는 dirtyOnly 로 좁힌다(훅 경로 한정 — §9)', () => {
    const save = vi.fn();
    const c = makeCoalescer(save);

    c.schedule();
    vi.advanceTimersByTime(BASE);

    expect(save).toHaveBeenCalledWith({ dirtyOnly: true });
  });

  it('저장 비용에 따라 다음 창이 늘고 상한에서 멎는다(부하 적응형)', () => {
    let clock = 0;
    const save = vi.fn(() => { clock += 300; }); // 저장 1회 300ms
    const c = makeCoalescer(save, () => clock);

    expect(c.nextDelayMs).toBe(BASE);
    c.schedule();
    vi.advanceTimersByTime(BASE);
    expect(c.nextDelayMs).toBe(300 * FACTOR); // 1200ms

    // 아주 비싼 저장도 상한을 넘지 않는다.
    save.mockImplementation(() => { clock += 100_000; });
    c.schedule();
    vi.advanceTimersByTime(c.nextDelayMs);
    expect(c.nextDelayMs).toBe(MAX);
  });

  it('예약 발화 중 예외가 나도 창 상태가 망가지지 않는다', () => {
    const onError = vi.fn();
    const c = new CheckpointCoalescer({
      save: () => { throw new Error('disk full'); },
      baseIntervalMs: BASE,
      maxIntervalMs: MAX,
      backoffFactor: FACTOR,
      onError,
    });

    c.schedule();
    expect(() => vi.advanceTimersByTime(BASE)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'scheduled');
    expect(c.pending).toBe(false);

    // 다음 예약이 정상적으로 다시 걸린다.
    c.schedule();
    expect(c.pending).toBe(true);
  });
});

describe('CheckpointCoalescer — 종료 flush', () => {
  it('예약이 걸린 채 종료하면 전 프로젝트 전량으로 저장한다(dirtyOnly ❌)', () => {
    const save = vi.fn();
    const c = makeCoalescer(save);

    c.schedule();
    expect(c.flushSync()).toBe(true);

    expect(save).toHaveBeenCalledTimes(1);
    // 규약 1 — 종료 flush 는 변경 판정을 타지 않는다.
    expect(save).toHaveBeenCalledWith();
    expect(c.pending).toBe(false);
  });

  it('flush 뒤에는 예약된 타이머가 다시 발화하지 않는다(중복 저장 ❌)', () => {
    const save = vi.fn();
    const c = makeCoalescer(save);

    c.schedule();
    c.flushSync();
    vi.advanceTimersByTime(MAX * 2);

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('예약이 없으면 저장하지 않는다(매 종료 전량 저장 ❌ — 규약 2)', () => {
    const save = vi.fn();
    const c = makeCoalescer(save);

    expect(c.flushSync()).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('두 번 불려도 두 번 저장하지 않는다(before-quit + process exit 겹침)', () => {
    const save = vi.fn();
    const c = makeCoalescer(save);

    c.schedule();
    expect(c.flushSync()).toBe(true);
    expect(c.flushSync()).toBe(false);

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('종료 저장이 실패해도 던지지 않는다(정리 경로를 끊지 않는다 — 규약 4)', () => {
    const onError = vi.fn();
    const c = new CheckpointCoalescer({
      save: () => { throw new Error('disk full'); },
      baseIntervalMs: BASE,
      maxIntervalMs: MAX,
      backoffFactor: FACTOR,
      onError,
    });

    c.schedule();
    expect(() => c.flushSync()).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'flush');
  });

  it('cancel 은 저장 없이 창만 버린다', () => {
    const save = vi.fn();
    const c = makeCoalescer(save);

    c.schedule();
    c.cancel();
    vi.advanceTimersByTime(MAX * 2);

    expect(save).not.toHaveBeenCalled();
    expect(c.pending).toBe(false);
  });
});

describe('flushPendingCheckpointSave — 종료 경로 단일 창구', () => {
  it('서버가 아직 안 떴으면 조용히 false (종료를 막지 않는다)', () => {
    setActiveCheckpointCoalescer(null);
    expect(flushPendingCheckpointSave()).toBe(false);
    expect(hasPendingCheckpointSave()).toBe(false);
  });

  it('등록된 코얼레서의 예약분을 마무리한다', () => {
    const save = vi.fn();
    const c = makeCoalescer(save);
    setActiveCheckpointCoalescer(c);

    c.schedule();
    expect(hasPendingCheckpointSave()).toBe(true);

    expect(flushPendingCheckpointSave()).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith();
    expect(hasPendingCheckpointSave()).toBe(false);
  });

  it('해제하면 옛 코얼레서를 더는 건드리지 않는다(재기동 안전)', () => {
    const save = vi.fn();
    const c = makeCoalescer(save);
    setActiveCheckpointCoalescer(c);
    c.schedule();

    setActiveCheckpointCoalescer(null);
    expect(flushPendingCheckpointSave()).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});
