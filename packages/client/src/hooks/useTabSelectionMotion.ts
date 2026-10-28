import { useEffect, useLayoutEffect, useRef } from 'react';
import { useGraphStore } from '../stores/graphStore.js';
import {
  TAB_SELECTION_FLIP,
  boxKeyframes,
  labelClipKeyframes,
  labelRevealKeyframes,
  planTabSelectionFlip,
  springCurve,
  tabSelectionKey,
  translateKeyframes,
  type TabGeom,
  type TabRect,
} from './tabSelectionMotionGeom.js';

// §5.4 #14 — 고른 탭이 커지는 FLIP(계산은 `tabSelectionMotionGeom.ts`). **바뀌기 전 모양은 스토어가 바뀌는 순간 잰다** — `set()` 은 React 가 그리기 전이라
// 보이는 그대로(도는 중간값까지) 잡힌다. 바뀐 뒤는 `useLayoutEffect` 에서 움직임을 걷고 잰다.

/** TabBar 가 붙이는 표식 — 겉칸 키 · 탭 본체 · 판/이름 안쪽. 값이 갈리면 아무것도 움직이지 않는다. */
const TAB_KEY_ATTR = 'data-tab-key';
const TAB_SURFACE_ATTR = 'data-tab-surface';
const TAB_PART_ATTR = 'data-tab-part';
const TAB_PART = { plate: 'plate', labelInner: 'label-inner', labelText: 'label-text' } as const;
/** 이름 칸 — 잘라 보이는 칸이 이 클래스를 갖는다(`index.css` 가 끝 페이드·늘어나는 기준점을 준다). */
const TAB_LABEL_CLASS = 'tab-selection-label';

interface MeasuredTab {
  readonly geom: TabGeom;
  readonly surface: HTMLElement;
  readonly parts: readonly HTMLElement[];
}

interface Measured {
  /** 줄에 선 탭 키 순서 — 순서가 그대로인 커밋에서만 본체를 옆으로 미끄러뜨린다. */
  readonly order: string;
  readonly tabs: readonly MeasuredTab[];
}

interface Snapshot {
  /** 이 모양이 넘어갈 고른 탭 — 그 커밋이 아니면 쓰지 않는다. */
  readonly toKey: string | null;
  readonly order: string;
  readonly geoms: ReadonlyMap<string, TabGeom>;
}

function rectFrom(r: DOMRect, originX: number, originY: number): TabRect {
  return { x: r.left - originX, y: r.top - originY, w: r.width, h: r.height };
}

/** 줄의 탭들을 잰다 — 본체는 스크롤 칸 내용 좌표(스크롤과 무관), 그 안의 칸은 본체 좌상단 기준. */
function measureTabs(container: HTMLElement): Measured {
  const box = container.getBoundingClientRect();
  const originX = box.left - container.scrollLeft;
  const originY = box.top;
  const keys: string[] = [];
  const tabs: MeasuredTab[] = [];
  for (const slot of Array.from(container.children)) {
    if (!(slot instanceof HTMLElement)) continue;
    const key = slot.getAttribute(TAB_KEY_ATTR);
    if (!key) continue;
    keys.push(key);
    const surface = Array.from(slot.children).find(
      (c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute(TAB_SURFACE_ATTR),
    );
    if (!surface) continue;
    const s = surface.getBoundingClientRect();
    const parts = Array.from(surface.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
    tabs.push({
      surface,
      parts,
      geom: {
        key,
        active: surface.getAttribute('data-tab-active') === 'true',
        surface: rectFrom(s, originX, originY),
        parts: parts.map((p) => rectFrom(p.getBoundingClientRect(), s.left, s.top)),
        plateIndex: parts.findIndex((p) => p.getAttribute(TAB_PART_ATTR) === TAB_PART.plate),
        labelIndex: parts.findIndex((p) => p.classList.contains(TAB_LABEL_CLASS)),
      },
    });
  }
  return { order: keys.join('\n'), tabs };
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * @param container 탭이 늘어선 스크롤 칸(겉칸 `data-tab-key` 들의 부모).
 * @param activeKey 지금 고른 탭(`tabSelectionKey`) — 바뀐 커밋에서만 움직인다.
 * @param dragging 탭을 집어 들고 있다 — 고스트가 레이아웃 치수를 받으므로 도는 움직임은 끝 모습으로 보낸다.
 */
export function useTabSelectionMotion(container: HTMLElement | null, activeKey: string | null, dragging: boolean): void {
  const snapshotRef = useRef<Snapshot | null>(null);
  const runningRef = useRef(new Set<Animation>());

  useEffect(() => {
    if (!container) return;
    return useGraphStore.subscribe((state, prev) => {
      const next = tabSelectionKey(state.activeIframeId, state.activeProject);
      if (next === tabSelectionKey(prev.activeIframeId, prev.activeProject)) return;
      const measured = measureTabs(container);
      snapshotRef.current = {
        toKey: next,
        order: measured.order,
        geoms: new Map(measured.tabs.map((t) => [t.geom.key, t.geom])),
      };
    });
  }, [container]);

  useLayoutEffect(() => {
    const running = runningRef.current;
    if (dragging) {
      for (const a of running) a.finish();
      running.clear();
      snapshotRef.current = null;
      return;
    }
    const snap = snapshotRef.current;
    if (!container || !snap || snap.toKey !== activeKey) return;
    snapshotRef.current = null;
    // 바뀐 뒤의 레이아웃을 재려면 도는 움직임을 먼저 걷는다 — 바뀌기 전 모양(중간값)은 이미 잡아 두었다.
    for (const a of running) a.cancel();
    running.clear();
    const after = measureTabs(container);
    const reduced = prefersReducedMotion();
    const curve = springCurve(reduced ? TAB_SELECTION_FLIP.reducedSpring : TAB_SELECTION_FLIP.spring);
    const steps = planTabSelectionFlip(snap.geoms, after.tabs.map((t) => t.geom), { slideSurfaces: snap.order === after.order });
    const byKey = new Map(after.tabs.map((t) => [t.geom.key, t]));
    // 표본을 이미 스프링으로 찍었으므로 사이는 직선이다. 같은 커밋에서 건 움직임은 같은 프레임에 함께 시작한다.
    const timing: KeyframeAnimationOptions = { duration: curve.durationMs, easing: 'linear' };
    const track = (a: Animation): void => {
      running.add(a);
      const drop = (): void => { running.delete(a); };
      a.addEventListener('finish', drop);
      a.addEventListener('cancel', drop);
    };
    for (const step of steps) {
      const tab = byKey.get(step.key);
      if (!tab) continue;
      if (step.surfaceDx !== 0) track(tab.surface.animate(translateKeyframes(step.surfaceDx, 0, curve), timing));
      for (const part of step.parts) {
        const el = tab.parts[part.index];
        if (!el) continue;
        if (part.kind === 'plate') {
          track(el.animate(boxKeyframes(part, curve), timing));
        } else if (part.kind === 'label') {
          const clip = labelClipKeyframes(part, curve);
          track(el.animate(clip.outer, timing));
          const inner = el.querySelector(`[${TAB_PART_ATTR}="${TAB_PART.labelInner}"]`);
          if (part.sx !== 1 && inner instanceof HTMLElement) track(inner.animate(clip.inner, timing));
        } else {
          track(el.animate(translateKeyframes(part.dx, part.dy, curve), timing));
        }
      }
      if (step.reveal) {
        const text = tab.parts[tab.geom.labelIndex]?.querySelector(`[${TAB_PART_ATTR}="${TAB_PART.labelText}"]`);
        if (text instanceof HTMLElement) {
          const reveal = reduced ? TAB_SELECTION_FLIP.reducedReveal : TAB_SELECTION_FLIP.reveal;
          const frames = labelRevealKeyframes(reveal);
          track(text.animate(frames.main, { duration: reveal.durationMs }));
          if (frames.blur) track(text.animate(frames.blur, { duration: reveal.durationMs }));
        }
      }
    }
  }, [container, activeKey, dragging]);

  useEffect(() => {
    const running = runningRef.current;
    return () => {
      for (const a of running) a.cancel();
      running.clear();
    };
  }, []);
}
