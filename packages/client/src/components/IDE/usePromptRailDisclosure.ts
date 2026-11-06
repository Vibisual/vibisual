import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { useElementWidth } from '../../hooks/useElementWidth.js';
import { useIsNarrowViewport } from '../../hooks/useIsMobile.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { promptRailCompact } from './ideResponsive.js';

export function usePromptRailDisclosure(
  hostRef: RefObject<HTMLDivElement>,
  railRef: RefObject<HTMLDivElement>,
  scrollEl: HTMLElement | null,
): { compact: boolean; expanded: boolean; toggle: () => void; close: () => void } {
  const width = useElementWidth(hostRef);
  const narrow = useIsNarrowViewport();
  const compact = narrow || promptRailCompact(width);
  const [expanded, setExpanded] = useState(false);
  const close = useCallback((): void => setExpanded(false), []);
  const toggle = useCallback((): void => setExpanded((value) => !value), []);

  useLayoutEffect(close, [compact, scrollEl, close]);
  useOutsidePressDismiss({
    enabled: compact && expanded,
    onDismiss: close,
    refs: [railRef],
    events: ['pointerdown'],
  });

  useEffect(() => {
    if (!compact || !expanded || !scrollEl) return;
    // 출력에 의한 스크롤은 탐색 도구를 닫지 않는다.
    scrollEl.addEventListener('wheel', close, { passive: true });
    scrollEl.addEventListener('touchstart', close, { passive: true });
    scrollEl.addEventListener('keydown', close);
    return () => {
      scrollEl.removeEventListener('wheel', close);
      scrollEl.removeEventListener('touchstart', close);
      scrollEl.removeEventListener('keydown', close);
    };
  }, [compact, expanded, scrollEl, close]);

  return { compact, expanded: compact && expanded, toggle, close };
}
