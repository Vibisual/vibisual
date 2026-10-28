import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { STUDIO_PLAYBACK_UI_MS } from '@vibisual/video';

/**
 * §5.13 (X) 39-6 — 재생 머리 시계.
 * 재생 머리를 React 상태로 올리면 스튜디오 전체가 프레임마다(문서 fps 만큼) 다시 그려진다 — 프레임마다 가는 것은 이 시계뿐이고,
 * 구독하는 작은 자리(미리보기 그림·재생 머리 선·시간 글자·소리 맞춤)만 깨어난다.
 * §5.13 (Y) 40-5 — 화면 전체 상태는 재생 중 따라오지 않고 멈추거나 옮길 때만 맞춰진다(굵은 표시는 `usePlayheadSampled`, 선은 `usePlayheadTransform`).
 */
export interface PlayheadClock {
  /** 지금 재생 머리(초). */
  readonly get: () => number;
  /** 값이 바뀔 때마다 부른다(재생 중이면 프레임마다). */
  readonly subscribe: (listener: () => void) => () => void;
}

export interface WritablePlayheadClock extends PlayheadClock {
  readonly set: (t: number) => void;
}

export function createPlayheadClock(initial = 0): WritablePlayheadClock {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (t) => {
      if (t === value) return;
      value = t;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const noopSubscribe = (): (() => void) => () => undefined;

/** 시계를 읽는 작은 구독. 시계를 안 주면 받은 값을 그대로 쓴다(시험 · 시계를 모르는 호출부). */
export function usePlayheadValue(clock: PlayheadClock | undefined, fallback: number): number {
  const get = clock ? clock.get : (): number => fallback;
  return useSyncExternalStore(clock ? clock.subscribe : noopSubscribe, get, get);
}

/**
 * §5.13 (Y) 40-5 ① — 굵은 구독: 재생 중에는 `intervalMs` 마다 한 번만 깨운다(지금 장면·대본 줄·메모 핀처럼 프레임마다 바뀔 필요가 없는 표시).
 * 멈추면 마지막 값이 그 자리에서 맞춰진다(끝 값을 놓치지 않게 뒤늦은 한 번을 건다).
 */
export function usePlayheadSampled(clock: PlayheadClock | undefined, fallback: number, intervalMs: number = STUDIO_PLAYBACK_UI_MS): number {
  const [value, setValue] = useState(() => clock?.get() ?? fallback);
  useEffect(() => {
    if (!clock) return undefined;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const take = (): void => { last = performance.now(); setValue(clock.get()); };
    const onTick = (): void => {
      const now = performance.now();
      if (now - last >= intervalMs) { take(); return; }
      if (timer === null) timer = setTimeout(() => { timer = null; take(); }, Math.max(0, intervalMs - (now - last)));
    };
    take();
    const off = clock.subscribe(onTick);
    return () => { off(); if (timer !== null) clearTimeout(timer); };
  }, [clock, intervalMs]);
  return clock ? value : fallback;
}

/** §5.13 (Y) 40-5 ④ — 재생 머리 선의 가로 이동. 옮기는 판이 감싸는 판과 같은 폭이라 `%` 가 곧 그 폭의 몫이다. */
export function playheadTranslate(at: number, span: number): string {
  const share = span > 0 ? Math.max(0, Math.min(1, at / span)) : 0;
  return `translateX(${(share * 100).toFixed(4)}%)`;
}

/**
 * §5.13 (Y) 40-5 ④ — 재생 머리 선을 **렌더 없이** 옮긴다: 시계가 갈 때마다 ref 의 `style.transform` 만 바꾼다(`left: %` 레이아웃 ❌ ·
 * React 렌더 ❌ · 상속 CSS 변수에 프레임마다 쓰지 않는다). 돌려주는 값은 그릴 때의 자리(시계를 모르는 호출부는 받은 값 그대로).
 */
export function usePlayheadTransform(ref: RefObject<HTMLElement>, clock: PlayheadClock | undefined, fallback: number, span: number): string {
  useEffect(() => {
    if (!clock) return undefined;
    const apply = (): void => {
      const el = ref.current as { style?: CSSStyleDeclaration } | null;
      if (el?.style) el.style.transform = playheadTranslate(clock.get(), span);
    };
    apply();
    return clock.subscribe(apply);
  }, [clock, span, ref]);
  return playheadTranslate(clock ? clock.get() : fallback, span);
}
