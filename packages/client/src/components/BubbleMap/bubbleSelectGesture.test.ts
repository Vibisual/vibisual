import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createBubbleSelectGesture,
  DRAG_MOVE_THRESHOLD_PX,
  SELECT_DEFER_MS,
  type BubbleSelectGestureOptions,
} from './bubbleSelectGesture.js';

interface Harness {
  readonly core: ReturnType<typeof createBubbleSelectGesture>;
  /** `select()` 가 몇 번 불렸나. */
  readonly selects: () => number;
  /** `setIntent()` 가 받은 값의 순서(링이 켜지고 꺼진 자취). */
  readonly intents: () => readonly boolean[];
}

/** 기본 옵션 + 호출 기록. `patch` 로 필요한 것만 바꾼다. */
function harness(patch: Partial<BubbleSelectGestureOptions> = {}): Harness {
  let selects = 0;
  const intents: boolean[] = [];
  const options: BubbleSelectGestureOptions = {
    doubleClickable: true,
    select: () => { selects += 1; },
    setIntent: (active) => { intents.push(active); },
    ...patch,
  };
  return {
    core: createBubbleSelectGesture(() => options),
    selects: () => selects,
    intents: () => intents,
  };
}

const at = (x: number, y: number, button = 0): { button: number; clientX: number; clientY: number } =>
  ({ button, clientX: x, clientY: y });

describe('bubbleSelectGesture', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('단일 클릭 — 링은 즉시, 실제 선택은 SELECT_DEFER_MS 뒤', () => {
    const h = harness();
    h.core.pointerDown(at(10, 10));
    h.core.pointerUp();

    // 링은 손 뗀 그 순간에 켜진다(패널만 미룬다).
    expect(h.intents()).toEqual([true]);
    expect(h.selects()).toBe(0);

    vi.advanceTimersByTime(SELECT_DEFER_MS - 1);
    expect(h.selects()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(h.selects()).toBe(1);
  });

  it('더블 클릭 — 선택이 아예 일어나지 않고 링도 꺼진다', () => {
    const h = harness();
    // 1타
    h.core.pointerDown(at(10, 10));
    h.core.pointerUp();
    expect(h.intents()).toEqual([true]);

    // 2타 — 지연 창 안에서 다시 누름
    vi.advanceTimersByTime(80);
    h.core.pointerDown(at(10, 10));
    expect(h.intents()).toEqual([true, false]);
    h.core.pointerUp();          // 2타의 뗌은 선택으로 잇지 않는다
    h.core.cancelPendingSelect(); // onDoubleClick 이 부르는 자리

    vi.advanceTimersByTime(SELECT_DEFER_MS * 4);
    expect(h.selects()).toBe(0);
  });

  it('더블클릭 동작이 없는 버블은 지연 없이 바로 선택된다', () => {
    const h = harness({ doubleClickable: false });
    h.core.pointerDown(at(10, 10));
    h.core.pointerUp();
    expect(h.selects()).toBe(1);
    expect(h.intents()).toEqual([true]);
  });

  it('임계 이상 끌면 드래그 — 선택도 링도 없다', () => {
    const h = harness();
    h.core.pointerDown(at(10, 10));
    h.core.pointerMove(at(10 + DRAG_MOVE_THRESHOLD_PX + 1, 10));
    h.core.pointerUp();

    vi.advanceTimersByTime(SELECT_DEFER_MS * 4);
    expect(h.selects()).toBe(0);
    expect(h.intents()).toEqual([]);
  });

  it('임계 이하 흔들림은 여전히 클릭이다', () => {
    const h = harness();
    h.core.pointerDown(at(10, 10));
    h.core.pointerMove(at(10 + DRAG_MOVE_THRESHOLD_PX, 10));
    h.core.pointerUp();

    vi.advanceTimersByTime(SELECT_DEFER_MS);
    expect(h.selects()).toBe(1);
  });

  it('클릭 → 드래그 순서에서도 보류가 접힌다(2타가 드래그로 이어지는 경우)', () => {
    const h = harness();
    h.core.pointerDown(at(10, 10));
    h.core.pointerUp();               // 1타 → 보류 시작
    h.core.pointerDown(at(10, 10));   // 2타 → 보류 접힘
    h.core.pointerMove(at(80, 80));   // 그대로 끌고 감
    h.core.pointerUp();

    vi.advanceTimersByTime(SELECT_DEFER_MS * 4);
    expect(h.selects()).toBe(0);
  });

  it('ignore 가 true 면 그 누름은 선택 경로를 타지 않는다', () => {
    const h = harness({ ignore: () => true });
    h.core.pointerDown(at(10, 10));
    h.core.pointerUp();

    vi.advanceTimersByTime(SELECT_DEFER_MS * 4);
    expect(h.selects()).toBe(0);
    expect(h.intents()).toEqual([]);
  });

  it('기본은 왼쪽 버튼만 — 우클릭 누름은 선택으로 치지 않는다', () => {
    const h = harness();
    h.core.pointerDown(at(10, 10, 2));
    h.core.pointerUp();

    vi.advanceTimersByTime(SELECT_DEFER_MS * 4);
    expect(h.selects()).toBe(0);
  });

  it('leftButtonOnly:false 면 우클릭도 선택으로 친다(에이전트 버블의 손버릇)', () => {
    const h = harness({ leftButtonOnly: false });
    h.core.pointerDown(at(10, 10, 2));
    h.core.pointerUp();

    vi.advanceTimersByTime(SELECT_DEFER_MS);
    expect(h.selects()).toBe(1);
  });

  it('selectNow 는 지연 없이 고르고, 보류가 있었다면 대신 접는다(우클릭 메뉴)', () => {
    const h = harness();
    h.core.pointerDown(at(10, 10));
    h.core.pointerUp();               // 보류 시작
    h.core.selectNow();
    expect(h.selects()).toBe(1);

    // 보류가 남아 두 번 선택되면 안 된다.
    vi.advanceTimersByTime(SELECT_DEFER_MS * 4);
    expect(h.selects()).toBe(1);
  });

  it('pointerCancel 이후의 뗌은 클릭이 아니다', () => {
    const h = harness();
    h.core.pointerDown(at(10, 10));
    h.core.pointerCancel();
    h.core.pointerUp();

    vi.advanceTimersByTime(SELECT_DEFER_MS * 4);
    expect(h.selects()).toBe(0);
  });

  it('dispose 는 보류 중 선택을 남기지 않는다(언마운트)', () => {
    const h = harness();
    h.core.pointerDown(at(10, 10));
    h.core.pointerUp();
    h.core.dispose();

    vi.advanceTimersByTime(SELECT_DEFER_MS * 4);
    expect(h.selects()).toBe(0);
  });

  it('연속 단일 클릭 두 번은 각각 선택된다(지연 창을 넘긴 경우)', () => {
    const h = harness();
    h.core.pointerDown(at(10, 10));
    h.core.pointerUp();
    vi.advanceTimersByTime(SELECT_DEFER_MS);
    expect(h.selects()).toBe(1);

    h.core.pointerDown(at(10, 10));
    h.core.pointerUp();
    vi.advanceTimersByTime(SELECT_DEFER_MS);
    expect(h.selects()).toBe(2);
  });
});
