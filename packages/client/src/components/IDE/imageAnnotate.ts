// §5.5 #17-25 v4.80 — 라이트박스 이미지 주석(강조 표시)의 순수 모델·기하.
//
// 좌표는 화면이 아니라 **이미지 natural 픽셀**로만 다룬다. 화면에는 같은 viewBox 를 가진 SVG
// 오버레이로 그리고, 저장할 때는 원본 해상도 캔버스에 같은 값을 다시 그린다 — 그래서 창 크기·
// 확대율이 바뀌어도 표시가 어긋나지 않고 "화면에서 본 것"과 "저장된 것"이 같다.
//
// DOM 없이 검증 가능하게 계산은 전부 여기 순수 함수로 둔다(floatingWindowGeom 선례).
// 캔버스에 실제로 붓을 대는 두 함수(drawAnnotations / exportAnnotatedPng)만 브라우저 API 를 쓰며,
// 그 둘도 그리는 값 자체는 위 순수 함수들이 계산한다.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 도구 8종. `view`(보기)는 도구가 아니라 "아무것도 안 그림" 상태라 여기 들어오지 않는다. */
export type AnnotationTool =
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'pen'
  | 'highlight'
  | 'mask'
  | 'text'
  | 'number';

/** 툴바 표시 순서 SSOT — 컴포넌트가 이 배열을 그대로 돈다. */
export const ANNOTATION_TOOLS: readonly AnnotationTool[] = [
  'rect',
  'ellipse',
  'arrow',
  'pen',
  'highlight',
  'mask',
  'text',
  'number',
];

/** 드래그로 그리는 도구 — 나머지(text/number)는 클릭 한 번으로 놓는다. */
const DRAG_TOOLS: ReadonlySet<AnnotationTool> = new Set<AnnotationTool>([
  'rect',
  'ellipse',
  'arrow',
  'pen',
  'highlight',
  'mask',
]);

export function isDragTool(tool: AnnotationTool): boolean {
  return DRAG_TOOLS.has(tool);
}

/** 색 6종. 어두운 스크린샷·밝은 스크린샷 양쪽에서 읽히도록 고채도 + 흰색을 함께 둔다. */
export const ANNOTATION_COLORS: readonly string[] = [
  '#ef4444',
  '#f59e0b',
  '#84cc16',
  '#22d3ee',
  '#a78bfa',
  '#ffffff',
];

/** 굵기 3단 — 기본 굵기(이미지 크기에서 뽑은 값)에 곱한다. */
export const ANNOTATION_WIDTH_STEPS: readonly number[] = [0.6, 1, 1.8];

interface AnnotationBase {
  id: string;
  color: string;
  /** natural 픽셀 단위 선 굵기. */
  strokeWidth: number;
}

export interface ShapeAnnotation extends AnnotationBase {
  tool: 'rect' | 'ellipse' | 'arrow' | 'highlight' | 'mask';
  from: Point;
  to: Point;
}

export interface PenAnnotation extends AnnotationBase {
  tool: 'pen';
  points: Point[];
}

export interface TextAnnotation extends AnnotationBase {
  tool: 'text';
  at: Point;
  text: string;
  fontSize: number;
}

export interface BadgeAnnotation extends AnnotationBase {
  tool: 'number';
  at: Point;
  index: number;
  radius: number;
}

export type Annotation = ShapeAnnotation | PenAnnotation | TextAnnotation | BadgeAnnotation;

// ─── 기본 치수 — 이미지 짧은 변에서 뽑는다 ───
// 4K 스크린샷에 2px 실선을 그으면 화면에서 머리카락처럼 사라지고, 작은 아이콘 캡처에 20px 을
// 그으면 그림이 안 보인다. 그래서 굵기·글자·배지 크기는 전부 이미지 크기에 비례해 잡고,
// 사용자가 굵기 3단으로 그 위를 조절한다.

export function baseStrokeWidth(natural: Size): number {
  const shortSide = Math.min(natural.w, natural.h);
  if (shortSide <= 0) return 3;
  return Math.max(2, Math.round(shortSide / 240));
}

export function baseFontSize(natural: Size): number {
  const shortSide = Math.min(natural.w, natural.h);
  if (shortSide <= 0) return 16;
  return Math.max(14, Math.round(shortSide / 22));
}

export function baseBadgeRadius(natural: Size): number {
  const shortSide = Math.min(natural.w, natural.h);
  if (shortSide <= 0) return 14;
  return Math.max(12, Math.round(shortSide / 28));
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/**
 * 화면(클라이언트) 좌표 → 이미지 natural 좌표.
 * `rect` 는 오버레이 SVG 의 getBoundingClientRect (= 이미지가 실제로 그려진 상자).
 * 이미지 밖으로 끌어도 좌표는 이미지 안으로 클램프한다(밖에 그려진 도형은 저장 시 잘려 사라진다).
 */
export function toImagePoint(client: Point, rect: Box, natural: Size): Point {
  if (rect.w <= 0 || rect.h <= 0) return { x: 0, y: 0 };
  const nx = ((client.x - rect.x) / rect.w) * natural.w;
  const ny = ((client.y - rect.y) / rect.h) * natural.h;
  return { x: clamp(nx, 0, natural.w), y: clamp(ny, 0, natural.h) };
}

/** 두 점 → 정규화된 상자(어느 방향으로 끌어도 양수 w/h). */
export function normalizeBox(from: Point, to: Point): Box {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    w: Math.abs(to.x - from.x),
    h: Math.abs(to.y - from.y),
  };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** 화살촉 삼각형 3점 (끝점 + 양쪽 미늘). 굵기에 비례하되 화살표보다 커지지 않게 상한을 둔다. */
export function arrowHead(from: Point, to: Point, strokeWidth: number): [Point, Point, Point] {
  const len = distance(from, to);
  const size = Math.min(Math.max(strokeWidth * 4.5, 8), Math.max(len, 1));
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  return [
    { x: to.x, y: to.y },
    { x: to.x - size * Math.cos(angle - spread), y: to.y - size * Math.sin(angle - spread) },
    { x: to.x - size * Math.cos(angle + spread), y: to.y - size * Math.sin(angle + spread) },
  ];
}

/**
 * 펜 경로 → SVG path `d`.
 * 중간점을 지나는 2차 베지어로 이어 손떨림을 눌러 준다. 캔버스 쪽은 이 문자열을 `Path2D` 로 그대로
 * 받으므로 화면과 저장본의 곡선이 **같은 계산**에서 나온다(두 벌로 그리면 반드시 어긋난다).
 */
export function penPathD(points: readonly Point[]): string {
  const first = points[0];
  if (!first) return '';
  if (points.length === 1) {
    // 점 하나 — 길이 0 선분(round cap 이라 점으로 찍힌다).
    return `M ${r(first.x)} ${r(first.y)} L ${r(first.x)} ${r(first.y)}`;
  }
  let d = `M ${r(first.x)} ${r(first.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const cur = points[i];
    const next = points[i + 1];
    if (!cur || !next) continue;
    const midX = (cur.x + next.x) / 2;
    const midY = (cur.y + next.y) / 2;
    d += ` Q ${r(cur.x)} ${r(cur.y)} ${r(midX)} ${r(midY)}`;
  }
  const last = points[points.length - 1];
  if (last && points.length > 1) d += ` L ${r(last.x)} ${r(last.y)}`;
  return d;
}

function r(v: number): number {
  return Math.round(v * 100) / 100;
}

/** `#rrggbb` + alpha → `rgba(...)`. 형광펜·가리기 채움에 쓴다. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return hex;
  const int = parseInt(m[1], 16);
  const rr = (int >> 16) & 255;
  const gg = (int >> 8) & 255;
  const bb = int & 255;
  return `rgba(${rr}, ${gg}, ${bb}, ${alpha})`;
}

/** 형광펜 채움 불투명도 — 아래 픽셀이 비쳐야 "강조"고, 안 비치면 "가리기"다. */
export const HIGHLIGHT_ALPHA = 0.28;

// ─── 생성·연장 ───

export interface AnnotationStyle {
  color: string;
  strokeWidth: number;
  fontSize: number;
  badgeRadius: number;
}

export interface CreateAnnotationInput {
  id: string;
  tool: AnnotationTool;
  at: Point;
  style: AnnotationStyle;
  /** number 도구 전용 — 다음 배지 번호. */
  badgeIndex?: number;
  /** text 도구 전용 — 확정된 글자. */
  text?: string;
}

export function createAnnotation(input: CreateAnnotationInput): Annotation {
  const { id, tool, at, style } = input;
  const base = { id, color: style.color, strokeWidth: style.strokeWidth };
  switch (tool) {
    case 'pen':
      return { ...base, tool: 'pen', points: [{ ...at }] };
    case 'text':
      return { ...base, tool: 'text', at: { ...at }, text: input.text ?? '', fontSize: style.fontSize };
    case 'number':
      return { ...base, tool: 'number', at: { ...at }, index: input.badgeIndex ?? 1, radius: style.badgeRadius };
    default:
      return { ...base, tool, from: { ...at }, to: { ...at } };
  }
}

/** 드래그 중 갱신. 펜은 점을 잇고(너무 촘촘한 점은 버림), 나머지는 끝점을 옮긴다. */
export function extendAnnotation(ann: Annotation, at: Point, minPenStep = 1.5): Annotation {
  if (ann.tool === 'pen') {
    const last = ann.points[ann.points.length - 1];
    if (last && distance(last, at) < minPenStep) return ann;
    return { ...ann, points: [...ann.points, { ...at }] };
  }
  if (ann.tool === 'text' || ann.tool === 'number') return ann;
  return { ...ann, to: { ...at } };
}

/**
 * 커밋 자격 — 잘못 누른 클릭이 스택을 채우면 되돌리기가 쓸모없어진다.
 * 3px 미만 도형·빈 글자·점 하나짜리 펜은 버린다(배지는 클릭 한 번이 곧 완성이라 항상 통과).
 */
export function isCommittable(ann: Annotation, minSize = 3): boolean {
  switch (ann.tool) {
    case 'pen':
      return ann.points.length >= 2;
    case 'text':
      return ann.text.trim().length > 0;
    case 'number':
      return true;
    case 'arrow':
      return distance(ann.from, ann.to) >= minSize;
    default: {
      const box = normalizeBox(ann.from, ann.to);
      return box.w >= minSize && box.h >= minSize;
    }
  }
}

/** 다음 번호 배지 값 — 지우고 다시 그려도 번호가 겹치지 않게 최댓값 +1. */
export function nextBadgeIndex(items: readonly Annotation[]): number {
  let max = 0;
  for (const a of items) {
    if (a.tool === 'number' && a.index > max) max = a.index;
  }
  return max + 1;
}

// ─── 되돌리기 스택 ───

export interface AnnotationHistory {
  items: Annotation[];
  past: Annotation[][];
  future: Annotation[][];
}

export const EMPTY_ANNOTATION_HISTORY: AnnotationHistory = { items: [], past: [], future: [] };

/** 과거 스택 상한 — 무한 누적은 큰 이미지에서 메모리만 먹고 실사용에서 닿지 않는다. */
export const ANNOTATION_HISTORY_LIMIT = 50;

function pushPast(history: AnnotationHistory, next: Annotation[]): AnnotationHistory {
  const past = [...history.past, history.items];
  return {
    items: next,
    past: past.length > ANNOTATION_HISTORY_LIMIT ? past.slice(past.length - ANNOTATION_HISTORY_LIMIT) : past,
    future: [],
  };
}

export function commitAnnotation(history: AnnotationHistory, ann: Annotation): AnnotationHistory {
  return pushPast(history, [...history.items, ann]);
}

export function clearAnnotations(history: AnnotationHistory): AnnotationHistory {
  if (history.items.length === 0) return history;
  return pushPast(history, []);
}

export function undoAnnotations(history: AnnotationHistory): AnnotationHistory {
  const prev = history.past[history.past.length - 1];
  if (!prev) return history;
  return {
    items: prev,
    past: history.past.slice(0, -1),
    future: [history.items, ...history.future],
  };
}

export function redoAnnotations(history: AnnotationHistory): AnnotationHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    items: next,
    past: [...history.past, history.items],
    future: history.future.slice(1),
  };
}

export function canUndo(history: AnnotationHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: AnnotationHistory): boolean {
  return history.future.length > 0;
}

// ─── 캔버스로 굽기 (브라우저 전용) ───

/** 글자·배지 숫자를 어떤 배경에서도 읽히게 하는 테두리 두께 비율. */
const TEXT_OUTLINE_RATIO = 0.18;

/** 주석 전량을 2D 컨텍스트에 그린다. 좌표는 natural 픽셀이므로 캔버스도 natural 크기여야 한다. */
export function drawAnnotations(ctx: CanvasRenderingContext2D, items: readonly Annotation[]): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const ann of items) {
    ctx.strokeStyle = ann.color;
    ctx.fillStyle = ann.color;
    ctx.lineWidth = ann.strokeWidth;
    switch (ann.tool) {
      case 'rect': {
        const box = normalizeBox(ann.from, ann.to);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        break;
      }
      case 'highlight': {
        const box = normalizeBox(ann.from, ann.to);
        ctx.fillStyle = withAlpha(ann.color, HIGHLIGHT_ALPHA);
        ctx.fillRect(box.x, box.y, box.w, box.h);
        break;
      }
      case 'mask': {
        const box = normalizeBox(ann.from, ann.to);
        ctx.fillStyle = '#000000';
        ctx.fillRect(box.x, box.y, box.w, box.h);
        break;
      }
      case 'ellipse': {
        const box = normalizeBox(ann.from, ann.to);
        ctx.beginPath();
        ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'arrow': {
        ctx.beginPath();
        ctx.moveTo(ann.from.x, ann.from.y);
        ctx.lineTo(ann.to.x, ann.to.y);
        ctx.stroke();
        const head = arrowHead(ann.from, ann.to, ann.strokeWidth);
        ctx.beginPath();
        ctx.moveTo(head[0].x, head[0].y);
        ctx.lineTo(head[1].x, head[1].y);
        ctx.lineTo(head[2].x, head[2].y);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'pen': {
        const d = penPathD(ann.points);
        if (d) ctx.stroke(new Path2D(d));
        break;
      }
      case 'text': {
        ctx.font = `700 ${ann.fontSize}px ${ANNOTATION_FONT_STACK}`;
        ctx.textBaseline = 'top';
        ctx.lineWidth = Math.max(2, ann.fontSize * TEXT_OUTLINE_RATIO);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.strokeText(ann.text, ann.at.x, ann.at.y);
        ctx.fillStyle = ann.color;
        ctx.fillText(ann.text, ann.at.x, ann.at.y);
        break;
      }
      case 'number': {
        ctx.beginPath();
        ctx.arc(ann.at.x, ann.at.y, ann.radius, 0, Math.PI * 2);
        ctx.fillStyle = ann.color;
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, ann.radius * 0.12);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.stroke();
        ctx.font = `700 ${Math.round(ann.radius * 1.25)}px ${ANNOTATION_FONT_STACK}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#0b0f19';
        ctx.fillText(String(ann.index), ann.at.x, ann.at.y + ann.radius * 0.04);
        ctx.textAlign = 'start';
        break;
      }
    }
  }
  ctx.restore();
}

/** 화면 SVG 와 저장 캔버스가 **같은 글꼴**로 그려야 저장본이 화면과 어긋나지 않는다. */
export const ANNOTATION_FONT_STACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * 원본 + 주석을 **원본 해상도 한 장**으로 굽는다. 실패하면 null(호출부가 오류 표시).
 *
 * §5.5 #17-25 ④-1 — `mime` 은 저장 대상이 정한다. 워크스페이스 파일을 덮어쓸 때 형식을 바꾸면
 * 확장자와 내용이 어긋나므로 원본 확장자의 MIME 을 그대로 받아 굽는다(png·jpeg·webp).
 * `canvas.toBlob` 이 모르는 MIME 을 받으면 브라우저는 조용히 PNG 를 뱉으므로, 그런 형식은
 * 애초에 호출부(`canOverwriteWorkspaceImage`)가 막는다.
 */
export async function exportAnnotatedImage(
  image: HTMLImageElement,
  items: readonly Annotation[],
  mime: string = 'image/png',
): Promise<Blob | null> {
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  if (w <= 0 || h <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, w, h);
  drawAnnotations(ctx, items);
  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime);
  });
}

/** 원본 + 주석을 원본 해상도 PNG 한 장으로 굽는다(첨부·내려받기의 기본 형식). */
export async function exportAnnotatedPng(
  image: HTMLImageElement,
  items: readonly Annotation[],
): Promise<Blob | null> {
  return await exportAnnotatedImage(image, items, 'image/png');
}
