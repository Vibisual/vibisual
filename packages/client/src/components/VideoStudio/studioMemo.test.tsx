import { createElement, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { memoLatest, proxifyValue, sameValue, samePropsLatest } from './studioMemo.js';

/**
 * §5.13 (Y) 40-5 ③ — 무거운 판의 `memo`. 셸은 렌더마다 손잡이(콜백)와 목록을 새로 짠다 — 그대로 `memo` 를 걸면 매번 다르다고 보고
 * 다시 그린다. 손잡이는 늘 최신을 부르는 대리로, 비교는 값만(몇 겹 얕게) 본다. 낡은 닫힘이 불리지 않는 것까지 고정한다.
 */

let view: ReactTestRenderer | undefined;
afterEach(() => { act(() => view?.unmount()); view = undefined; });

describe('sameValue / proxifyValue', () => {
  it('treats handlers as equal and compares lists of plain values a few levels deep', () => {
    expect(sameValue(() => 1, () => 2, 3)).toBe(true);
    expect(sameValue([{ id: 'a', n: 1 }], [{ id: 'a', n: 1 }], 3)).toBe(true);
    expect(sameValue([{ id: 'a', n: 1 }], [{ id: 'a', n: 2 }], 3)).toBe(false);
    expect(sameValue({ a: { b: { c: { d: 1 } } } }, { a: { b: { c: { d: 1 } } } }, 3)).toBe(false); // 겹을 넘으면 정체로만
    expect(sameValue(new Set([1]), new Set([1]), 3)).toBe(false); // 평범한 객체가 아니면 정체로만
  });

  it('compares React elements by type, key and props', () => {
    const a = createElement('span', { title: 'x', onClick: () => 1 });
    const b = createElement('span', { title: 'x', onClick: () => 2 });
    const c = createElement('span', { title: 'y' });
    expect(sameValue(a, b, 3)).toBe(true);
    expect(sameValue(a, c, 3)).toBe(false);
  });

  it('keeps stores (subscribe-able objects) by identity and never rewrites them', () => {
    const clock = { get: () => 1, subscribe: () => () => undefined };
    const proxyAt = vi.fn(() => () => undefined);
    expect(proxifyValue(clock, 'clock', 3, proxyAt)).toBe(clock);
    expect(sameValue(clock, { ...clock }, 3)).toBe(false);
    expect(proxyAt).not.toHaveBeenCalled();
  });

  it('returns the same object when nothing inside is a function (identity kept for hooks)', () => {
    const data = { list: [{ id: 'a' }], n: 1 };
    expect(proxifyValue(data, 'x', 3, () => () => undefined)).toBe(data);
  });

  it('compares fresh keys by identity only', () => {
    const render = (): null => null;
    expect(samePropsLatest({ menu: render, n: 1 }, { menu: render, n: 1 }, { fresh: ['menu'] })).toBe(true);
    expect(samePropsLatest({ menu: render }, { menu: (): null => null }, { fresh: ['menu'] })).toBe(false);
    expect(samePropsLatest({ menu: render }, { menu: (): null => null })).toBe(true);
  });
});

interface PanelProps {
  readonly items: readonly { readonly id: string; readonly label: string }[];
  readonly onPick: (id: string) => string;
  readonly nested: { readonly onClose: () => string };
}

describe('memoLatest', () => {
  it('skips re-rendering when only handlers changed, and the stable handler still calls the latest closure', () => {
    const renders = vi.fn();
    let picked: PanelProps['onPick'] | null = null;
    let closed: (() => string) | null = null;
    const Panel = memoLatest(function Panel(p: PanelProps): null {
      renders();
      picked = p.onPick;
      closed = p.nested.onClose;
      return null;
    });
    const props = (round: number): PanelProps => ({
      items: [{ id: 'a', label: 'A' }],
      onPick: (id) => `${id}@${round}`,
      nested: { onClose: () => `close@${round}` },
    });
    act(() => { view = create(createElement(Panel, props(1))); });
    const firstPick = picked;
    act(() => { view!.update(createElement(Panel, props(2))); });
    act(() => { view!.update(createElement(Panel, props(3))); });
    expect(renders).toHaveBeenCalledOnce();
    expect(picked).toBe(firstPick); // 손잡이는 한 벌의 대리
    expect(picked!('a')).toBe('a@3'); // 그런데 늘 마지막 props 의 닫힘을 부른다
    expect(closed!()).toBe('close@3');
  });

  it('re-renders when data changed (a list rebuilt with a different value)', () => {
    const renders = vi.fn();
    const Panel = memoLatest(function Panel(p: PanelProps): null { renders(p.items.length); return null; });
    const base: PanelProps = { items: [{ id: 'a', label: 'A' }], onPick: (id) => id, nested: { onClose: () => '' } };
    act(() => { view = create(createElement(Panel, base)); });
    act(() => { view!.update(createElement(Panel, { ...base, items: [{ id: 'a', label: 'A' }] })); });
    expect(renders).toHaveBeenCalledTimes(1);
    act(() => { view!.update(createElement(Panel, { ...base, items: [{ id: 'a', label: 'B' }] })); });
    expect(renders).toHaveBeenCalledTimes(2);
    act(() => { view!.update(createElement(Panel, { ...base, items: [] })); });
    expect(renders).toHaveBeenCalledTimes(3);
  });

  it('a parent re-rendering for unrelated state does not re-render the memoized panel', () => {
    const inner = vi.fn();
    const parent = vi.fn();
    const Panel = memoLatest(function Panel(p: { readonly label: string; readonly onClick: () => void }): null { inner(p.label); return null; });
    let bump: () => void = () => undefined;
    function Parent(): React.JSX.Element {
      const [n, setN] = useState(0);
      parent(n);
      bump = () => setN((v) => v + 1);
      return createElement(Panel, { label: 'same', onClick: () => setN(n + 1) });
    }
    act(() => { view = create(createElement(Parent)); });
    act(() => bump());
    act(() => bump());
    expect(parent).toHaveBeenCalledTimes(3);
    // 부모는 세 번 그려졌지만 판 안쪽은 처음 한 번뿐이다(손잡이만 새로 왔다).
    expect(inner).toHaveBeenCalledOnce();
  });
});
