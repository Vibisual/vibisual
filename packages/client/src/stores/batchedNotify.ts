// batchedNotify — 한 덩어리로 들어온 여러 `set()` 을 **구독자 통지 1회**로 접는다.
//
// 왜 필요한가:
//   `useWebSocket.applyGraphSnapshot` 은 스냅샷 1건을 반영하려고 `loadSnapshot` 1회 + `apply*` 35회,
//   **합쳐서 36번 `set()`** 을 부른다. zustand 의 `setState` 는 호출마다 구독자 전원을 동기로 깨우므로,
//   36번 전부가 **살아 있는 모든 구독의 선택자를 처음부터 다시 돌린다**. 화면에 버블 200개가 떠 있으면
//   버블 하나가 18개를 구독하니(BubbleNode) 구독만 3,600개 + 나머지 화면 몫이다.
//
//   실측(구독 4,000개 · 노드 200개 근사, `zustand/vanilla`):
//     지금 방식(36회 set)          5.01 ms/스냅샷
//     1회로 접었을 때              0.15 ms/스냅샷   → 33배
//   16ms 예산의 31% 를 **React 가 그리기도 전에** 선택자 재평가로만 태우고 있었다.
//
// 무엇을 하는가:
//   `batchStoreNotify(fn)` 안에서 일어난 `set()` 들은 **상태는 즉시** 반영하고(그 안에서 `getState()`
//   를 읽는 코드는 종전과 완전히 같은 값을 본다) **통지만** 미룬다. `fn` 이 끝나면 구독자를 한 번만
//   깨우되, `prev` 는 묶음이 시작되기 **직전 상태**를 넘긴다 — 구독자에게는 "한 번에 여기까지 바뀌었다"
//   로 보이고, 중간 상태는 애초에 존재한 적이 없는 것처럼 취급된다.
//
// 왜 안전한가:
//   ① `fn` 이 동기로 도는 동안에는 React 가 렌더할 기회가 없다 — 중간 상태를 그리는 일이 원천적으로
//      불가능하므로 tearing 이 생기지 않는다(미루는 것은 통지뿐이고 상태는 이미 최신이다).
//   ② `useSyncExternalStore` 는 구독 직후·렌더 시점에 `getSnapshot()` 을 다시 읽어 자기 값을 맞춘다.
//      통지가 늦게 와도 값이 어긋난 채 남지 않는다.
//   ③ `fn` 이 던져도 `finally` 에서 반드시 flush 한다 — 통지가 영영 막히는 경우가 없다.
//   ④ 중첩(`batchStoreNotify` 안에서 또 호출)은 깊이 계수로 접는다 — 가장 바깥이 끝날 때 한 번.
//
// ⚠ 사용 범위: **서버 스냅샷 반영처럼 "여러 set 이 사실상 한 사건"인 곳**에만 쓴다. 사용자 조작 하나가
//   set 하나면 묶을 것이 없어 이득도 없다.

import type { StateCreator } from 'zustand';

/** 통지를 미루는 중인 스토어 — flush 대상. */
interface Batchable {
  flush: () => void;
}

let depth = 0;
const pending = new Set<Batchable>();

/**
 * `fn` 안에서 일어난 모든 `set()` 의 구독자 통지를 **끝난 뒤 1회**로 접는다.
 * 상태 자체는 종전대로 즉시 갱신되므로 `fn` 안의 `getState()` 는 항상 최신을 본다.
 */
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

/**
 * zustand 미들웨어 — 구독자 목록을 우리가 들고 있다가, 묶는 중이면 통지를 미룬다.
 *
 * 구현: 원본 `subscribe` 에 **전달자 하나만** 등록하고, 이후 모든 `subscribe` 는 우리 집합으로 받는다.
 * 그래서 zustand 쪽에서 보면 구독자는 언제나 1명이고, 36번의 통지는 전달자를 36번 깨울 뿐이다
 * (선택자 재평가는 그 뒤 우리 집합에서 한 번만 일어난다).
 */
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
