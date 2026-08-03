/**
 * §5.11 v4.31 — 공용 분 시계 고정 테스트.
 *
 * 이 시계가 멈추면 `rogue-agent`(방치 감지)처럼 **시간 자체가 판정 근거인 카드**가 아무 일도 안 한다.
 * 반대로 너무 자주 깨우면 111장이 통째로 다시 계산된다. 두 실패 모두 조용히 일어나므로 여기서 못 박는다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribeMinute, getMinuteNow, resetMinuteClockForTest } from './minuteClock.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-02T10:00:00.000Z'));
  resetMinuteClockForTest();
});
afterEach(() => {
  resetMinuteClockForTest();
  vi.useRealTimers();
});

describe('공용 분 시계', () => {
  it('분 단위로 내림한 값을 준다 — 초가 흘러도 같은 분이면 같은 값', () => {
    const first = getMinuteNow();
    expect(first % 60_000).toBe(0);
    vi.setSystemTime(new Date('2026-08-02T10:00:59.999Z'));
    vi.advanceTimersByTime(0);
    expect(getMinuteNow()).toBe(first);
  });

  it('분이 바뀌면 구독자를 깨우고 값도 올라간다 — 여기가 죽으면 방치 감지가 영영 안 뜬다', () => {
    const seen: number[] = [];
    subscribeMinute(() => seen.push(getMinuteNow()));

    const before = getMinuteNow();
    vi.setSystemTime(new Date('2026-08-02T10:01:00.000Z'));
    vi.advanceTimersByTime(15_000);

    expect(seen).toHaveLength(1);
    expect(getMinuteNow()).toBe(before + 60_000);
  });

  it('같은 분 안에서는 몇 번을 돌아도 안 깨운다 — 깨우면 111장이 통째로 다시 계산된다', () => {
    const listener = vi.fn();
    subscribeMinute(listener);
    // 10:00:00 에서 15초씩 두 번 = 10:00:30. 아직 같은 분이다.
    // (`advanceTimersByTime` 은 가짜 시스템 시각도 함께 민다 — 분을 넘기지 않도록 폭을 잡는다.)
    vi.advanceTimersByTime(15_000);
    vi.advanceTimersByTime(15_000);
    expect(listener).not.toHaveBeenCalled();
  });

  it('구독자가 여럿이어도 모두 한 번씩 깨운다', () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeMinute(a);
    subscribeMinute(b);
    vi.setSystemTime(new Date('2026-08-02T10:01:00.000Z'));
    vi.advanceTimersByTime(15_000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('해지한 구독자는 안 깨우고, 남은 구독자는 계속 깨운다', () => {
    const gone = vi.fn();
    const stays = vi.fn();
    const off = subscribeMinute(gone);
    subscribeMinute(stays);
    off();
    vi.setSystemTime(new Date('2026-08-02T10:01:00.000Z'));
    vi.advanceTimersByTime(15_000);
    expect(gone).not.toHaveBeenCalled();
    expect(stays).toHaveBeenCalledTimes(1);
  });

  it('타이머는 하나만 돌고, 마지막 구독자가 빠지면 멈춘다 — 안 켰으면 시계도 안 돈다', () => {
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');

    const offA = subscribeMinute(() => {});
    const offB = subscribeMinute(() => {});
    expect(setSpy).toHaveBeenCalledTimes(1);   // 둘이 하나를 나눠 쓴다

    offA();
    expect(clearSpy).not.toHaveBeenCalled();   // 아직 남아 있다
    offB();
    expect(clearSpy).toHaveBeenCalledTimes(1);

    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
