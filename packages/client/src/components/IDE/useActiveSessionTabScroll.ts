import { useLayoutEffect, type RefObject } from 'react';

/** Reveal only within the tab strip; scrolling an ancestor can also move the conversation. */
function revealActiveTab(container: HTMLElement, sessionId: string): void {
  if (container.clientWidth <= 0) return;
  const tab = Array.from(container.children).find((child) => (
    (child as HTMLElement).dataset.tabId === sessionId
  )) as HTMLElement | undefined;
  if (!tab || tab.offsetWidth <= 0) return;

  // The strip is positioned, so offsetLeft is in its scroll coordinates, unaffected by FLIP.
  const left = tab.offsetLeft;
  const right = left + tab.offsetWidth;
  const viewLeft = container.scrollLeft;
  const viewRight = viewLeft + container.clientWidth;
  let target = viewLeft;
  if (tab.offsetWidth > container.clientWidth) {
    // A very narrow pane cannot fit the whole tab. Keep its name visible without oscillating.
    target = left;
  } else if (left < viewLeft) {
    target = left - 8;
  } else if (right > viewRight) {
    target = right - container.clientWidth + 8;
  }
  target = Math.max(0, Math.min(target, container.scrollWidth - container.clientWidth));
  if (target !== viewLeft) container.scrollLeft = target;
}

/** Navigation/layout changes reveal the selected session; manual scrolling keeps its position. */
export function useActiveSessionTabScroll({
  container, sessionId, orderKey, revealKey, paused,
}: {
  container: RefObject<HTMLDivElement>;
  sessionId: string | null;
  orderKey: string;
  /** Pane z stamp changes even when reopening the same session in the already-front window. */
  revealKey: number;
  paused: boolean;
}): void {
  useLayoutEffect(() => {
    const el = container.current;
    if (!el || !sessionId || paused) return;
    let frame: number | null = null;
    const reveal = (): void => { revealActiveTab(el, sessionId); };
    const schedule = (): void => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; reveal(); });
    };
    reveal();
    // A pane may be mounted while hidden; retry when it acquires its final width.
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    // Pins, loop markers and compact labels can shift the target without resizing the strip.
    for (const child of Array.from(el.children)) {
      if ((child as HTMLElement).dataset.tabId) observer.observe(child);
    }
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [container, sessionId, orderKey, revealKey, paused]);
}
