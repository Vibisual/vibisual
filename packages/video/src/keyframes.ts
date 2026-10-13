/**
 * §5.13 (W) 38-4 — 아이템 **상자**의 시간 곡선(순수).
 *
 * 컴포지션 안의 움직임은 여전히 코드다. 이 모듈은 실사·그림·글자·도형의 상자가 시간에 따라 움직이는 것(강조 줌·천천히 밀기·
 * 미끄럼)만 다룬다. 값은 기본 배치에 얹는 **상대값**이라 상자를 옮겨도, 판형을 바꿔도 움직임이 따라온다.
 *
 * 세 백엔드·고르기·검수가 모두 그리기 목록(`buildDrawList`)을 거치므로 계산은 여기 한 곳이다 — 미리보기와 렌더가 어긋나지 않게.
 */

import { PUNCH_IN_HOLD_SECONDS, PUNCH_IN_RAMP_SECONDS, PUNCH_IN_SCALE, SLOW_PUSH_SCALE } from './constants.js';
import type { KeyframeEase, VideoKeyframe } from './types.js';

/** 키프레임이 움직이는 속성들. */
export const KEYFRAME_PROPS = ['dx', 'dy', 'scale', 'rotation', 'opacity'] as const;
export type KeyframeProp = (typeof KEYFRAME_PROPS)[number];

/** 아무 키프레임도 적지 않은 속성의 값(상자 그대로). */
const IDENTITY: Readonly<Record<KeyframeProp, number>> = { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 };

export const KEYFRAME_EASES: readonly KeyframeEase[] = ['linear', 'in', 'out', 'inOut', 'hold'];

/** 그 시각의 상대값(상자에 얹는다). */
export type KeyframeState = Readonly<Record<KeyframeProp, number>>;

function clamp01(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

/** 구간 진행률 p(0~1) → 곡선 값. 기본은 `inOut` — 카메라 움직임이 사람 눈에 가장 자연스럽다. */
export function easeValue(ease: KeyframeEase | undefined, p: number): number {
  const x = clamp01(p);
  switch (ease ?? 'inOut') {
    case 'linear':
      return x;
    case 'in':
      return x * x * x;
    case 'out':
      return 1 - Math.pow(1 - x, 3);
    case 'hold':
      return x >= 1 ? 1 : 0;
    case 'inOut':
    default:
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }
}

/** 숫자로 쓸 수 있는 키프레임만, 시각 순으로. 같은 시각이면 문서에 적힌 순서. */
export function sortedKeyframes(keyframes: readonly VideoKeyframe[] | undefined): VideoKeyframe[] {
  if (!keyframes || keyframes.length === 0) return [];
  return keyframes
    .map((k, i) => ({ k, i }))
    .filter(({ k }) => k !== null && typeof k === 'object' && typeof k.t === 'number' && Number.isFinite(k.t))
    .sort((a, b) => a.k.t - b.k.t || a.i - b.i)
    .map(({ k }) => k);
}

function propValue(k: VideoKeyframe, prop: KeyframeProp): number | undefined {
  const v = k[prop];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * 시각 `t`(아이템 시작부터의 초)의 상대값. 속성마다 그 속성을 적은 키프레임끼리만 보간하고, 첫 키프레임 앞·마지막 뒤는
 * 가장 가까운 값을 유지한다. 곡선은 **들어오는 쪽** 키프레임의 `ease` 다.
 */
export function sampleKeyframes(keyframes: readonly VideoKeyframe[] | undefined, t: number): KeyframeState {
  const sorted = sortedKeyframes(keyframes);
  if (sorted.length === 0) return IDENTITY;
  const out: Record<KeyframeProp, number> = { ...IDENTITY };
  for (const prop of KEYFRAME_PROPS) {
    const points = sorted.filter((k) => propValue(k, prop) !== undefined);
    if (points.length === 0) continue;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (t <= first.t) { out[prop] = propValue(first, prop)!; continue; }
    if (t >= last.t) { out[prop] = propValue(last, prop)!; continue; }
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]!;
      const b = points[i]!;
      if (t > b.t) continue;
      const span = b.t - a.t;
      const p = span > 0 ? (t - a.t) / span : 1;
      const va = propValue(a, prop)!;
      const vb = propValue(b, prop)!;
      out[prop] = va + (vb - va) * easeValue(b.ease, p);
      break;
    }
  }
  return out;
}

/** 키프레임이 실제로 무언가를 움직이는가(적힌 값이 하나라도 있는가). */
export function hasKeyframes(keyframes: readonly VideoKeyframe[] | undefined): boolean {
  return sortedKeyframes(keyframes).some((k) => KEYFRAME_PROPS.some((p) => propValue(k, p) !== undefined));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000 || 0;
}

/**
 * 앞을 `delta` 초 잘라 낸 조각(분할의 오른쪽 · 앞 트림 · 대본 컷)이 쓸 키프레임. 시각을 `delta` 만큼 당기고, 잘린 지점의 값을
 * 0초 키프레임으로 남긴다(잘리기 전과 같은 자리에서 시작하게). 키프레임이 없으면 그대로(undefined).
 */
export function rebaseKeyframes(keyframes: readonly VideoKeyframe[] | undefined, delta: number): VideoKeyframe[] | undefined {
  const sorted = sortedKeyframes(keyframes);
  if (sorted.length === 0) return keyframes === undefined ? undefined : [];
  if (!Number.isFinite(delta) || delta === 0) return sorted.map((k) => ({ ...k }));
  const shifted = sorted.map((k) => ({ ...k, t: round4(k.t - delta) }));
  const kept = shifted.filter((k) => k.t > 0);
  if (delta < 0) return shifted;
  const at = sampleKeyframes(sorted, delta);
  const start: Record<string, number | string> = { t: 0 };
  for (const prop of KEYFRAME_PROPS) {
    if (sorted.some((k) => propValue(k, prop) !== undefined)) start[prop] = round4(at[prop]);
  }
  return [start as unknown as VideoKeyframe, ...kept];
}

/** 판형 파생 — dx·dy 를 비율 `s`(짧은 변 비율)로 옮긴다. 다른 값은 상대값이라 그대로. */
export function scaleKeyframes(keyframes: readonly VideoKeyframe[] | undefined, s: number): VideoKeyframe[] | undefined {
  if (!keyframes) return undefined;
  return keyframes.map((k) => ({
    ...k,
    ...(typeof k.dx === 'number' ? { dx: Math.round(k.dx * s * 100) / 100 || 0 } : {}),
    ...(typeof k.dy === 'number' ? { dy: Math.round(k.dy * s * 100) / 100 || 0 } : {}),
  }));
}

/**
 * [강조 줌] — 아이템 안 시각 `at`(초)에서 `PUNCH_IN_RAMP_SECONDS` 동안 `PUNCH_IN_SCALE` 로 키우고, `PUNCH_IN_HOLD_SECONDS` 유지한
 * 뒤 같은 시간에 돌아온다. 아이템 길이(`duration`) 안으로 줄인다. 기존 키프레임 중 그 구간과 겹치지 않는 것은 남긴다.
 */
export function punchInKeyframes(existing: readonly VideoKeyframe[] | undefined, at: number, duration: number): VideoKeyframe[] {
  const end = Math.max(0, duration);
  const t0 = Math.min(Math.max(0, at), Math.max(0, end - PUNCH_IN_RAMP_SECONDS));
  const t1 = Math.min(end, t0 + PUNCH_IN_RAMP_SECONDS);
  const t2 = Math.min(end, t1 + PUNCH_IN_HOLD_SECONDS);
  const t3 = Math.min(end, t2 + PUNCH_IN_RAMP_SECONDS);
  const before = sampleKeyframes(existing, t0).scale;
  const ours: VideoKeyframe[] = [
    { t: round4(t0), scale: round4(before), ease: 'linear' },
    { t: round4(t1), scale: round4(before * PUNCH_IN_SCALE), ease: 'out' },
    ...(t2 > t1 ? [{ t: round4(t2), scale: round4(before * PUNCH_IN_SCALE), ease: 'hold' as const }] : []),
    ...(t3 > t2 ? [{ t: round4(t3), scale: round4(before), ease: 'inOut' as const }] : []),
  ];
  const others = sortedKeyframes(existing).filter((k) => k.t < t0 - 1e-6 || k.t > t3 + 1e-6);
  return [...others, ...ours].sort((a, b) => a.t - b.t);
}

/** [천천히 밀기] — 아이템 처음부터 끝까지 배율 1 → `SLOW_PUSH_SCALE`(선형에 가까운 느린 이동 — 켄 번즈). 기존 배율 곡선을 갈아 끼운다. */
export function slowPushKeyframes(existing: readonly VideoKeyframe[] | undefined, duration: number): VideoKeyframe[] {
  const end = Math.max(0, duration);
  const others = sortedKeyframes(existing)
    .map((k) => { const { scale: _s, ...rest } = k; return rest as VideoKeyframe; })
    .filter((k) => KEYFRAME_PROPS.some((p) => p !== 'scale' && propValue(k, p) !== undefined));
  return [...others, { t: 0, scale: 1 }, { t: round4(end), scale: SLOW_PUSH_SCALE, ease: 'linear' as const }].sort((a, b) => a.t - b.t);
}
