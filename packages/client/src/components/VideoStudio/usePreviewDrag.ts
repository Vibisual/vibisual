import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildDrawList,
  hitTest,
  opBounds,
  opBox,
  type DrawOp,
  type HitRect,
  type HitResult,
  type HitTestOptions,
  type ResolvedTimeline,
  type VideoDoc,
  type VideoItemKind,
} from '@vibisual/video';
import type { StagePick } from '@vibisual/video/render';

import { innerDragStep, itemDragStep } from './previewDragSteps.js';
import {
  CORNERS,
  innerBoxValues,
  insideBox,
  movedValue,
  rotatedBounds,
  snapLines,
  type BoxAxis,
  type BoxNames,
  type BoxPatch,
  type Corner,
  type InnerBoxValues,
  type MovePatch,
  type Point,
  type SnapLine,
} from './previewTransform.js';

/**
 * §5.13 (V) 37-21 — 미리보기에서 고른 것을 끌어 옮기고 모서리로 크기를 바꾸는 손짓. 계산은 `previewTransform.ts`(순수), 여기는 순서만 안다.
 * - 아이템: 끄는 동안 배치 사본만 바꾸고(`layout.preview`) 놓을 때 한 번 저장한다(`layout.commit` — `updateItem{transform}`).
 * - 컴포지션 안쪽 요소: 위치·크기를 값으로 선언했을 때만 — 값 손잡이와 같은 길(`setProp`)로, 끄는 동안 저장을 붙든다.
 */

/** 상자가 있는 종류(자막은 아래 띠라 배치 상자가 없다 · 소리는 그려지지 않는다). */
const BOXED_KINDS: ReadonlySet<VideoItemKind> = new Set<VideoItemKind>(['scene', 'text', 'shape', 'image', 'footage', 'model', 'composition']);

export interface DragMods {
  /** `Shift` — 비율 고정. */
  readonly keepAspect: boolean;
  /** `Ctrl/Cmd` — 스냅 끔. */
  readonly free: boolean;
}

/** 손잡이 틀(문서 px · 회전 전 상자). */
export interface PreviewHandles {
  readonly kind: 'item' | 'inner';
  readonly box: HitRect;
  readonly rotation: number;
  readonly corners: readonly Corner[];
}

/** 미리보기 판이 부르는 손짓. */
export interface PreviewDragHandlers {
  /**
   * 누름 — 그 자리에 끌 것이 있으면 true(판이 포인터를 붙든다). `scale` = 문서 1px 의 화면 px. `release` 는 판이 붙든 포인터를 푸는
   * 함수 — 끌기가 어떻게 끝나든(놓기·취소·끊김) 이 훅이 한 번 부른다.
   */
  readonly begin: (at: Point, corner: Corner | null, scale: number, release?: () => void) => boolean;
  readonly move: (at: Point, mods: DragMods) => void;
  readonly end: () => void;
  readonly cancel: () => void;
}

export interface PreviewDragLayout {
  readonly preview: (itemId: string, patch: BoxPatch | MovePatch | null) => void;
  readonly commit: (itemId: string, patch: BoxPatch | MovePatch) => void;
  readonly nudge: (itemId: string, dx: number, dy: number) => void;
}

export interface PreviewDragDeps {
  readonly doc: VideoDoc | null;
  readonly timeline: ResolvedTimeline | null;
  /** 기본 모드 · 멈춤 · 편집 가능 · 글자/메모 칸 닫힘. 아니면 손잡이도 끌기도 없다. */
  readonly enabled: boolean;
  readonly playhead: number;
  readonly readPlayhead: () => number;
  readonly hitOptions: HitTestOptions | undefined;
  readonly selectedItemId: string | null;
  readonly setSelectedItemId: (id: string | null) => void;
  readonly pickAt: (x: number, y: number) => Promise<StagePick | null>;
  /** 마지막으로 바꾼 값이 그려질 때까지 기다린다(없으면 기다리지 않는다). */
  readonly settle?: (() => Promise<unknown>) | undefined;
  readonly layout: PreviewDragLayout;
  readonly setProp: (itemId: string, key: string, value: unknown) => void;
  readonly holdProps: (on: boolean) => void;
  /** 끌기 취소 — 그 값들을 이번 끌기가 시작될 때로 되돌린다(`useLocalProps.revertProps`). */
  readonly revertProps: (itemId: string, keys: readonly string[]) => void;
  /** 그 컴포지션 프레임을 지금 값으로 한 번 다시 연다(놓은 뒤 요소가 값을 따라오지 않았을 때). */
  readonly reopen?: ((itemId: string) => Promise<unknown>) | undefined;
}

export interface PreviewDrag {
  /** 그 시각의 손잡이 틀 — `op` 는 고른 아이템의 그리기 항목(그려지지 않으면 undefined). */
  readonly handlesFor: (op: DrawOp | undefined) => PreviewHandles | null;
  readonly guides: readonly SnapLine[];
  readonly handlers: PreviewDragHandlers | null;
  /** 기본 모드에서 누른 뒤 — 컴포지션 요소가 위치·크기를 값으로 선언했으면 그 요소를 고른다. */
  readonly pressed: (hit: HitResult | undefined, x: number, y: number) => void;
  /** `Esc` — 끌던 것을 되돌리거나 안쪽 고름을 푼다. 한 일이 있으면 true. */
  readonly escape: () => boolean;
  /** `Ctrl/Cmd+방향키` — 한 칸(아이템 1px · 안쪽 요소는 `step`), `big` 이면 10칸. 옮길 것이 있으면 true. */
  readonly nudge: (dx: number, dy: number, big: boolean) => boolean;
}

interface InnerSel {
  readonly itemId: string;
  readonly path: string;
  readonly rect: HitRect;
  /** 값 1 이 문서에서 몇 px 인가. */
  readonly unit: number;
  readonly names: BoxNames;
}

interface Live {
  readonly kind: 'item' | 'inner';
  readonly box: HitRect;
  readonly rotation: number;
  readonly corners: readonly Corner[];
  readonly guides: readonly SnapLine[];
}

interface Gesture {
  readonly kind: 'item' | 'inner';
  readonly corner: Corner | null;
  readonly itemId: string;
  readonly start: Point;
  readonly scale: number;
  readonly t: number;
  /** 끄는 아이템(안쪽 요소면 그것을 품은 컴포지션). */
  readonly op: DrawOp;
  /** 처음 상자(아이템 = 배치 상자 · 안쪽 = 그 요소). */
  readonly box: HitRect;
  /** 옮길 때 붙는 자리(보이는 자리 · 돌렸으면 외곽 상자). */
  readonly visible: HitRect;
  readonly rotation: number;
  /** 누를 때 아직 고르지 않은 것이었다(끌기 시작하면 고른다). */
  readonly select: boolean;
  /** 상자 크기가 곧 문서 주소인 컴포지션 — 크기를 끄는 동안에는 틀만 따라간다. */
  readonly deferSize: boolean;
  readonly inner: InnerSel | null;
  readonly values: InnerBoxValues | null;
  started: boolean;
  lines: readonly SnapLine[];
  last: BoxPatch | MovePatch | null;
  /** 안쪽 요소의 마지막 자리(놓으면 그 자리에 틀이 남는다). */
  lastBox: HitRect | null;
  touched: Set<string>;
  /** 판이 붙든 포인터를 푼다(끝날 때 한 번). */
  readonly release: (() => void) | null;
}

/** 놓은 뒤 다시 잴 안쪽 요소 — 끌기 전 상자와 놓은 상자(어느 쪽에 가까운지로 따라왔나를 본다). */
interface MeasureAsk {
  readonly itemId: string;
  readonly path: string;
  readonly before: HitRect;
  readonly expected: HitRect;
}

const INNER_AXES: readonly BoxAxis[] = ['x', 'y', 'w', 'h'];
/** 붙은 선이 없을 때의 같은 빈 목록 — 정체가 바뀌면 미리보기 판이 셸 렌더마다 다시 그려진다(40-5 ③). */
const NO_GUIDES: readonly SnapLine[] = [];

function shifted(box: HitRect, dx: number, dy: number): HitRect {
  return { x: box.x + dx, y: box.y + dy, width: box.width, height: box.height };
}

/** 두 상자의 어긋남(문서 px — 네 칸 차의 합). */
function gap(a: HitRect, b: HitRect): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
}

export function usePreviewDrag(d: PreviewDragDeps): PreviewDrag {
  const [inner, setInnerState] = useState<InnerSel | null>(null);
  const innerRef = useRef<InnerSel | null>(null);
  const setInner = useCallback((next: InnerSel | null): void => { innerRef.current = next; setInnerState(next); }, []);
  const [live, setLive] = useState<Live | null>(null);
  /** 놓은 뒤 안쪽 요소의 자리를 다시 묻는 차례(0 = 묻지 않는다)와 그 물음. */
  const [measure, setMeasure] = useState(0);
  const measureAsk = useRef<MeasureAsk | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const dRef = useRef(d);
  dRef.current = d;
  const docId = d.doc?.id ?? '';

  /**
   * 37-21 (L) — 끌기를 끝내는 유일한 취소 길. 놓지 않고 끝난 끌기(Esc · 포인터 끊김·캡처 상실 · 창 blur · 버튼 없이 온 움직임 ·
   * 언마운트 · 모드·재생·문서·시각 변화 · 새 누름)는 모두 여기로 온다 — 이번 끌기 몫만 되돌리고(저장 ❌) 저장 붙들기·포인터·틀·안내선을 푼다.
   */
  const abandon = useCallback((): boolean => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return false;
    if (g.started) {
      const cur = dRef.current;
      if (g.kind === 'item') cur.layout.preview(g.itemId, null);
      else { cur.revertProps(g.itemId, [...g.touched]); cur.holdProps(false); }
    }
    g.release?.();
    setLive(null);
    return g.started;
  }, []);

  // 다른 문서·다른 시각이면 끌던 것도 안쪽 고름도 그 자리의 것이 아니다.
  useEffect(() => { abandon(); setInner(null); }, [docId, d.playhead, abandon, setInner]);
  useEffect(() => { if (inner && inner.itemId !== d.selectedItemId) setInner(null); }, [d.selectedItemId, inner, setInner]);
  // 끌다 재생·모드 전환·잠금으로 꺼지거나 판이 걷히면 되돌린다.
  useEffect(() => { if (!d.enabled) abandon(); }, [d.enabled, abandon]);
  useEffect(() => () => { abandon(); }, [abandon]);

  const begin = useCallback((at: Point, corner: Corner | null, scale: number, release?: () => void): boolean => {
    const cur = dRef.current;
    const { doc, timeline } = cur;
    // 떼는 순간을 못 받아 남은 옛 손짓은 취소로 끝낸다(덮어쓰기·붙들기가 남지 않게).
    abandon();
    if (!cur.enabled || !doc || !timeline) return false;
    const t = cur.readPlayhead();
    const ops = buildDrawList(doc, timeline, t);
    const base = {
      corner, start: at, scale: scale > 0 ? scale : 1, t, started: false, lines: [] as readonly SnapLine[], last: null, lastBox: null,
      touched: new Set<string>(), release: release ?? null,
    };

    const sel = innerRef.current;
    const selOp = sel ? ops.find((o) => o.itemId === sel.itemId) : undefined;
    const values = sel && selOp ? innerBoxValues(doc, sel.itemId, sel.names) : null;
    if (sel && selOp && values) {
      if (corner ? values.corners.includes(corner) : values.move && insideBox(sel.rect, 0, at.x, at.y)) {
        gesture.current = { ...base, kind: 'inner', itemId: sel.itemId, op: selOp, box: sel.rect, visible: sel.rect, rotation: 0, select: false, deferSize: false, inner: sel, values };
        return true;
      }
      // 안쪽 요소의 손잡이가 서 있는 동안 아이템 손잡이는 없다.
      if (corner) return false;
    }

    const selected = cur.selectedItemId ? ops.find((o) => o.itemId === cur.selectedItemId) : undefined;
    const grabbable = (op: DrawOp | undefined): op is DrawOp => !!op && !op.synthetic && BOXED_KINDS.has(op.kind) && op.transform.scale > 0;
    let target: DrawOp | undefined;
    if (corner) target = grabbable(selected) ? selected : undefined;
    else if (grabbable(selected) && insideBox(opBox(selected), selected.transform.rotation, at.x, at.y)) target = selected;
    else {
      const hit = hitTest(doc, timeline, t, at.x, at.y, cur.hitOptions)?.op;
      target = grabbable(hit) ? hit : undefined;
    }
    if (!target) return false;
    const box = opBox(target);
    const rotation = target.transform.rotation;
    const asset = target.resolved.item.assetId ? doc.assets[target.resolved.item.assetId] : undefined;
    gesture.current = {
      ...base, kind: 'item', itemId: target.itemId, op: target, box, rotation,
      visible: rotation !== 0 ? rotatedBounds(box, rotation) : opBounds(doc, target, cur.hitOptions),
      select: target.itemId !== cur.selectedItemId,
      deferSize: target.kind === 'composition' && asset?.responsive === true,
      inner: null, values: null,
    };
    return true;
  }, [abandon]);

  const move = useCallback((at: Point, mods: DragMods): void => {
    const g = gesture.current;
    const cur = dRef.current;
    const { doc, timeline } = cur;
    if (!g || !doc || !timeline) return;
    if (!g.started) {
      g.started = true;
      // 안쪽 요소를 끌 때는 그것을 품은 아이템의 변도 붙는 자리다(뺄 것이 없다).
      g.lines = snapLines(doc, timeline, g.t, g.kind === 'item' ? g.itemId : null);
      if (g.kind === 'inner') cur.holdProps(true);
      else if (g.select) { setInner(null); cur.setSelectedItemId(g.itemId); }
    }
    const step = {
      corner: g.corner, dx: at.x - g.start.x, dy: at.y - g.start.y, keepAspect: mods.keepAspect, free: mods.free,
      scale: g.scale, lines: g.lines, frame: doc.size,
    };
    if (g.kind === 'item') {
      const next = itemDragStep(g, step);
      if (!next.patch) return;
      g.last = next.patch;
      // 크기가 곧 프레임 주소인 컴포지션은 크기를 끄는 동안 틀만 따라간다.
      if (!(g.deferSize && g.corner !== null)) cur.layout.preview(g.itemId, next.patch);
      setLive({ kind: 'item', box: next.box, rotation: g.rotation, corners: CORNERS, guides: next.guides });
      return;
    }
    if (!g.inner || !g.values) return;
    const next = innerDragStep({ values: g.values, box: g.box, unit: g.inner.unit }, step);
    for (const [name, value] of Object.entries(next.props)) { g.touched.add(name); cur.setProp(g.itemId, name, value); }
    g.lastBox = next.box;
    setLive({ kind: 'inner', box: next.box, rotation: 0, corners: g.values.corners, guides: next.guides });
  }, [setInner]);

  const end = useCallback((): void => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    g.release?.();
    if (!g.started) { setLive(null); return; }
    const cur = dRef.current;
    if (g.kind === 'item') {
      if (g.last) cur.layout.commit(g.itemId, g.last);
      else cur.layout.preview(g.itemId, null);
      setLive(null);
      return;
    }
    cur.holdProps(false);
    if (g.inner && g.lastBox && innerRef.current?.path === g.inner.path) {
      setInner({ ...g.inner, rect: g.lastBox });
      measureAsk.current = { itemId: g.itemId, path: g.inner.path, before: g.box, expected: g.lastBox };
      setMeasure((n) => n + 1);
    }
    setLive(null);
  }, [setInner]);

  // 놓은 뒤 — 값이 그려지기를 기다려 그 요소가 정말 그 자리에 왔는지 묻는다. 따라오지 않았으면(값을 선언만 하고 CSS 변수·onProps 로
  //   따르지 않는 컴포지션) 틀을 걷고 그 프레임을 지금 값으로 한 번 다시 연다 — 미리보기가 저장될 값·내보내기와 같아지게(37-21 (H)).
  useEffect(() => {
    const ask = measureAsk.current;
    if (measure === 0 || !ask) return undefined;
    let stale = false;
    void (async () => {
      try { await dRef.current.settle?.(); } catch { /* 그리지 못했으면 아래 물음이 걷는다 */ }
      if (stale) return;
      const at = ask.expected;
      const pick = await dRef.current.pickAt(at.x + at.width / 2, at.y + at.height / 2).catch(() => null);
      if (stale) return;
      const cur = innerRef.current;
      if (!cur || cur.itemId !== ask.itemId || cur.path !== ask.path) return;
      const box = pick && pick.op.itemId === cur.itemId ? pick.box : undefined;
      // 그 요소가 그 자리에 있고, 끌기 전 자리보다 놓은 자리에 가깝게 섰으면 따라온 것이다.
      if (box && box.path === cur.path && gap(box.rect, ask.expected) <= gap(box.rect, ask.before)) {
        setInner({ ...cur, rect: box.rect, unit: box.scale });
        return;
      }
      setInner(null);
      void dRef.current.reopen?.(ask.itemId).catch(() => undefined);
    })();
    return () => { stale = true; };
  }, [measure, setInner]);

  const pressSeq = useRef(0);
  const pressed = useCallback((hit: HitResult | undefined, x: number, y: number): void => {
    const cur = dRef.current;
    const op = hit?.op;
    const seq = (pressSeq.current += 1);
    // 돌렸거나 배율이 걸린 아이템은 안쪽 좌표가 정확하지 않다(37-6) — 손잡이를 세우지 않는다.
    if (!cur.enabled || !cur.doc || !op || op.kind !== 'composition' || op.transform.rotation !== 0 || op.transform.scale !== 1) { setInner(null); return; }
    void cur.pickAt(x, y).then((pick) => {
      // 그사이 다른 곳을 눌렀으면 그 누름의 답만 쓴다.
      if (seq !== pressSeq.current) return;
      const now = dRef.current;
      const box = pick && pick.op.itemId === op.itemId ? pick.box : undefined;
      if (!box || !now.doc) { setInner(null); return; }
      const names: BoxNames = Object.fromEntries(INNER_AXES.flatMap((axis) => (box[axis] ? [[axis, box[axis]]] : [])));
      setInner(innerBoxValues(now.doc, op.itemId, names) ? { itemId: op.itemId, path: box.path, rect: box.rect, unit: box.scale, names } : null);
    }, () => { if (seq === pressSeq.current) setInner(null); });
  }, [setInner]);

  const escape = useCallback((): boolean => {
    if (abandon()) return true;
    if (innerRef.current) { setInner(null); return true; }
    return false;
  }, [abandon, setInner]);

  const nudge = useCallback((dx: number, dy: number, big: boolean): boolean => {
    const cur = dRef.current;
    const { doc, timeline } = cur;
    if (!cur.enabled || !doc || !timeline || gesture.current) return false;
    const times = big ? 10 : 1;
    const sel = innerRef.current;
    const values = sel ? innerBoxValues(doc, sel.itemId, sel.names) : null;
    if (sel && values) {
      const step = (axis: 'x' | 'y', dir: number): number => {
        const decl = values.values[axis];
        if (!decl || dir === 0) return 0;
        const next = movedValue(decl, dir * times * decl.step * sel.unit, sel.unit);
        if (next !== decl.value) cur.setProp(sel.itemId, decl.name, next);
        return (next - decl.value) * sel.unit;
      };
      setInner({ ...sel, rect: shifted(sel.rect, step('x', dx), step('y', dy)) });
      return true;
    }
    if (!cur.selectedItemId) return false;
    const op = buildDrawList(doc, timeline, cur.readPlayhead()).find((o) => o.itemId === cur.selectedItemId);
    if (!op || !BOXED_KINDS.has(op.kind)) return false;
    cur.layout.nudge(op.itemId, dx * times, dy * times);
    return true;
  }, [setInner]);

  const handlesFor = useCallback((op: DrawOp | undefined): PreviewHandles | null => {
    if (!d.enabled || !d.doc) return null;
    if (live) return { kind: live.kind, box: live.box, rotation: live.rotation, corners: live.corners };
    if (inner) {
      const values = innerBoxValues(d.doc, inner.itemId, inner.names);
      if (values) return { kind: 'inner', box: inner.rect, rotation: 0, corners: values.corners };
    }
    if (!op || op.synthetic || !BOXED_KINDS.has(op.kind) || !(op.transform.scale > 0)) return null;
    return { kind: 'item', box: opBox(op), rotation: op.transform.rotation, corners: CORNERS };
  }, [d.enabled, d.doc, live, inner]);

  const handlers = useRef<PreviewDragHandlers>({ begin, move, end, cancel: () => { abandon(); } }).current;

  return { handlesFor, guides: live?.guides ?? NO_GUIDES, handlers: d.enabled ? handlers : null, pressed, escape, nudge };
}
