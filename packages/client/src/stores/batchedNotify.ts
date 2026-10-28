// batchedNotify — 여러 `set()` 을 구독자 통지 1회로 접는다. 스냅샷 1건이 `set()` 36번이고 zustand 는 호출마다 모든 선택자를 다시 돌린다
// (실측 구독 4,000개·노드 200개: 5.01ms → 0.15ms/스냅샷). 상태는 즉시 반영하고 통지만 미루며, `prev` 는 묶음 직전 상태다.
// 안전한 이유: `fn` 이 동기라 중간 상태를 그릴 틈이 없다 · `useSyncExternalStore` 가 렌더 때 다시 읽는다 · `finally` 에서 flush · 중첩은 깊이로 접는다.
// ⚠ "여러 set 이 사실상 한 사건"인 곳(서버 스냅샷 반영)에만 쓴다.

import type { StateCreator } from 'zustand';

/** 통지를 미루는 중인 스토어 — flush 대상. */
interface Batchable {
  flush: () => void;
}

let depth = 0;
const pending = new Set<Batchable>();

/** 통지만 끝난 뒤 1회로 접는다 — 상태는 즉시 갱신되므로 `fn` 안의 `getState()` 는 최신이다. */
export function batchStoreNotify<R>(fn: () => R): R {
  depth += 1;
  try {
    return fn();
  } finally {
    depth -= 1;
    if (depth === 0 && pending.size > 0) {
      // flush 중에 다시 set 이 일어날 수 있으므로(구독자가 파생 상태를 쓰는 경우) 목록을 먼저 비운다.
      const targets = [...pending];
      pending.clear();
      for (const t of targets) t.flush();
    }
  }
}

/** 지금 묶는 중인가 — 테스트/진단용. */
export function isBatchingStoreNotify(): boolean {
  return depth > 0;
}

type Listener<T> = (state: T, prev: T) => void;

/** 원본 `subscribe` 에는 전달자 하나만 등록하고 구독자 목록은 우리가 든다 — 묶는 중이면 통지를 미뤄 재평가가 한 번만 일어난다. */
export function batchedNotify<T>(config: StateCreator<T, [], []>): StateCreator<T, [], []> {
  return (set, get, api) => {
    const listeners = new Set<Listener<T>>();
    let held: { prev: T } | null = null;

    const self: Batchable = {
      flush: () => {
        const h = held;
        held = null;
        if (!h) return;
        const state = api.getState();
        if (Object.is(state, h.prev)) return;
        for (const l of [...listeners]) l(state, h.prev);
      },
    };

    api.subscribe((state, prev) => {
      if (depth > 0) {
        // 묶는 중 — 첫 prev 만 기억해 두고(중간 상태는 없던 것으로 친다) 통지는 미룬다.
        if (!held) held = { prev };
        pending.add(self);
        return;
      }
      for (const l of [...listeners]) l(state, prev);
    });

    api.subscribe = ((listener: Listener<T>) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }) as typeof api.subscribe;

    return config(set, get, api);
  };
}
