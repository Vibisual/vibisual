/**
 * §5.13 (R-9) 레이어 편집기 ② — 작업판의 배율과 자리. `x`·`y` 는 무대 상자(레이아웃 px) 안에서 문서 원점이 서는 자리,
 * `scale` 은 문서 1px 이 화면 몇 px 인지. 화면 상태라 원본에 쓰지 않는다.
 */

export interface EditorView { scale: number; x: number; y: number }
export interface StageSize { width: number; height: number }

export const EDITOR_ZOOM = {
  min: 0.02,
  max: 32,
  /** 확대·축소 단추와 +/− 가 밟는 배율. */
  steps: [0.02, 0.03, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32],
  /** 맞춤 때 판 둘레 여백(화면 px) — 폰 폭은 좁게. */
  padding: 40,
  narrowPadding: 16,
  /** Ctrl/⌘+휠 한 눈금(deltaY 1)당 배율 지수. 트랙패드 핀치는 작은 delta 를 잦게 보낸다. */
  wheelFactor: 0.0025,
} as const;

export function clampScale(scale: number): number {
  return Math.min(EDITOR_ZOOM.max, Math.max(EDITOR_ZOOM.min, scale));
}

/** 판 전체가 여백 안에 들어오는 가장 큰 배율로 가운데. 판이 작아도 100% 를 넘기지 않는다(작은 아이콘이 뭉개져 보이지 않게). */
export function fitView(doc: { width: number; height: number }, stage: StageSize, padding: number = EDITOR_ZOOM.padding): EditorView {
  const room = { width: Math.max(1, stage.width - padding * 2), height: Math.max(1, stage.height - padding * 2) };
  const scale = clampScale(Math.min(1, room.width / doc.width, room.height / doc.height));
  return centred(doc, stage, scale);
}
export function centred(doc: { width: number; height: number }, stage: StageSize, scale: number): EditorView {
  return { scale, x: (stage.width - doc.width * scale) / 2, y: (stage.height - doc.height * scale) / 2 };
}

/** `at`(무대 px) 아래의 문서 점이 그대로 그 자리에 남도록 배율을 바꾼다. */
export function zoomAround(view: EditorView, scale: number, at: { x: number; y: number }): EditorView {
  const next = clampScale(scale);
  const k = next / view.scale;
  return { scale: next, x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k };
}

/** 지금 배율에서 한 단계 — 단계 사이에 있으면 가장 가까운 다음 단계로. */
export function stepZoom(scale: number, direction: 1 | -1): number {
  const steps = EDITOR_ZOOM.steps;
  if (direction > 0) return steps.find((s) => s > scale * 1.001) ?? EDITOR_ZOOM.max;
  return [...steps].reverse().find((s) => s < scale * 0.999) ?? EDITOR_ZOOM.min;
}

export function wheelZoom(view: EditorView, deltaY: number, at: { x: number; y: number }): EditorView {
  return zoomAround(view, view.scale * Math.exp(-deltaY * EDITOR_ZOOM.wheelFactor), at);
}

export function toDoc(view: EditorView, p: { x: number; y: number }): { x: number; y: number } {
  return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale };
}

/** SVG viewBox — 무대 상자 전체를 문서 좌표로 덮는다(선택 손잡이·안내선·여백이 모두 같은 좌표계에 선다). */
export function viewBoxOf(view: EditorView, stage: StageSize): string {
  const w = Math.max(1, stage.width) / view.scale;
  const h = Math.max(1, stage.height) / view.scale;
  return `${-view.x / view.scale} ${-view.y / view.scale} ${w} ${h}`;
}

export function percentOf(scale: number): string {
  const p = scale * 100;
  return `${p >= 10 ? Math.round(p) : Number(p.toFixed(1))}%`;
}
