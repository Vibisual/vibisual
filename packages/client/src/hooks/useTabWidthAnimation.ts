import { useEffect, useLayoutEffect, useRef } from 'react';

export const TAB_WIDTH_MOTION_MS = 360;
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

interface TabWidthState {
  width: number;
  active: boolean;
  animation?: Animation;
  labelAnimation?: Animation;
}

/** Animate numeric widths without leaving an inline width behind: idle tabs stay
 * fixed, selected tabs still size to their label, badges and buttons. Only the
 * inner surface is animated; the outer slot's transform belongs to drag FLIP.
 * Its label gets a separate reveal only when selection changes. */
export function useTabWidthAnimation(container: HTMLElement | null, dragging: boolean): void {
  const widthsRef = useRef(new Map<HTMLElement, TabWidthState>());

  useLayoutEffect(() => {
    if (!container) return;
    const widths = widthsRef.current;
    const scrollLeft = container.scrollLeft;
    const nodes = new Set(container.querySelectorAll<HTMLElement>('[data-tab-surface]'));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    for (const [node, state] of widths) {
      if (nodes.has(node)) continue;
      state.animation?.cancel();
      state.labelAnimation?.cancel();
      widths.delete(node);
    }

    // Read the in-flight width before removing the animation to measure the new
    // natural layout. Batch reads/writes so the whole row needs just one reflow.
    const previous = new Map<HTMLElement, { width: number; time: CSSNumberish | null }>();
    for (const node of nodes) {
      const state = widths.get(node);
      if (!state) continue;
      previous.set(node, {
        width: state.animation ? node.getBoundingClientRect().width : state.width,
        time: state.animation?.currentTime ?? null,
      });
    }
    for (const state of widths.values()) state.animation?.cancel();
    const targets = new Map(Array.from(nodes, (node) => [node, node.getBoundingClientRect().width]));

    for (const [node, target] of targets) {
      const state = widths.get(node);
      const before = previous.get(node);
      const active = node.dataset.tabActive === 'true';
      let labelAnimation = state?.labelAnimation;
      if (state && state.active !== active) {
        const label = node.querySelector<HTMLElement>('.tab-selection-label');
        // An interrupted reveal continues from its visible alpha/position. A
        // deselected name settles back to full readability instead of flashing.
        const continuing = labelAnimation && labelAnimation.playState !== 'finished';
        const current = label && continuing ? getComputedStyle(label) : null;
        const opacity = current?.opacity ?? '0.35';
        const transform = current?.transform ?? 'translateY(2px)';
        labelAnimation?.cancel();
        labelAnimation = undefined;
        if (label && !reduced && (active || continuing)) {
          const reveal = label.animate(
            [{ opacity, transform }, { opacity: 1, transform: 'translateY(0)' }],
            {
              duration: active ? TAB_WIDTH_MOTION_MS : 160,
              easing: 'cubic-bezier(0.2, 0, 0, 1)',
            },
          );
          labelAnimation = reveal;
          reveal.onfinish = () => {
            const currentState = widths.get(node);
            if (currentState?.labelAnimation === reveal) currentState.labelAnimation = undefined;
          };
        }
      }
      if (!reduced && state?.animation && Math.abs(state.width - target) < 0.5) {
        // Unrelated React updates must not restart the easing or postpone its end.
        state.animation.play();
        state.animation.currentTime = before?.time ?? 0;
        if (dragging) state.animation.pause();
        state.active = active;
        state.labelAnimation = labelAnimation;
        continue;
      }
      const next: TabWidthState = { width: target, active, labelAnimation };
      widths.set(node, next);
      if (reduced || !before || Math.abs(before.width - target) < 0.5) continue;
      const animation = node.animate(
        [{ width: `${before.width}px` }, { width: `${target}px` }],
        { duration: TAB_WIDTH_MOTION_MS, easing: EASING },
      );
      next.animation = animation;
      // Keep the slot at the same width captured by the drag ghost until drop.
      if (dragging) animation.pause();
      animation.onfinish = () => {
        if (widths.get(node) === next) next.animation = undefined;
      };
    }
    // Measuring the temporary natural layout can clamp the scroll offset while
    // a shrinking tab is still wider on screen. Restore it after the animations.
    container.scrollLeft = scrollLeft;
  });

  useEffect(() => {
    const widths = widthsRef.current;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stopMotion = (): void => {
      if (!media.matches) return;
      for (const state of widths.values()) {
        state.animation?.cancel();
        state.animation = undefined;
        state.labelAnimation?.cancel();
        state.labelAnimation = undefined;
      }
    };
    media.addEventListener('change', stopMotion);
    return () => {
      media.removeEventListener('change', stopMotion);
      for (const state of widths.values()) {
        state.animation?.cancel();
        state.labelAnimation?.cancel();
      }
      widths.clear();
    };
  }, []);
}
