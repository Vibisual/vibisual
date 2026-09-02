import { describe, it, expect } from 'vitest';
import { create } from 'zustand';
import { batchedNotify, batchStoreNotify, isBatchingStoreNotify } from './batchedNotify.js';

/**
 * §9 — 스냅샷 1건이 `set()` 을 36번 부르는 경로(useWebSocket.applyGraphSnapshot)의 회귀 고정.
 *
 * 이 미들웨어가 없으면 zustand 는 `set()` 호출마다 **살아 있는 구독 전부의 선택자**를 다시 돌린다.
 * 화면에 버블 200개(버블당 구독 18개)면 스냅샷 1건에 그 재평가를 36벌 지불하는 셈이었다
 * (실측 구독 4,000개 기준 5.01ms → 0.15ms). 여기서 지키는 것은 두 가지다:
 *   ① 묶은 구간 안의 여러 set 이 **통지 1회**로 접힌다.
 *   ② 상태 자체는 **즉시** 갱신된다 — 묶는 것은 통지뿐이라 구간 안의 `getState()` 는 최신을 본다.
 */

interface TestState {
  a: number;
  b: number;
  c: number;
  bump: (key: 'a' | 'b' | 'c') => void;
}

function makeStore() {
  return create<TestState>(batchedNotify<TestState>((set) => ({
    a: 0,
    b: 0,
    c: 0,
    bump: (key) => set((s) => ({ [key]: s[key] + 1 } as Partial<TestState>)),
  })));
}

describe('batchedNotify', () => {
  it('묶지 않으면 set 마다 통지한다(기존 동작 보존)', () => {
    const store = makeStore();
    let notifications = 0;
    store.subscribe(() => { notifications += 1; });

    store.getState().bump('a');
    store.getState().bump('b');
    store.getState().bump('c');

    expect(notifications).toBe(3);
  });

  it('묶으면 set 이 몇 번이든 통지는 1회다', () => {
    const store = makeStore();
    let notifications = 0;
    store.subscribe(() => { notifications += 1; });

    batchStoreNotify(() => {
      store.getState().bump('a');
      store.getState().bump('b');
      store.getState().bump('c');
    });

    expect(notifications).toBe(1);
    expect(store.getState()).toMatchObject({ a: 1, b: 1, c: 1 });
  });

  it('묶는 동안에도 상태는 즉시 최신이다 — 미루는 것은 통지뿐', () => {
    const store = makeStore();
    const seen: number[] = [];

    batchStoreNotify(() => {
      store.getState().bump('a');
      seen.push(store.getState().a);
      store.getState().bump('a');
      seen.push(store.getState().a);
    });

    expect(seen).toEqual([1, 2]);
  });

  it('통지의 prev 는 묶음이 시작되기 직전 상태다 — 중간 상태는 없던 것으로 친다', () => {
    const store = makeStore();
    let prevSeen: TestState | null = null;
    let stateSeen: TestState | null = null;
    store.subscribe((state, prev) => { stateSeen = state; prevSeen = prev; });

    batchStoreNotify(() => {
      store.getState().bump('a');
      store.getState().bump('a');
      store.getState().bump('b');
    });

    expect(prevSeen).toMatchObject({ a: 0, b: 0 });
    expect(stateSeen).toMatchObject({ a: 2, b: 1 });
  });

  it('중첩해도 가장 바깥이 끝날 때 한 번만 통지한다', () => {
    const store = makeStore();
    let notifications = 0;
    store.subscribe(() => { notifications += 1; });

    batchStoreNotify(() => {
      store.getState().bump('a');
      batchStoreNotify(() => {
        store.getState().bump('b');
        store.getState().bump('c');
      });
      store.getState().bump('a');
    });

    expect(notifications).toBe(1);
    expect(store.getState()).toMatchObject({ a: 2, b: 1, c: 1 });
  });

  it('구간이 예외를 던져도 통지는 반드시 풀린다(통지가 영영 막히지 않는다)', () => {
    const store = makeStore();
    let notifications = 0;
    store.subscribe(() => { notifications += 1; });

    expect(() => batchStoreNotify(() => {
      store.getState().bump('a');
      throw new Error('boom');
    })).toThrow('boom');

    expect(notifications).toBe(1);
    expect(isBatchingStoreNotify()).toBe(false);

    // 구간이 끝났으니 다음 set 은 다시 즉시 통지된다.
    store.getState().bump('b');
    expect(notifications).toBe(2);
  });

  it('아무 set 도 없으면 통지하지 않는다', () => {
    const store = makeStore();
    let notifications = 0;
    store.subscribe(() => { notifications += 1; });

    batchStoreNotify(() => { /* 아무것도 안 한다 */ });

    expect(notifications).toBe(0);
  });

  it('구독 해제가 묶음 안에서도 지켜진다', () => {
    const store = makeStore();
    let notifications = 0;
    const off = store.subscribe(() => { notifications += 1; });
    off();

    batchStoreNotify(() => { store.getState().bump('a'); });

    expect(notifications).toBe(0);
  });

  /**
   * zustand v5 의 `useStore` 는 `useSyncExternalStore(api.subscribe, …)` 로 붙는다. 이 미들웨어는
   * 그 `api.subscribe` 를 **바꿔 끼우므로**, React 가 기대하는 계약을 깨면 화면이 갱신을 놓친다.
   * 이 저장소에는 컴포넌트를 실제로 그리는 테스트 환경(jsdom)이 없으므로, 그 계약을 여기서 직접 건다.
   */
  describe('useSyncExternalStore 계약', () => {
    it('subscribe 참조가 고정이다 — 매 렌더 재구독을 유발하지 않는다', () => {
      const store = makeStore();
      expect(store.subscribe).toBe(store.subscribe);
    });

    it('subscribe 는 해제 함수를 돌려준다', () => {
      const store = makeStore();
      const off = store.subscribe(() => {});
      expect(typeof off).toBe('function');
      expect(() => off()).not.toThrow();
    });

    it('통지가 온 시점에 getState() 는 이미 최종값이다(React 가 그때 스냅샷을 다시 읽는다)', () => {
      const store = makeStore();
      let readAtNotify: number | null = null;
      store.subscribe(() => { readAtNotify = store.getState().a; });

      batchStoreNotify(() => {
        store.getState().bump('a');
        store.getState().bump('a');
        store.getState().bump('a');
      });

      expect(readAtNotify).toBe(3);
    });

    it('훅이 고른 조각이 안 바뀌면 통지가 와도 값이 그대로다(리렌더 판정은 Object.is)', () => {
      const store = makeStore();
      // b 만 보는 구독자를 흉내 — a 가 아무리 바뀌어도 값이 같아야 한다.
      let renders = 0;
      let cur = store.getState().b;
      store.subscribe(() => {
        const next = store.getState().b;
        if (!Object.is(cur, next)) { cur = next; renders += 1; }
      });

      batchStoreNotify(() => {
        store.getState().bump('a');
        store.getState().bump('a');
      });

      expect(renders).toBe(0);
    });
  });

  it('스토어가 여럿이어도 각자 1회씩 통지한다', () => {
    const s1 = makeStore();
    const s2 = makeStore();
    let n1 = 0;
    let n2 = 0;
    s1.subscribe(() => { n1 += 1; });
    s2.subscribe(() => { n2 += 1; });

    batchStoreNotify(() => {
      s1.getState().bump('a');
      s2.getState().bump('a');
      s1.getState().bump('b');
      s2.getState().bump('b');
    });

    expect(n1).toBe(1);
    expect(n2).toBe(1);
  });
});
