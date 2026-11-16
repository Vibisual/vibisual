import { useSyncExternalStore } from 'react';
import type { Point } from './imageGeometry.js';

/** 커서 좌표는 상태 막대만 본다 — 편집기 전체를 마우스 움직일 때마다 다시 그리지 않게 작은 가게로 뺀다. */
export interface CursorStore {
  get: () => Point | null;
  set: (point: Point | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createCursorStore(): CursorStore {
  let point: Point | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => point,
    set: (next) => {
      const same = next && point ? Math.round(next.x) === Math.round(point.x) && Math.round(next.y) === Math.round(point.y) : next === point;
      if (same) return;
      point = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

export function useCursorPoint(store: CursorStore): Point | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
