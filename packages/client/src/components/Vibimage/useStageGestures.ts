import { useRef, useState } from 'react';
import { patchImageLayer, type ImageDocument, type ImageLayer } from '../Creation/imageSource.js';
import { moveLayers } from './imageArrange.js';
import {
  boxBounds, boxCenter, boxFromDrag, boxesIntersect, pointerAngle, resizeBox, rotateDrag, snapMove, unionBounds,
  type Box, type Handle, type Point, type SnapGuide,
} from './imageGeometry.js';
import { clampScale, zoomAround, type EditorView } from './editorViewport.js';
import { isDrawTool, type DrawTool, type EditorTool } from './editorTools.js';
import type { EditorViewport } from './useEditorViewport.js';

/** 붙기 거리(화면 px) — 배율로 나눠 문서 단위로 쓴다. */
const SNAP_PX = 6;
/** 이보다 덜 끈 그리기는 클릭으로 본다(화면 px). */
const CLICK_PX = 4;

type Gesture =
  | { kind: 'pan'; client: Point; view: EditorView }
  | { kind: 'move'; start: Point; original: ImageDocument; ids: string[]; collapseTo: string | null; moved: boolean; dx: number; dy: number }
  | { kind: 'resize'; original: ImageDocument; layer: ImageLayer; handle: Handle; next: ImageDocument | null }
  | { kind: 'rotate'; original: ImageDocument; layer: ImageLayer; center: Point; startAngle: number; next: ImageDocument | null }
  | { kind: 'marquee'; start: Point; base: string[] }
  | { kind: 'draw'; start: Point; tool: DrawTool; client: Point }
  | { kind: 'pinch'; distance: number; mid: Point; view: EditorView };

export interface StageGestureOptions {
  doc: ImageDocument;
  selection: readonly string[];
  tool: EditorTool;
  viewport: EditorViewport;
  editable: boolean;
  onSelect?: (ids: string[]) => void;
  onChange?: (doc: ImageDocument) => void;
  onDraw?: (tool: DrawTool, box: Box | null, at: Point) => void;
  onEditText?: (id: string) => void;
  /** 화면 좌표 → 문서 좌표(SVG 의 화면 변환 역행렬). */
  toDoc: (clientX: number, clientY: number) => Point | null;
  /** 화면 좌표 → 무대 상자 레이아웃 px(CSS zoom 아래서도 맞게). */
  toStage: (clientX: number, clientY: number) => Point;
}

export interface StageGestureView {
  preview: ImageDocument | null;
  offset: { ids: ReadonlySet<string>; dx: number; dy: number } | null;
  guides: SnapGuide[];
  marquee: Box | null;
  draft: { tool: DrawTool; box: Box } | null;
  readout: { at: Point; text: string } | null;
  panning: boolean;
  hover: string;
}

const EMPTY: StageGestureView = { preview: null, offset: null, guides: [], marquee: null, draft: null, readout: null, panning: false, hover: '' };
const layerIdOf = (target: EventTarget | null): string => (target as Element | null)?.closest?.('[data-layer-id]')?.getAttribute('data-layer-id') ?? '';
const round = (n: number): number => Math.round(n);

/** §5.13 (R-9) 레이어 편집기 ②③ — 작업판 손짓(이동·크기·회전·상자 선택·그리기·끌어 보기·핀치). 기하는 `imageGeometry.ts`. */
export function useStageGestures(o: StageGestureOptions): { view: StageGestureView; handlers: React.SVGProps<SVGSVGElement> } {
  const gesture = useRef<Gesture | null>(null);
  const touches = useRef(new Map<number, Point>());
  // 포인터를 잡으면 뒤따르는 dblclick 의 target 이 판 전체가 된다 — 누른 자리의 레이어를 여기 적어 둔다.
  const pressed = useRef('');
  const [view, setView] = useState<StageGestureView>(EMPTY);
  const latest = useRef(o); latest.current = o;
  const reset = (): void => { gesture.current = null; setView((v) => ({ ...EMPTY, hover: v.hover })); };

  const startPinch = (): void => {
    const [a, b] = [...touches.current.values()];
    if (!a || !b) return;
    gesture.current = { kind: 'pinch', distance: Math.hypot(b.x - a.x, b.y - a.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: latest.current.viewport.view };
    setView((v) => ({ ...EMPTY, hover: v.hover }));
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    const { doc, selection, tool, viewport, editable, toDoc, toStage } = latest.current;
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, toStage(event.clientX, event.clientY));
      if (touches.current.size === 2) { event.currentTarget.setPointerCapture(event.pointerId); startPinch(); return; }
    }
    if (gesture.current) return;
    const at = toDoc(event.clientX, event.clientY);
    if (!at) return;
    const target = event.target as Element;
    const pan = event.button === 1 || tool === 'hand' || (!editable && event.button === 0);
    if (event.button !== 0 && !pan) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pan) {
      event.preventDefault();
      gesture.current = { kind: 'pan', client: { x: event.clientX, y: event.clientY }, view: viewport.view };
      setView((v) => ({ ...v, panning: true }));
      return;
    }
    if (tool === 'zoom') { viewport.zoomStep(event.shiftKey ? -1 : 1, toStage(event.clientX, event.clientY)); return; }
    const handle = target.getAttribute('data-handle') as Handle | null;
    const single = selection.length === 1 ? doc.layers.find((layer) => layer.id === selection[0]) : undefined;
    if (single && !single.locked && handle) { gesture.current = { kind: 'resize', original: doc, layer: single, handle, next: null }; return; }
    if (single && !single.locked && target.hasAttribute('data-rotate')) {
      const center = boxCenter(single);
      gesture.current = { kind: 'rotate', original: doc, layer: single, center, startAngle: pointerAngle(center, at), next: null };
      return;
    }
    const id = layerIdOf(target);
    pressed.current = id;
    const hit = doc.layers.find((layer) => layer.id === id);
    if (isDrawTool(tool)) {
      if (tool === 'text' && hit?.kind === 'text' && !hit.locked) {
        // 뒤따르는 mousedown 이 초점을 판으로 옮겨 막 연 글자 칸을 닫지 않게 한다.
        event.preventDefault();
        latest.current.onSelect?.([hit.id]); latest.current.onEditText?.(hit.id); return;
      }
      gesture.current = { kind: 'draw', start: at, tool, client: { x: event.clientX, y: event.clientY } };
      return;
    }
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!hit) {
      if (!additive) latest.current.onSelect?.([]);
      gesture.current = { kind: 'marquee', start: at, base: additive ? [...selection] : [] };
      return;
    }
    let ids = selection.includes(hit.id) ? [...selection] : [hit.id];
    if (additive) ids = selection.includes(hit.id) ? selection.filter((item) => item !== hit.id) : [...selection, hit.id];
    if (ids.join('\u0000') !== selection.join('\u0000')) latest.current.onSelect?.(ids);
    const movable = ids.filter((item) => !doc.layers.find((layer) => layer.id === item)?.locked);
    // 잠긴 레이어를 잡고 끌면 아무것도 움직이지 않는다(함께 고른 다른 레이어도).
    if (!movable.length || !ids.includes(hit.id) || hit.locked) return;
    gesture.current = {
      kind: 'move', start: at, original: doc, ids: movable, moved: false, dx: 0, dy: 0,
      collapseTo: !additive && selection.length > 1 && selection.includes(hit.id) ? hit.id : null,
    };
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    const { doc, viewport, toDoc, toStage } = latest.current;
    if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) touches.current.set(event.pointerId, toStage(event.clientX, event.clientY));
    const g = gesture.current;
    if (!g) {
      const id = layerIdOf(event.target);
      setView((v) => v.hover === id ? v : { ...v, hover: id });
      return;
    }
    if (g.kind === 'pinch') {
      const [a, b] = [...touches.current.values()];
      if (!a || !b) return;
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = clampScale(g.distance > 0 ? g.view.scale * (distance / g.distance) : g.view.scale);
      const zoomed = zoomAround(g.view, scale, g.mid);
      viewport.set({ ...zoomed, x: zoomed.x + mid.x - g.mid.x, y: zoomed.y + mid.y - g.mid.y });
      return;
    }
    if (g.kind === 'pan') {
      const here = toStage(event.clientX, event.clientY); const from = toStage(g.client.x, g.client.y);
      viewport.set({ ...g.view, x: g.view.x + here.x - from.x, y: g.view.y + here.y - from.y });
      return;
    }
    const at = toDoc(event.clientX, event.clientY);
    if (!at) return;
    const scale = viewport.view.scale;
    if (g.kind === 'move') {
      let dx = at.x - g.start.x; let dy = at.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) * scale < CLICK_PX / 2) return;
      if (event.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const ids = new Set(g.ids);
      const moving = unionBounds(g.original.layers.filter((layer) => ids.has(layer.id)).map(boxBounds));
      let guides: SnapGuide[] = [];
      if (moving && !(event.ctrlKey || event.metaKey)) {
        const others = g.original.layers.filter((layer) => !ids.has(layer.id) && layer.visible).map(boxBounds);
        const snap = snapMove({ ...moving, x: moving.x + dx, y: moving.y + dy }, others, g.original, SNAP_PX / scale);
        // Shift 로 한 축에 묶였으면 묶인 축은 붙이지 않는다.
        if (!(event.shiftKey && dx === 0)) dx += snap.dx;
        if (!(event.shiftKey && dy === 0)) dy += snap.dy;
        // 안내선은 실제로 놓일 자리에서 다시 잰다 — 묶인 축의 붙기 후보를 선으로 그리지 않게.
        guides = snapMove({ ...moving, x: moving.x + dx, y: moving.y + dy }, others, g.original, 0).guides;
      }
      g.moved = true; g.dx = dx; g.dy = dy;
      setView((v) => ({ ...v, offset: { ids, dx, dy }, guides }));
      return;
    }
    if (g.kind === 'resize') {
      const keep = event.shiftKey !== (g.layer.kind === 'image');
      const box = resizeBox(g.layer, g.handle, at, keep);
      g.next = patchImageLayer(g.original, g.layer.id, box);
      setView((v) => ({ ...v, preview: g.next, readout: { at, text: `${round(box.width)} × ${round(box.height)}` } }));
      return;
    }
    if (g.kind === 'rotate') {
      const rotation = rotateDrag(g.layer.rotation ?? 0, g.startAngle, pointerAngle(g.center, at), event.shiftKey);
      g.next = patchImageLayer(g.original, g.layer.id, { rotation });
      setView((v) => ({ ...v, preview: g.next, readout: { at, text: `${Number(rotation.toFixed(1))}°` } }));
      return;
    }
    if (g.kind === 'marquee') {
      const box = boxFromDrag(g.start, at, false);
      const hits = doc.layers.filter((layer) => layer.visible && boxesIntersect(boxBounds(layer), box)).map((layer) => layer.id);
      const ids = [...g.base, ...hits.filter((id) => !g.base.includes(id))];
      if (ids.join('\u0000') !== latest.current.selection.join('\u0000')) latest.current.onSelect?.(ids);
      setView((v) => ({ ...v, marquee: box }));
      return;
    }
    const box = boxFromDrag(g.start, at, event.shiftKey);
    setView((v) => ({ ...v, draft: { tool: g.tool, box }, readout: { at, text: `${round(box.width)} × ${round(box.height)}` } }));
  };

  const finish = (event: React.PointerEvent<SVGSVGElement>, cancelled: boolean): void => {
    touches.current.delete(event.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') { if (touches.current.size < 2) reset(); return; }
    const { doc, onChange, onDraw, onSelect, toDoc } = latest.current;
    // 끄는 사이 원본이 바뀌었으면(에이전트 시안 채택·되돌리기) 미리보기를 버린다 — 새 판을 옛 판 위 편집으로 덮지 않는다.
    const intact = (original: ImageDocument): boolean => !cancelled && original === doc;
    if (g.kind === 'move') {
      if (g.moved && intact(g.original)) onChange?.(moveLayers(g.original, g.ids, g.dx, g.dy));
      else if (!g.moved && g.collapseTo && !cancelled) onSelect?.([g.collapseTo]);
    } else if ((g.kind === 'resize' || g.kind === 'rotate') && g.next && intact(g.original)) onChange?.(g.next);
    else if (g.kind === 'draw' && !cancelled) {
      const at = toDoc(event.clientX, event.clientY) ?? g.start;
      const dragged = Math.hypot(event.clientX - g.client.x, event.clientY - g.client.y) >= CLICK_PX;
      onDraw?.(g.tool, dragged ? boxFromDrag(g.start, at, event.shiftKey) : null, g.start);
    }
    reset();
  };

  return {
    view,
    handlers: {
      onPointerDown, onPointerMove,
      onPointerUp: (event) => finish(event, false),
      onPointerCancel: (event) => finish(event, true),
      onPointerLeave: () => setView((v) => v.hover ? { ...v, hover: '' } : v),
      onDoubleClick: (event) => {
        const { doc, editable, onEditText } = latest.current;
        const hit = doc.layers.find((layer) => layer.id === (layerIdOf(event.target) || pressed.current));
        if (editable && hit?.kind === 'text' && !hit.locked) onEditText?.(hit.id);
      },
    },
  };
}
