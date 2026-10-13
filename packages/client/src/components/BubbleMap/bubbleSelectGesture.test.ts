import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createBubbleSelectGesture,
  DRAG_MOVE_THRESHOLD_PX,
  flushDeferredBubbleSelect,
  isSelectDeferred,
  SELECT_DEFER_MS,
  subscribeSelectDeferred,
  type BubbleSelectGestureOptions,
} from './bubbleSelectGesture.js';

interface Harness {
  readonly core: ReturnType<typeof createBubbleSelectGesture>;
  /** `select()` 가 몇 번 불렸나. */
  readonly selects: () => number;
  /** `setIntent()` 가 받은 값의 순서(링이 켜지고 꺼진 자취). */
  readonly intents: () => readonly boolean[];
}

/** 이 파일이 만든 코어 — 보류 수는 모듈 전역이라, 시험 하나가 남긴 보류가 다음 시험으로 새지 않게 걷는다. */
const live: Harness[] = [];

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
  const h: Harness = {
    core: createBubbleSelectGesture(() => options),
    selects: () => selects,
    intents: () => intents,
  };
  live.push(h);
  return h;
}

const at = (x: number, y: number, button = 0): { button: number; clientX: number; clientY: number } =>
  ({ button, clientX: x, clientY: y });

describe('bubbleSelectGesture', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    for (const h of live.splice(0)) h.core.dispose();
    vi.useRealTimers();
  });

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

  // 규칙 5 — 우측 패널은 왼쪽 클릭 선택에서만 뜬다(2026-10-11 사용자 지시). 종전에는 에이전트 버블만
  //   `leftButtonOnly:false` 로 우클릭도 골라, 메뉴를 열려던 손이 패널까지 열었다 — 그 스위치를 걷었다.
  it('왼쪽 버튼만 — 우클릭 누름은 선택도 링도 켜지 않는다', () => {
    const h = harness();
    h.core.pointerDown(at(10, 10, 2));
    h.core.pointerUp();

    vi.advanceTimersByTime(SELECT_DEFER_MS * 4);
    expect(h.selects()).toBe(0);
    expect(h.intents()).toEqual([]);
  });

  // 우클릭이 왼쪽 버튼으로 오는 자리(mac Control+클릭·터치 길게 누르기) — 손을 떼기 전에 contextmenu 가 온다.
  it('메뉴를 부른 왼쪽 누름은 선택이 아니다 — 훅이 contextmenu 로 누름을 접는다', () => {
    const h = harness();
    h.core.pointerDown(at(10, 10));
    h.core.pointerCancel(); // 훅의 `onContextMenuCapture` 가 부르는 자리
    h.core.pointerUp();

    vi.advanceTimersByTime(SELECT_DEFER_MS * 4);
    expect(h.selects()).toBe(0);
    expect(h.intents()).toEqual([]);

    const src = Object.values(import.meta.glob<string>(
      '/src/components/BubbleMap/bubbleSelectGesture.ts',
      { query: '?raw', import: 'default', eager: true },
    ))[0] ?? '';
    expect(src).toContain('onContextMenuCapture: () => core.pointerCancel()');
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

  it.each([false, true])('새 즉시 선택이 이전 버블의 지연 선택을 취소한다 (selectNow=%s)', (selectNow) => {
    const first = harness();
    const second = harness({ doubleClickable: false });
    first.core.pointerDown(at(10, 10));
    first.core.pointerUp();
    vi.advanceTimersByTime(100);
    if (selectNow) second.core.selectNow();
    else {
      second.core.pointerDown(at(40, 40));
      second.core.pointerUp();
    }
    expect(second.selects()).toBe(1);
    expect(isSelectDeferred()).toBe(false);
    vi.advanceTimersByTime(SELECT_DEFER_MS);
    expect(first.selects()).toBe(0);
    expect(first.intents()).toEqual([true]); // the old gesture must not extinguish the new ring
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

  describe('보류 표시(isSelectDeferred) — 선택 초점이 더블클릭 1타에 반응하지 않게', () => {
    it('단일 클릭: 링이 켜지는 순간 이미 보류 중이고, 선택이 걸린 뒤에 풀린다', () => {
      const atIntent: boolean[] = [];
      const atSelect: boolean[] = [];
      const h = harness({
        setIntent: () => { atIntent.push(isSelectDeferred()); },
        select: () => { atSelect.push(isSelectDeferred()); },
      });
      expect(isSelectDeferred()).toBe(false);
      h.core.pointerDown(at(10, 10));
      h.core.pointerUp();
      expect(atIntent).toEqual([true]);
      expect(isSelectDeferred()).toBe(true);

      vi.advanceTimersByTime(SELECT_DEFER_MS);
      expect(atSelect).toEqual([true]);
      expect(isSelectDeferred()).toBe(false);
    });

    it('더블클릭: 링이 꺼진 뒤에 보류가 풀린다', () => {
      const atIntent: boolean[] = [];
      const h = harness({ setIntent: () => { atIntent.push(isSelectDeferred()); } });
      h.core.pointerDown(at(10, 10));
      h.core.pointerUp();
      h.core.pointerDown(at(10, 10));
      expect(atIntent).toEqual([true, true]);
      expect(isSelectDeferred()).toBe(false);
    });

    it('더블클릭 동작이 없는 버블은 보류를 걸지 않는다', () => {
      const atIntent: boolean[] = [];
      const h = harness({ doubleClickable: false, setIntent: () => { atIntent.push(isSelectDeferred()); } });
      h.core.pointerDown(at(10, 10));
      h.core.pointerUp();
      expect(atIntent).toEqual([false]);
      expect(isSelectDeferred()).toBe(false);
    });

    it('드래그·selectNow·dispose 어느 길로 끝나도 보류 수가 남지 않는다', () => {
      const dragged = harness();
      dragged.core.pointerDown(at(10, 10));
      dragged.core.pointerUp();
      dragged.core.pointerDown(at(10, 10));
      dragged.core.pointerMove(at(80, 80));
      dragged.core.pointerUp();

      const now = harness();
      now.core.pointerDown(at(10, 10));
      now.core.pointerUp();
      now.core.selectNow();

      const gone = harness();
      gone.core.pointerDown(at(10, 10));
      gone.core.pointerUp();
      gone.core.dispose();
      gone.core.dispose();

      expect(isSelectDeferred()).toBe(false);
      vi.advanceTimersByTime(SELECT_DEFER_MS * 4);
      expect(isSelectDeferred()).toBe(false);
    });

    it('선택이나 링 끄기가 던져도 보류 수는 돌려놓는다', () => {
      const throwsOnSelect = harness({ select: () => { throw new Error('select'); } });
      throwsOnSelect.core.pointerDown(at(10, 10));
      throwsOnSelect.core.pointerUp();
      expect(() => vi.advanceTimersByTime(SELECT_DEFER_MS)).toThrow('select');
      expect(isSelectDeferred()).toBe(false);

      const throwsOnCancel = harness({ setIntent: (active) => { if (!active) throw new Error('intent'); } });
      throwsOnCancel.core.pointerDown(at(10, 10));
      throwsOnCancel.core.pointerUp();
      expect(() => throwsOnCancel.core.cancelPendingSelect()).toThrow('intent');
      expect(isSelectDeferred()).toBe(false);
    });

    it('다른 버블을 빠르게 고르면 최신 클릭만 확정되고 보류가 중간에 풀리지 않는다', () => {
      const first = harness();
      const second = harness();
      first.core.pointerDown(at(10, 10));
      first.core.pointerUp();
      vi.advanceTimersByTime(100);
      const deferredDuringHandoff: boolean[] = [];
      const unsubscribe = subscribeSelectDeferred(() => deferredDuringHandoff.push(isSelectDeferred()));
      second.core.pointerDown(at(40, 40));
      second.core.pointerUp();
      unsubscribe();
      expect(deferredDuringHandoff.length).toBeGreaterThan(0);
      expect(deferredDuringHandoff.every(Boolean)).toBe(true);

      vi.advanceTimersByTime(SELECT_DEFER_MS - 100);
      expect(first.selects()).toBe(0);
      expect(isSelectDeferred()).toBe(true);
      vi.advanceTimersByTime(100);
      expect(second.selects()).toBe(1);
      expect(isSelectDeferred()).toBe(false);
    });

    it('구독자는 보류가 걸리고 풀릴 때마다 불리고, 해제 뒤에는 불리지 않는다', () => {
      const listener = vi.fn();
      const unsubscribe = subscribeSelectDeferred(listener);
      const h = harness();
      h.core.pointerDown(at(10, 10));
      h.core.pointerUp();
      expect(listener).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(SELECT_DEFER_MS);
      expect(listener).toHaveBeenCalledTimes(2);

      unsubscribe();
      h.core.pointerDown(at(10, 10));
      h.core.pointerUp();
      vi.advanceTimersByTime(SELECT_DEFER_MS);
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  // §6 (2026-10-11 사용자 지시 — "보통 컨트롤 키 누르면 다중 선택하는데 정상이 아냐"). Ctrl/Cmd 클릭은 묶음에
  //   넣고 빼기다. §5.4 #31 무리 잡기와 병행 — 끌면 무리 동반 이동, 움직임 없이 떼면 넣고 빼기.
  describe('누적(다중) 선택 — Ctrl/Cmd 클릭은 묶음에 넣고 뺀다', () => {
    it('Ctrl 클릭은 고르지 않고(링·우측 패널 ❌) 기다림 없이 toggle 을 부른다', () => {
      const toggle = vi.fn();
      const h = harness({ toggle });
      h.core.pointerDown({ ...at(10, 10), ctrlKey: true });
      h.core.pointerUp();
      expect(toggle).toHaveBeenCalledTimes(1);
      expect(h.intents()).toEqual([]);
      expect(isSelectDeferred()).toBe(false);
      vi.advanceTimersByTime(SELECT_DEFER_MS * 4);
      expect(h.selects()).toBe(0);
    });

    it('mac Cmd 클릭도 같다 — 판정은 ctrlKey || metaKey', () => {
      const toggle = vi.fn();
      const h = harness({ toggle });
      h.core.pointerDown({ ...at(10, 10), metaKey: true });
      h.core.pointerUp();
      expect(toggle).toHaveBeenCalledTimes(1);
    });

    it('수식 키를 쥐고 끌면 드래그다 — 넣고 빼지 않는다(무리 동반 이동의 자리)', () => {
      const toggle = vi.fn();
      const h = harness({ toggle });
      h.core.pointerDown({ ...at(10, 10), ctrlKey: true });
      h.core.pointerMove(at(10 + DRAG_MOVE_THRESHOLD_PX + 1, 10));
      h.core.pointerUp();
      expect(toggle).not.toHaveBeenCalled();
      expect(h.selects()).toBe(0);
    });

    it('누적 손잡이가 없는 버블은 Ctrl 클릭도 보통 클릭이다', () => {
      const h = harness();
      h.core.pointerDown({ ...at(10, 10), ctrlKey: true });
      h.core.pointerUp();
      vi.advanceTimersByTime(SELECT_DEFER_MS);
      expect(h.selects()).toBe(1);
    });

    it('Shift 클릭은 캔버스가 받는다 — 누적 손잡이가 있으면 여기서는 세지 않는다(한 누름에 두 번 뒤집히지 않게)', () => {
      const toggle = vi.fn();
      const h = harness({ toggle });
      h.core.pointerDown({ ...at(10, 10), shiftKey: true });
      h.core.pointerUp();
      vi.advanceTimersByTime(SELECT_DEFER_MS * 4);
      expect(toggle).not.toHaveBeenCalled();
      expect(h.selects()).toBe(0);
      expect(h.intents()).toEqual([]);
    });

    it('앞서 누른 버블이 2타를 기다리면 그 선택을 먼저 끝내고 넣는다(누른 순서대로 쌓인다)', () => {
      const order: string[] = [];
      const first = harness({ select: () => { order.push('select:first'); } });
      const second = harness({ toggle: () => { order.push('toggle:second'); } });
      first.core.pointerDown(at(10, 10));
      first.core.pointerUp();
      vi.advanceTimersByTime(100);
      second.core.pointerDown({ ...at(40, 40), ctrlKey: true });
      second.core.pointerUp();
      expect(order).toEqual(['select:first', 'toggle:second']);
      expect(isSelectDeferred()).toBe(false);
      // 늦게 온 타이머가 방금 만든 묶음을 다시 바꾸지 않는다.
      vi.advanceTimersByTime(SELECT_DEFER_MS * 4);
      expect(order).toEqual(['select:first', 'toggle:second']);
    });

    it('기다리는 클릭이 없으면 flushDeferredBubbleSelect 는 아무것도 하지 않는다', () => {
      const h = harness();
      flushDeferredBubbleSelect();
      expect(h.selects()).toBe(0);
      expect(isSelectDeferred()).toBe(false);
    });
  });
});
