/**
 * §5.13 (V) 37-8 — 장면 사이 **전환**의 표 (순수 — 우리가 쓴 것, 외부 라이브러리 0).
 *
 * 장면의 `transition{kind, duration}` 만큼 앞 장면과 겹치고(해소기 — `transitionOverlap`), 그 구간에서 그리기 목록이 두 장면의
 * 아이템에 효과를 입힌다. 효과는 배치에 얹는 값 다섯 — 불투명도 곱·가로/세로 이동·크기 곱·잘라 보이기(사각형) — 와, 빛 번짐의
 * 덧그림 하나뿐이라 세 백엔드(canvas2d·DOM 무대·html-in-canvas)와 컴포지션 상자가 **같은 표**를 쓴다(백엔드마다 다르게 보이지 않게).
 *
 * 진행률 p 는 겹침 구간 안의 0→1 이고 부드럽게 접힌다(`easeInOutCubic`). 들어오는 장면은 `in`, 나가는 장면은 `out` 이다.
 */
import type { TransitionKind, VideoDoc } from '../types.js';

export const TRANSITION_KINDS: readonly TransitionKind[] = ['cut', 'dissolve', 'push', 'zoom', 'flash', 'wipe'];

export interface TransitionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
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
}

export const NO_EFFECT: TransitionEffect = { opacity: 1, dx: 0, dy: 0, scale: 1, clip: null };

export function easeInOutCubic(p: number): number {
  const x = Math.max(0, Math.min(1, p));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** 확대 전환이 들어올 때의 시작 배율·나갈 때의 끝 배율. */
const ZOOM_IN_FROM = 1.12;
const ZOOM_OUT_TO = 0.92;

/**
 * 전환 `kind` 의 `phase`(들어옴/나감) 효과 — 진행률 `p`(0~1, 아직 접지 않은 값), 문서 크기 `size`.
 */
export function transitionEffect(kind: TransitionKind, phase: 'in' | 'out', p: number, size: VideoDoc['size']): TransitionEffect {
  const e = easeInOutCubic(p);
  switch (kind) {
    case 'dissolve':
      // 편집기의 교차 녹아들기와 같다 — 나가는 장면은 그대로 두고 들어오는 장면이 그 위로 차오른다(가운데가 어두워지지 않게).
      return phase === 'in' ? { ...NO_EFFECT, opacity: e } : NO_EFFECT;
    case 'push':
      return { ...NO_EFFECT, dx: phase === 'in' ? (1 - e) * size.width : -e * size.width };
    case 'zoom':
      return phase === 'in'
        ? { ...NO_EFFECT, opacity: e, scale: ZOOM_IN_FROM + (1 - ZOOM_IN_FROM) * e }
        : { ...NO_EFFECT, scale: 1 + (ZOOM_OUT_TO - 1) * e };
    case 'wipe':
      // 들어오는 장면이 왼쪽부터 드러난다(나가는 장면은 그 아래 그대로).
      return phase === 'in' ? { ...NO_EFFECT, clip: { x: 0, y: 0, width: e * size.width, height: size.height } } : NO_EFFECT;
    case 'flash':
      // 빛이 가장 밝은 가운데에서 장면이 바뀐다(덧그림이 그 순간을 가린다).
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

/** 사각형 둘의 겹친 곳(없으면 폭·높이 0). */
export function intersectRect(a: TransitionRect, b: TransitionRect): TransitionRect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const btm = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, r - x), height: Math.max(0, btm - y) };
}
