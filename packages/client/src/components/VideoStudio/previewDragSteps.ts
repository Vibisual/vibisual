import type { DrawOp, HitRect } from '@vibisual/video';

import {
  KEEP_INSIDE_SCREEN_PX,
  MIN_BOX_DOC_PX,
  NO_SNAP,
  SNAP_SCREEN_PX,
  boxTransform,
  guidesTouching,
  keepReachable,
  movedTransform,
  movedValue,
  resizeBox,
  resizeBoxSnapped,
  screenLength,
  snapMove,
  type BoxAxis,
  type BoxPatch,
  type Corner,
  type FrameSize,
  type InnerBoxValues,
  type MovePatch,
  type SnapLine,
} from './previewTransform.js';

/**
 * §5.13 (V) 37-21 — 끌기 한 걸음(순수): 누른 자리에서 지금까지의 문서 거리 → 표시 상자 · 붙은 선 · 적을 값.
 * 손짓의 순서(누름·놓음·저장)는 `usePreviewDrag.ts` 가 안다.
 */

export interface DragStepInput {
  /** `null` = 몸통(옮기기). */
  readonly corner: Corner | null;
  /** 누른 자리에서의 문서 거리. */
  readonly dx: number;
  readonly dy: number;
  /** `Shift` — 비율 고정 · `Ctrl/Cmd` — 스냅 끔. */
  readonly keepAspect: boolean;
  readonly free: boolean;
  /** 문서 1px 의 화면 px(스냅 문턱·화면 안에 남길 몫이 화면 px 라서). */
  readonly scale: number;
  readonly lines: readonly SnapLine[];
  readonly frame: FrameSize;
}

function shifted(box: HitRect, dx: number, dy: number): HitRect {
  return { x: box.x + dx, y: box.y + dy, width: box.width, height: box.height };
}

export interface ItemDragStart {
  readonly op: DrawOp;
  /** 처음 배치 상자(회전 전). */
  readonly box: HitRect;
  readonly rotation: number;
  /** 옮길 때 붙는 자리(보이는 자리 · 돌렸으면 외곽 상자). */
  readonly visible: HitRect;
}

export interface ItemDragStep {
  /** 적을 배치 칸(배율 0 이라 환산할 수 없으면 null). */
  readonly patch: BoxPatch | MovePatch | null;
  readonly box: HitRect;
  readonly guides: readonly SnapLine[];
}

/** 아이템을 옮기거나 모서리로 크기를 바꾼 한 걸음. 돌린 아이템의 크기 조절은 붙지 않는다(변이 화면과 나란하지 않다). */
export function itemDragStep(start: ItemDragStart, i: DragStepInput): ItemDragStep {
  const threshold = i.free ? 0 : screenLength(SNAP_SCREEN_PX, i.scale);
  if (i.corner === null) {
    const snap = threshold > 0 ? snapMove(shifted(start.visible, i.dx, i.dy), i.lines, threshold) : NO_SNAP;
    const kept = keepReachable(start.visible, i.dx + snap.dx, i.dy + snap.dy, i.frame, screenLength(KEEP_INSIDE_SCREEN_PX, i.scale));
    // 화면 안에 붙드느라 줄인 축은 선에 닿지 않았다.
    const guides = snap.guides.filter((line) => (line.axis === 'x' ? kept.x === i.dx + snap.dx : kept.y === i.dy + snap.dy));
    return { patch: movedTransform(start.op, i.frame, kept.x, kept.y), box: shifted(start.box, kept.x, kept.y), guides };
  }
  const resize = { keepAspect: i.keepAspect, minSize: MIN_BOX_DOC_PX };
  const sized = start.rotation === 0
    ? resizeBoxSnapped(start.box, i.corner, i.dx, i.dy, resize, i.lines, threshold)
    : { box: resizeBox(start.box, start.rotation, i.corner, i.dx, i.dy, resize), guides: [] };
  return { patch: boxTransform(start.op, i.frame, sized.box), box: sized.box, guides: sized.guides };
}

export interface InnerDragStart {
  readonly values: InnerBoxValues;
  /** 처음 요소 상자(문서 px). */
  readonly box: HitRect;
  /** 값 1 이 문서에서 몇 px 인가. */
  readonly unit: number;
}

export interface InnerDragStep {
  /** 적을 값(이름 → 값) — 선언한 축만. */
  readonly props: Readonly<Record<string, number>>;
  /** 값이 실제로 간 만큼의 상자(눈금·범위에 걸리면 손보다 덜 간다). */
  readonly box: HitRect;
  readonly guides: readonly SnapLine[];
}

/** 컴포지션 안쪽 요소를 옮기거나 크기를 바꾼 한 걸음 — 선언한 값만 바뀐다. */
export function innerDragStep(start: InnerDragStart, i: DragStepInput): InnerDragStep {
  const v = start.values.values;
  const props: Record<string, number> = {};
  /** 그 축의 값을 문서 거리만큼 옮기고, 값이 실제로 간 문서 거리를 돌려준다. */
  const send = (axis: BoxAxis, docDelta: number): number => {
    const decl = v[axis];
    if (!decl) return 0;
    const next = movedValue(decl, docDelta, start.unit);
    props[decl.name] = next;
    return (next - decl.value) * start.unit;
  };
  const threshold = i.free ? 0 : screenLength(SNAP_SCREEN_PX, i.scale);
  if (i.corner === null) {
    const wantX = v.x ? i.dx : 0;
    const wantY = v.y ? i.dy : 0;
    const snap = threshold > 0 ? snapMove(shifted(start.box, wantX, wantY), i.lines, threshold) : NO_SNAP;
    const kept = keepReachable(start.box, wantX + (v.x ? snap.dx : 0), wantY + (v.y ? snap.dy : 0), i.frame, screenLength(KEEP_INSIDE_SCREEN_PX, i.scale));
    const box = shifted(start.box, send('x', kept.x), send('y', kept.y));
    return { props, box, guides: guidesTouching(box, snap.guides, 0.5) };
  }
  // 값 한 칸보다 작게는 줄이지 않는다(값이 0 이하로 가지 않게).
  const sized = resizeBoxSnapped(start.box, i.corner, i.dx, i.dy, { keepAspect: i.keepAspect, minSize: Math.max(start.unit, MIN_BOX_DOC_PX) }, i.lines, threshold);
  const grewW = send('w', sized.box.width - start.box.width);
  const grewH = send('h', sized.box.height - start.box.height);
  // 왼쪽·위 모서리는 자리도 함께 옮긴다(네 값이 다 있을 때만 그 손잡이가 선다) — 맞은편 변이 제자리에 남게 늘어난 만큼 뺀다.
  const movedX = i.corner === 'nw' || i.corner === 'sw' ? send('x', -grewW) : 0;
  const movedY = i.corner === 'nw' || i.corner === 'ne' ? send('y', -grewH) : 0;
  const box = { x: start.box.x + movedX, y: start.box.y + movedY, width: start.box.width + grewW, height: start.box.height + grewH };
  return { props, box, guides: guidesTouching(box, sized.guides, 0.5) };
}
