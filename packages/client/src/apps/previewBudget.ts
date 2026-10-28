import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { PREVIEW_POLICY, selectPreviewGrants, type PreviewCandidate } from '@vibisual/shared';

/**
 * §5.1 #2-1 (G) ②③④ — 화면 속 미리보기 상한. 마운트된 자리가 이름을 올리고(`usePreviewGrant` — 화면 밖 노드는 언마운트라 올라온 것 = 보이는 것)
 * shared `selectPreviewGrants` 가 고른다(문턱 아래 지름은 아이콘, 크게 보이는 것부터 상한까지). 움직이는 동안은 고른 것을 바꾸지 않고(줌 경계 깜빡임 ❌)
 * `appThumbnails` 는 `isIdle()` 일 때만 새로 굽는다. 앱 노드 화면은 상한 밖이다(그 노드의 결과 자체) — 이름을 올리지 않는다.
 */

type Listener = () => void;

interface Entry {
  diameter: number;
  active: boolean;
  last: number;
  /** 구슬처럼 작은 자리는 제 크기에 맞춘 문턱을 쓴다. */
  small: boolean;
  readonly listeners: Set<Listener>;
}

const NO_GRANTS: ReadonlySet<string> = new Set();

export interface PreviewBudget {
  /** 자리를 올리거나 크기·상태를 고친다. */
  upsert(id: string, diameter: number, opts?: { active?: boolean; last?: number; small?: boolean }): void;
  remove(id: string): void;
  subscribe(id: string, listener: Listener): () => void;
  isGranted(id: string): boolean;
  /** 캔버스 이동·줌이 시작/끝났다(끝날 때 그 줌으로 다시 고른다). */
  setMoving(moving: boolean, zoom?: number): void;
  setZoom(zoom: number): void;
  /** 새 일감을 시작해도 되는가 — 멈춘 지 `idleAfterMotionMs` 가 지났다. */
  isIdle(now?: number): boolean;
  /** 다시 한가해지면 한 번 부른다(기억 장소가 미뤄 둔 줄을 다시 민다). */
  onIdle(listener: Listener): () => void;
  /** 시험용 — 지금 고른 것. */
  granted(): ReadonlySet<string>;
}

export function createPreviewBudget(opts: {
  readonly now?: () => number;
  readonly schedule?: (fn: () => void) => void;
  readonly later?: (fn: () => void, ms: number) => void;
} = {}): PreviewBudget {
  const now = opts.now ?? (() => Date.now());
  const schedule = opts.schedule ?? ((fn: () => void) => { queueMicrotask(fn); });
  const later = opts.later ?? ((fn: () => void, ms: number) => { setTimeout(fn, ms); });
  const entries = new Map<string, Entry>();
  const idleListeners = new Set<Listener>();
  let granted: ReadonlySet<string> = NO_GRANTS;
  let zoom = 1;
  let moving = false;
  let lastMotionAt = Number.NEGATIVE_INFINITY;
  let pending = false;

  const recompute = (): void => {
    pending = false;
    if (moving) return;
    const big: PreviewCandidate[] = [];
    const small: PreviewCandidate[] = [];
    for (const [id, e] of entries) (e.small ? small : big).push({ id, diameter: e.diameter, active: e.active, last: e.last });
    const nextBig = selectPreviewGrants(big, zoom, granted);
    // 구슬은 같은 상한(한눈 기준)을 나눠 쓰되, 문턱은 제 크기에 맞춘다(22px 구슬은 28px 문턱을 넘을 수 없다).
    const left = Math.max(0, PREVIEW_POLICY.maxOnScreen - nextBig.size);
    const nextSmall = selectPreviewGrants(small, zoom, granted, {
      minScreenPx: PREVIEW_POLICY.beadMinScreenPx,
      showScreenPx: PREVIEW_POLICY.beadShowScreenPx,
      maxOnScreen: left,
    });
    const next = new Set([...nextBig, ...nextSmall]);
    const changed: string[] = [];
    for (const id of next) if (!granted.has(id)) changed.push(id);
    for (const id of granted) if (!next.has(id)) changed.push(id);
    granted = next.size === 0 ? NO_GRANTS : next;
    for (const id of changed) for (const l of [...(entries.get(id)?.listeners ?? [])]) l();
  };
  const request = (): void => {
    if (pending) return;
    pending = true;
    schedule(recompute);
  };

  return {
    upsert(id, diameter, o = {}) {
      const d = Number.isFinite(diameter) && diameter > 0 ? diameter : 0;
      const prev = entries.get(id);
      if (prev && prev.diameter === d && prev.active === (o.active ?? false) && prev.last === (o.last ?? 0)
        && prev.small === (o.small ?? false)) return;
      if (prev) {
        prev.diameter = d;
        prev.active = o.active ?? false;
        prev.last = o.last ?? 0;
        prev.small = o.small ?? false;
      } else {
        entries.set(id, { diameter: d, active: o.active ?? false, last: o.last ?? 0, small: o.small ?? false, listeners: new Set() });
      }
      request();
    },
    remove(id) {
      if (!entries.delete(id)) return;
      request();
    },
    subscribe(id, listener) {
      let e = entries.get(id);
      if (!e) {
        e = { diameter: 0, active: false, last: 0, small: false, listeners: new Set() };
        entries.set(id, e);
      }
      e.listeners.add(listener);
      return () => { entries.get(id)?.listeners.delete(listener); };
    },
    isGranted(id) {
      return granted.has(id);
    },
    setMoving(next, z) {
      if (typeof z === 'number' && Number.isFinite(z) && z > 0) zoom = z;
      if (next) {
        moving = true;
        return;
      }
      moving = false;
      lastMotionAt = now();
      request();
      later(() => {
        if (!moving && now() - lastMotionAt >= PREVIEW_POLICY.idleAfterMotionMs) {
          for (const l of [...idleListeners]) l();
        }
      }, PREVIEW_POLICY.idleAfterMotionMs);
    },
    setZoom(z) {
      if (!Number.isFinite(z) || z <= 0 || z === zoom) return;
      zoom = z;
      if (!moving) request();
    },
    isIdle(t = now()) {
      return !moving && t - lastMotionAt >= PREVIEW_POLICY.idleAfterMotionMs;
    },
    onIdle(listener) {
      idleListeners.add(listener);
      return () => { idleListeners.delete(listener); };
    },
    granted() {
      return granted;
    },
  };
}

/** 메인 캔버스의 한 벌 — 캔버스는 하나다(별창은 제 창의 모듈을 쓴다). */
export const previewBudget = createPreviewBudget();

/**
 * 이 자리에 미리보기를 그려도 되는가. `id` 가 `null` 이면(굽지 않는 자리) 늘 `false` 다.
 * 마운트된 동안만 이름을 올리고, 지름·상태가 바뀌면 고친다.
 */
export function usePreviewGrant(
  id: string | null,
  diameter: number,
  opts: { active?: boolean; last?: number; small?: boolean } = {},
): boolean {
  const { active = false, last = 0, small = false } = opts;
  const subscribe = useCallback((l: Listener) => (id ? previewBudget.subscribe(id, l) : () => undefined), [id]);
  const get = useCallback(() => (id ? previewBudget.isGranted(id) : false), [id]);
  useEffect(() => {
    if (id) previewBudget.upsert(id, diameter, { active, last, small });
  }, [id, diameter, active, last, small]);
  useEffect(() => () => { if (id) previewBudget.remove(id); }, [id]);
  return useSyncExternalStore(subscribe, get, get);
}
