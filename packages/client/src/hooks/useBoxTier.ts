import { createContext, useContext, useLayoutEffect, useState, type RefObject } from 'react';

import { boxTierOf, boxTierTokens, type BoxTier } from '../utils/boxTier.js';

/**
 * 앱 화면 뿌리(`AppShellHost`)가 잰 등급 — 앱 안쪽이 **JS 로** 배치를 골라야 할 때(좁으면 옆 칸을 기본으로 접기 등) 읽는다.
 * CSS 로 되는 접힘은 `box-*:` 변형이 먼저다(다시 그리기 없음). 앱 화면 밖에서는 늘 `unmeasured`(= 넓은 배치).
 */
export const AppBoxTierContext = createContext<BoxTier>('unmeasured');

/** `AppBoxTierContext` 를 읽는다 — 앱 안쪽에서 새 `data-box` 상자를 또 만들지 말고 이것을 쓴다. */
export function useAppBoxTier(): BoxTier {
  return useContext(AppBoxTierContext);
}

/**
 * 상자의 폭을 재서 그 상자에 `data-box` 를 단다 — 자손은 Tailwind `box-compact:` · `box-narrow:` · `box-wide:`
 * 로 읽는다(`index.css`). 판정과 기준값은 `utils/boxTier.ts` 한 곳.
 *
 * - **그리기 전에** 한 번 잰다(`useLayoutEffect`) — 폰 전체 화면 앱 창이 첫 프레임에 넓은 3칸으로 번쩍였다가 접히지 않게.
 * - 속성은 DOM 에 직접 단다 — 창을 끄는 동안 폭이 매 프레임 바뀌어도 React 는 다시 그리지 않는다.
 *   돌려주는 등급은 **등급이 바뀔 때만** 바뀐다(JS 로 배치를 고르는 쪽만 쓴다).
 * - `data-box` 상자는 겹치지 않게 **한 화면 뿌리에 하나**만 둔다 — 변형은 가장 가까운 상자가 아니라 조상 전부를 본다.
 * - ref 가 가리키는 요소는 마운트 내내 같아야 한다(조건부로 나중에 붙는 요소면 그 요소를 감싼 쪽에 건다).
 */
export function useBoxTier(ref: RefObject<HTMLElement | null>): BoxTier {
  const [tier, setTier] = useState<BoxTier>('unmeasured');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (width: number): void => {
      const next = boxTierOf(width);
      const tokens = boxTierTokens(next);
      if (el.getAttribute('data-box') !== tokens) el.setAttribute('data-box', tokens);
      setTier((prev) => (prev === next ? prev : next));
    };
    apply(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // `borderBoxSize` 가 있으면 그것을, 없으면 레이아웃 값을 쓴다(Safari 구버전) — `useElementWidth` 와 같은 규약.
      apply(entry.borderBoxSize?.[0]?.inlineSize ?? entry.target.getBoundingClientRect().width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return tier;
}
