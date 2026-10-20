import { cloneElement, createElement, isValidElement, memo, useRef, type FunctionComponent, type NamedExoticComponent, type ReactElement } from 'react';

/**
 * §5.13 (Y) 40-5 ③ — 무거운 판의 `memo`.
 *
 * 셸은 렌더마다 손잡이(콜백)와 목록(장면 구슬 · 칩)을 새로 짠다. 그대로 `memo` 를 걸면 매번 "다르다"고 보고 다시 그린다 — 걸어
 * 두나 마나다. 여기서는:
 *
 * - 손잡이를 **판마다 한 벌의 대리**로 바꿔 넘긴다. 대리는 부를 때마다 **마지막으로 받은 props** 의 같은 자리 손잡이를 부른다
 *   (그래서 판을 다시 그리지 않고 넘어가도 낡은 닫힘(closure)이 불리지 않는다).
 * - 비교에서는 손잡이를 빼고 **값만** 본다. 배열·평범한 객체·React 요소는 몇 겹(`depth`)까지 얕게 들여다본다 — 렌더마다 새로 짠
 *   목록이라도 값이 같으면 같다. 그 겹을 넘으면 정체(`Object.is`)로만 같다고 본다(모르면 다시 그린다 — 덜 그리는 쪽으로 틀리지 않는다).
 * - 대리 바꾸기와 비교는 **같은 길**로 같은 겹까지 내려간다 — 비교에서 "같다"고 본 손잡이는 반드시 대리로 바뀌어 있다.
 *
 * `fresh` 칸은 대리로 바꾸지 않고 정체로 비교한다 — **렌더 중에 불러 그 결과를 그리는 함수**(메뉴를 그리는 함수 등)는 대리로 바꾸면
 * 판이 다시 그려지지 않는 동안 낡은 결과가 남는다. 구독할 수 있는 객체(`subscribe` 가 있는 저장소 — 재생 머리 시계 등)는 언제나
 * 정체 그대로 넘기고 정체로 비교한다(대리로 바꾸면 프레임마다 부르는 자리에 비용이 붙는다).
 */

export interface MemoLatestOptions {
  /** 대리로 바꾸지 않고 정체로 비교할 맨 위 칸. */
  readonly fresh?: readonly string[];
  /** 몇 겹까지 들여다보는가(기본 `MEMO_LATEST_DEPTH`). */
  readonly depth?: number;
}

export const MEMO_LATEST_DEPTH = 3;

type AnyFn = (...args: unknown[]) => unknown;

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** 구독할 수 있는 저장소(정체가 곧 뜻이다). */
function isStoreLike(value: unknown): boolean {
  return isPlain(value) && typeof value['subscribe'] === 'function';
}

/** 손잡이를 같은 자리의 대리로 바꾼 사본. 바꿀 것이 없으면 **그 값 그대로**(정체를 지킨다). */
export function proxifyValue(value: unknown, path: string, depth: number, proxyAt: (path: string) => AnyFn): unknown {
  if (typeof value === 'function') return proxyAt(path);
  if (depth <= 0 || value === null || typeof value !== 'object' || isStoreLike(value)) return value;
  if (isValidElement(value)) {
    const props = (value as ReactElement<Record<string, unknown>>).props;
    const next = proxifyValue(props, `${path}.props`, depth - 1, proxyAt);
    return next === props ? value : cloneElement(value as ReactElement<Record<string, unknown>>, next as Record<string, unknown>);
  }
  if (Array.isArray(value)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < value.length; i += 1) {
      const item: unknown = value[i];
      const next = proxifyValue(item, `${path}.${i}`, depth - 1, proxyAt);
      if (next !== item) { out ??= value.slice(); out[i] = next; }
    }
    return out ?? value;
  }
  if (!isPlain(value)) return value;
  let out: Record<string, unknown> | null = null;
  for (const key of Object.keys(value)) {
    const item = value[key];
    const next = proxifyValue(item, `${path}.${key}`, depth - 1, proxyAt);
    if (next !== item) { out ??= { ...value }; out[key] = next; }
  }
  return out ?? value;
}

/** 값이 같은가(손잡이는 같다고 본다 — `proxifyValue` 와 같은 겹까지 같은 길로 내려간다). */
export function sameValue(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === 'function' && typeof b === 'function') return true;
  if (depth <= 0 || a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (isStoreLike(a) || isStoreLike(b)) return false;
  const elementA = isValidElement(a);
  const elementB = isValidElement(b);
  if (elementA || elementB) {
    if (!elementA || !elementB) return false;
    const x = a as ReactElement & { ref?: unknown };
    const y = b as ReactElement & { ref?: unknown };
    return x.type === y.type && x.key === y.key && x.ref === y.ref && sameValue(x.props, y.props, depth - 1);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!sameValue(a[i], b[i], depth - 1)) return false;
    return true;
  }
  if (!isPlain(a) || !isPlain(b)) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || !sameValue(a[key], b[key], depth - 1)) return false;
  }
  return true;
}

/** 그 자리의 값(대리가 부를 때 — 마지막 props 에서 찾는다). */
function valueAt(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** 두 props 가 같은가(맨 위 칸 — `fresh` 는 정체로). */
export function samePropsLatest(prev: Readonly<Record<string, unknown>>, next: Readonly<Record<string, unknown>>, opts: MemoLatestOptions = {}): boolean {
  const depth = opts.depth ?? MEMO_LATEST_DEPTH;
  const fresh = opts.fresh ?? [];
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const a = prev[key];
    const b = next[key];
    if (fresh.includes(key)) { if (!Object.is(a, b)) return false; continue; }
    if (!sameValue(a, b, depth)) return false;
  }
  return true;
}

/** 판 하나를 감싼다 — 값이 같으면 다시 그리지 않고, 손잡이는 늘 최신을 부른다. */
export function memoLatest<P extends object>(Inner: FunctionComponent<P>, opts: MemoLatestOptions = {}): NamedExoticComponent<P> {
  const depth = opts.depth ?? MEMO_LATEST_DEPTH;
  const fresh = opts.fresh ?? [];
  /** 마지막으로 그린 props → 그 판의 최신 상자. 비교가 "같다"고 하면 상자에 새 props 를 넣는다(대리가 그것을 부른다). */
  const boxes = new WeakMap<object, { current: P }>();

  function Latest(props: P): React.JSX.Element {
    const box = useRef<{ current: P } | null>(null);
    if (box.current === null) box.current = { current: props };
    box.current.current = props;
    boxes.set(props, box.current);
    const proxies = useRef(new Map<string, AnyFn>()).current;
    const live = box.current;
    const proxyAt = (path: string): AnyFn => {
      let f = proxies.get(path);
      if (!f) {
        f = (...args: unknown[]): unknown => {
          const fn = valueAt(live.current, path);
          return typeof fn === 'function' ? (fn as AnyFn)(...args) : undefined;
        };
        proxies.set(path, f);
      }
      return f;
    };
    const passed: Record<string, unknown> = {};
    for (const key of Object.keys(props)) {
      const value = (props as Record<string, unknown>)[key];
      passed[key] = fresh.includes(key) ? value : proxifyValue(value, key, depth, proxyAt);
    }
    return createElement(Inner, passed as P);
  }
  Latest.displayName = `Latest(${Inner.displayName ?? Inner.name ?? 'Component'})`;

  return memo(Latest, (prev, next) => {
    if (!samePropsLatest(prev as Readonly<Record<string, unknown>>, next as Readonly<Record<string, unknown>>, { depth, fresh })) return false;
    const box = boxes.get(prev);
    if (!box) return false;
    box.current = next;
    boxes.set(next, box);
    return true;
  }) as unknown as NamedExoticComponent<P>;
}
