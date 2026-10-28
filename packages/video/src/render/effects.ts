/**
 * §5.13 (W) 38-5 — `effects` 를 CSS 필터 문자열 하나와 비네트 세기로 접는다(순수). DOM 무대 `filter`·canvas2d `ctx.filter` 가 같은 문자열, 비네트는 같은 그라데이션 —
 * 세 백엔드가 같은 그림을 낸다. 모르는 종류는 건너뛴다(문서엔 남는다). 색온도는 필터 근사(색조이지 흰 균형이 아니다).
 */

import { VIDEO_LOOKS, type VideoLookName } from '../constants.js';
import type { VideoEffect } from '../types.js';

export interface EffectStyle {
  /** CSS 필터 문자열(없으면 빈 글자). */
  readonly filter: string;
  /** 비네트 세기 0~1(0 이면 그리지 않는다). */
  readonly vignette: number;
}

const NO_EFFECT: EffectStyle = { filter: '', vignette: 0 };

interface ColorParams {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  temperature: number;
  blur: number;
  vignette: number;
}

function num(params: Readonly<Record<string, unknown>> | undefined, key: string): number | undefined {
  const v = params?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000 || 0;
}

export function isVideoLookName(name: unknown): name is VideoLookName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(VIDEO_LOOKS, name);
}

/** 이펙트들을 차례로 접는다 — 곱은 곱하고, 더하는 값은 더한다(룩 + 손 보정이 겹친다). */
function fold(effects: readonly VideoEffect[]): ColorParams {
  const acc: ColorParams = { brightness: 1, contrast: 1, saturation: 1, hue: 0, temperature: 0, blur: 0, vignette: 0 };
  const applyColor = (p: Readonly<Record<string, unknown>> | Readonly<Partial<Record<string, number>>> | undefined): void => {
    const r = p as Readonly<Record<string, unknown>> | undefined;
    const b = num(r, 'brightness');
    const c = num(r, 'contrast');
    const s = num(r, 'saturation');
    const h = num(r, 'hue');
    const tmp = num(r, 'temperature');
    const v = num(r, 'vignette');
    if (b !== undefined) acc.brightness *= clamp(b, 0, 4);
    if (c !== undefined) acc.contrast *= clamp(c, 0, 4);
    if (s !== undefined) acc.saturation *= clamp(s, 0, 4);
    if (h !== undefined) acc.hue += h;
    if (tmp !== undefined) acc.temperature += clamp(tmp, -1, 1);
    if (v !== undefined) acc.vignette = Math.max(acc.vignette, clamp(v, 0, 1));
  };
  for (const e of effects) {
    if (!e || typeof e !== 'object') continue;
    switch (e.kind) {
      case 'look': {
        const name = e.params?.['name'];
        if (isVideoLookName(name)) applyColor(VIDEO_LOOKS[name]);
        break;
      }
      case 'color':
        applyColor(e.params);
        break;
      case 'blur': {
        const r = num(e.params, 'radius');
        if (r !== undefined) acc.blur += clamp(r, 0, 200);
        break;
      }
      case 'vignette': {
        const a = num(e.params, 'amount');
        if (a !== undefined) acc.vignette = Math.max(acc.vignette, clamp(a, 0, 1));
        break;
      }
      default:
        break;
    }
  }
  acc.temperature = clamp(acc.temperature, -1, 1);
  return acc;
}

/**
 * 이펙트 → CSS 필터 + 비네트. 순서는 고정이다(같은 문서 = 같은 문자열 = 같은 그림).
 *
 * 색온도 근사: 따뜻하게(+) = 세피아를 조금 얹고 색상을 노랑 쪽으로, 차갑게(−) = 색상을 파랑 쪽으로 돌리고 채도를 살짝 내린다.
 */
export function effectsToFilter(effects: readonly VideoEffect[] | undefined): EffectStyle {
  if (!effects || effects.length === 0) return NO_EFFECT;
  const p = fold(effects);
  const parts: string[] = [];
  if (p.brightness !== 1) parts.push(`brightness(${round3(p.brightness)})`);
  if (p.contrast !== 1) parts.push(`contrast(${round3(p.contrast)})`);
  let saturation = p.saturation;
  let hue = p.hue;
  if (p.temperature > 0) {
    parts.push(`sepia(${round3(0.3 * p.temperature)})`);
    saturation *= 1 + 0.12 * p.temperature;
    hue += -8 * p.temperature;
  } else if (p.temperature < 0) {
    saturation *= 1 + 0.08 * p.temperature;
    hue += -14 * p.temperature;
  }
  if (Math.abs(saturation - 1) > 1e-6) parts.push(`saturate(${round3(saturation)})`);
  if (Math.abs(hue) > 1e-6) parts.push(`hue-rotate(${round3(hue)}deg)`);
  if (p.blur > 0) parts.push(`blur(${round3(p.blur)}px)`);
  return { filter: parts.join(' '), vignette: round3(p.vignette) };
}

/**
 * 비네트 그라데이션의 정지점(세 백엔드 공용) — 가운데는 투명하고 가장자리로 갈수록 검다. `amount` 1 이면 가장자리 불투명도 0.85.
 */
export function vignetteStops(amount: number): ReadonlyArray<{ readonly at: number; readonly alpha: number }> {
  const a = clamp(amount, 0, 1);
  return [
    { at: 0, alpha: 0 },
    { at: 0.55, alpha: 0 },
    { at: 1, alpha: round3(0.85 * a) },
  ];
}

/** DOM 무대의 비네트 배경(CSS). */
export function vignetteCss(amount: number): string {
  const stops = vignetteStops(amount).map((s) => `rgba(0,0,0,${s.alpha}) ${Math.round(s.at * 100)}%`).join(', ');
  return `radial-gradient(ellipse at center, ${stops})`;
}
