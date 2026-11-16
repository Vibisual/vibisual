/**
 * §5.13 (V) 37-8 — 장면 전환의 표(순수). 겹침 구간(`transitionOverlap`)에서 두 장면 아이템에 효과를 입힌다 — 배치에 얹는 값(불투명도·이동·크기·사각 clip·
 * 원 clip·흐림)과 덧그림(빛 번짐·가림막)뿐이라 세 백엔드와 컴포지션 상자가 같은 표를 쓴다(백엔드마다 달라 보이지 않게). p 는 겹침 안 0→1(`easeInOutCubic`),
 * 들어오는 쪽 `in`·나가는 쪽 `out`.
 */
import { TRANSITION_BLUR_MAX_PX, TRANSITION_BLUR_RATIO } from '../constants.js';
import type { TransitionDirection, TransitionKind, VideoDoc } from '../types.js';

export const TRANSITION_KINDS: readonly TransitionKind[] = ['cut', 'dissolve', 'push', 'zoom', 'flash', 'wipe', 'iris', 'blur', 'curtain'];
export const TRANSITION_DIRECTIONS: readonly TransitionDirection[] = ['left', 'right', 'up', 'down'];

/** 방향을 읽는 전환과 그 기본값 — 방향이 생기기 전 문서가 같은 그림을 내도록 종전 움직임이 기본이다. */
const DEFAULT_DIRECTION: Readonly<Partial<Record<TransitionKind, TransitionDirection>>> = { push: 'left', wipe: 'right', curtain: 'right' };

export function transitionHasDirection(kind: TransitionKind): boolean {
  return DEFAULT_DIRECTION[kind] !== undefined;
}

/** 이 전환이 실제로 움직이는 쪽(방향이 없는 전환이면 null). 모르는 값은 기본값으로 읽는다. */
export function transitionDirection(kind: TransitionKind, direction?: TransitionDirection): TransitionDirection | null {
  const fallback = DEFAULT_DIRECTION[kind];
  if (fallback === undefined) return null;
  return direction !== undefined && TRANSITION_DIRECTIONS.includes(direction) ? direction : fallback;
}

export interface TransitionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 문서 픽셀의 원. */
export interface TransitionCircle {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** 아이템 하나에 얹는 효과. */
export interface TransitionEffect {
  /** 불투명도 곱. 0 이면 그리지 않는다. */
  readonly opacity: number;
  /** 문서 픽셀 이동. */
  readonly dx: number;
  readonly dy: number;
  /** 크기 곱(아이템 가운데 기준). */
  readonly scale: number;
  /** 이 사각형 밖은 그리지 않는다(문서 픽셀). 없으면 null. */
  readonly clip: TransitionRect | null;
  /** 이 원 밖은 그리지 않는다(문서 픽셀). 없으면 null. */
  readonly circle: TransitionCircle | null;
  /** 흐림 반경(문서 픽셀). 0 이면 없음. */
  readonly blur: number;
}

export const NO_EFFECT: TransitionEffect = { opacity: 1, dx: 0, dy: 0, scale: 1, clip: null, circle: null, blur: 0 };

export function easeInOutCubic(p: number): number {
  const x = Math.max(0, Math.min(1, p));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** 확대 전환이 들어올 때의 시작 배율·나갈 때의 끝 배율. */
const ZOOM_IN_FROM = 1.12;
const ZOOM_OUT_TO = 0.92;
/** 흐림 녹아들기가 가장 흐릴 때의 배율 — 흐림이 가장자리를 투명하게 먹는 만큼 상자를 키워 테두리가 비치지 않게 한다. */
const BLUR_SCALE = 1.04;

/** 움직이는 쪽의 단위 벡터(화면 좌표 — 아래가 +y). */
function unit(direction: TransitionDirection): { readonly x: number; readonly y: number } {
  switch (direction) {
    case 'right': return { x: 1, y: 0 };
    case 'up': return { x: 0, y: -1 };
    case 'down': return { x: 0, y: 1 };
    case 'left':
    default: return { x: -1, y: 0 };
  }
}

/** 0.1px 로 접는다 — DOM `filter` 와 canvas `ctx.filter` 가 같은 글자를 쓴다. */
function round1(v: number): number {
  return Math.round(v * 10) / 10 || 0;
}

/** 그 판형에서 흐림 녹아들기의 가장 센 흐림(문서 픽셀) — 판형이 달라도 같은 느낌, 상한은 성능 기준. */
export function transitionBlurPx(size: VideoDoc['size']): number {
  return Math.min(TRANSITION_BLUR_MAX_PX, Math.max(0, Math.min(size.width, size.height)) * TRANSITION_BLUR_RATIO);
}

/** 흐림 값 → CSS 필터 한 토막(없으면 빈 글자). */
export function transitionBlurFilter(blur: number | undefined): string {
  return blur !== undefined && blur > 0 ? `blur(${round1(blur)}px)` : '';
}

/** 닦아내기가 `e` 만큼 드러낸 사각형 — 드러나는 가장자리가 `direction` 쪽으로 간다. */
function wipeRect(direction: TransitionDirection, e: number, size: VideoDoc['size']): TransitionRect {
  const { width, height } = size;
  switch (direction) {
    case 'left': return { x: (1 - e) * width, y: 0, width: e * width, height };
    case 'down': return { x: 0, y: 0, width, height: e * height };
    case 'up': return { x: 0, y: (1 - e) * height, width, height: e * height };
    case 'right':
    default: return { x: 0, y: 0, width: e * width, height };
  }
}

/**
 * 전환 `kind` 의 `phase`(들어옴/나감) 효과 — 진행률 `p`(0~1, 아직 접지 않은 값), 문서 크기 `size`, 움직이는 쪽 `direction`(방향이 있는 전환만 읽는다).
 */
export function transitionEffect(kind: TransitionKind, phase: 'in' | 'out', p: number, size: VideoDoc['size'], direction?: TransitionDirection): TransitionEffect {
  const e = easeInOutCubic(p);
  switch (kind) {
    case 'dissolve':
      // 편집기의 교차 녹아들기와 같다 — 나가는 장면은 그대로 두고 들어오는 장면이 그 위로 차오른다(가운데가 어두워지지 않게).
      return phase === 'in' ? { ...NO_EFFECT, opacity: e } : NO_EFFECT;
    case 'push': {
      // 두 장면이 같은 쪽으로 함께 간다 — 들어오는 장면은 그 반대편에서 온다.
      const u = unit(transitionDirection(kind, direction) ?? 'left');
      const k = phase === 'in' ? -(1 - e) : e;
      return { ...NO_EFFECT, dx: u.x * k * size.width || 0, dy: u.y * k * size.height || 0 };
    }
    case 'zoom':
      return phase === 'in'
        ? { ...NO_EFFECT, opacity: e, scale: ZOOM_IN_FROM + (1 - ZOOM_IN_FROM) * e }
        : { ...NO_EFFECT, scale: 1 + (ZOOM_OUT_TO - 1) * e };
    case 'wipe':
      // 들어오는 장면이 한쪽부터 드러난다(나가는 장면은 그 아래 그대로).
      return phase === 'in' ? { ...NO_EFFECT, clip: wipeRect(transitionDirection(kind, direction) ?? 'right', e, size) } : NO_EFFECT;
    case 'iris':
      // 들어오는 장면이 가운데에서 커지는 원 안으로 드러난다 — 끝 반지름은 모서리까지(대각선의 반).
      return phase === 'in'
        ? { ...NO_EFFECT, circle: { cx: size.width / 2, cy: size.height / 2, r: (e * Math.hypot(size.width, size.height)) / 2 } }
        : NO_EFFECT;
    case 'blur': {
      // 녹아들기와 같은 겹침(나가는 장면은 불투명한 채 아래) + 나가는 쪽은 흐려지고 들어오는 쪽은 또렷해진다.
      const max = transitionBlurPx(size);
      return phase === 'in'
        ? { ...NO_EFFECT, opacity: e, blur: round1((1 - e) * max), scale: BLUR_SCALE + (1 - BLUR_SCALE) * e }
        : { ...NO_EFFECT, blur: round1(e * max), scale: 1 + (BLUR_SCALE - 1) * e };
    }
    case 'flash':
    case 'curtain':
      // 덧그림(빛·막)이 화면을 다 가린 가운데에서 장면이 바뀐다.
      return phase === 'in' ? { ...NO_EFFECT, opacity: p >= 0.5 ? 1 : 0 } : { ...NO_EFFECT, opacity: p < 0.5 ? 1 : 0 };
    case 'cut':
    default:
      return NO_EFFECT;
  }
}

/** 빛 번짐 덧그림의 불투명도 — 가운데에서 1, 양 끝에서 0. */
export function flashAlpha(p: number): number {
  const x = Math.max(0, Math.min(1, p));
  return 1 - Math.abs(2 * x - 1);
}

/**
 * 가림막 덧그림(화면 크기 사각형)의 자리 이동 — 화면 밖 한쪽에서 들어와 가운데(p=0.5)에서 화면을 다 덮고 반대쪽으로 나간다.
 * 막의 앞 가장자리가 나가는 장면을 덮고 뒤 가장자리가 들어오는 장면을 드러내므로 잘라 보이기 없이 이동만으로 닦인다(합성기 예약이 된다 — 41-3).
 */
export function curtainOffset(p: number, size: VideoDoc['size'], direction?: TransitionDirection): { readonly dx: number; readonly dy: number } {
  const u = unit(transitionDirection('curtain', direction) ?? 'right');
  const along = 2 * easeInOutCubic(p) - 1;
  return { dx: u.x * along * size.width || 0, dy: u.y * along * size.height || 0 };
}

/** 사각형 둘의 겹친 곳(없으면 폭·높이 0). */
export function intersectRect(a: TransitionRect, b: TransitionRect): TransitionRect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const btm = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, r - x), height: Math.max(0, btm - y) };
}

/**
 * 문서 픽셀의 원을 상자 안 좌표로 옮긴다 — DOM `clip-path` 는 상자의 `rotate() scale()`(가운데 기준) **앞**에 걸리므로 그 변환을 되돌려야
 * canvas(문서 좌표에서 자른다)와 같은 자리가 잘린다. 원은 돌려도 원이라 정확하다.
 */
export function circleInBox(
  circle: TransitionCircle,
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rotation: number; readonly scale: number },
): TransitionCircle {
  if (!(box.scale > 0)) return { cx: box.width / 2, cy: box.height / 2, r: 0 };
  const rad = (-box.rotation * Math.PI) / 180;
  const vx = (circle.cx - (box.x + box.width / 2)) / box.scale;
  const vy = (circle.cy - (box.y + box.height / 2)) / box.scale;
  return {
    cx: box.width / 2 + vx * Math.cos(rad) - vy * Math.sin(rad),
    cy: box.height / 2 + vx * Math.sin(rad) + vy * Math.cos(rad),
    r: circle.r / box.scale,
  };
}
