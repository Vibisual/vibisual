/**
 * §5.1 #2-1 (G) — **미리보기 성능 기준**(순수). 앱을 무겁게 하는 미리보기는 굽지 않고 갈래 아이콘으로 둔다.
 *
 * - ① 파일 기준: 종류별 크기 상한 · 그림 픽셀 상한(머리만 읽어 판정) — `previewTooLarge` · `imageHeaderSize`.
 * - ② 화면 기준 · ③ 한눈 기준: 화면에서 작게 보이면 아이콘, 한 화면 속 상한 — `selectPreviewGrants`.
 * - ④ 시각 기준(움직이는 동안 굽지 않기)은 클라 기억 장소(`appThumbnails`)의 몫이다 — 시각을 읽으므로 여기 없다.
 *
 * 수치는 `PREVIEW_POLICY` 한 곳(§3.3). DOM·시각·플랫폼을 읽지 않는다 — 단위 시험으로 고정한다.
 */

import { PREVIEW_POLICY } from './constants.js';
import { fileFaceExtOf, fileFaceKindOf } from './fileFace.js';
import type { FileFaceKind } from './types.js';

/** 굽는 줄 — 종류별 동시 건수(`PREVIEW_POLICY.laneConcurrency`)를 따로 센다. */
export type PreviewLane = 'image' | 'video' | 'audio' | 'model';

/** 미디어 종류의 줄. 미디어가 아니면 `null`(굽지 않는다). */
export function previewLaneOf(kind: FileFaceKind): PreviewLane | null {
  return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'model' ? kind : null;
}

/** 이 파일의 크기 상한(bytes). 상한이 없는 종류(영상 — 구간 읽기)·미디어가 아닌 것은 `null`. */
export function previewByteCap(filePath: string): number | null {
  const kind = fileFaceKindOf(filePath);
  const ext = fileFaceExtOf(filePath);
  const caps = PREVIEW_POLICY.maxBytes;
  switch (kind) {
    case 'image':
      return ext === '.svg' || ext === '.svgz' ? caps.svg : caps.image;
    case 'audio':
      return PREVIEW_POLICY.audioPcmExtensions.includes(ext) ? caps.audioPcm : caps.audioCompressed;
    case 'model':
      return caps.model;
    default:
      return null;
  }
}

/** ① 크기 기준을 넘는가. 크기를 모르면(`undefined`) 여기서는 막지 않는다 — 굽는 함수가 먼저 크기를 묻는다. */
export function previewTooLarge(filePath: string, bytes: number | undefined | null): boolean {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return false;
  const cap = previewByteCap(filePath);
  return cap !== null && bytes > cap;
}

/** ① 픽셀 기준을 넘는가(머리에서 읽은 가로×세로). */
export function previewTooManyPixels(size: { readonly width: number; readonly height: number } | null): boolean {
  if (size === null) return false;
  return size.width * size.height > PREVIEW_POLICY.imageMaxPixels;
}

function u16be(b: Uint8Array, i: number): number {
  return ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
}
function u16le(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
}
function u24le(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
}
function u32be(b: Uint8Array, i: number): number {
  return (((b[i] ?? 0) << 24) >>> 0) + ((b[i + 1] ?? 0) << 16) + ((b[i + 2] ?? 0) << 8) + (b[i + 3] ?? 0);
}
function i32le(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16) | ((b[i + 3] ?? 0) << 24);
}

/**
 * ① 그림의 **머리만 읽어** 가로×세로를 안다 — PNG(APNG) · JPEG · GIF · WebP(VP8 · VP8L · VP8X) · BMP. 그 밖(AVIF·ICO·SVG)이거나
 * 머리가 모자라면 `null`(크기 기준만 적용한다). 형식마다 다른 규칙을 이 한 곳에서만 진다.
 */
export function imageHeaderSize(head: Uint8Array): { width: number; height: number } | null {
  const b = head;
  if (b.length < 26) return null;
  const ok = (w: number, h: number): { width: number; height: number } | null =>
    Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { width: w, height: h } : null;
  // PNG — 8바이트 서명 뒤 IHDR(가로·세로 빅엔디언).
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ok(u32be(b, 16), u32be(b, 20));
  // GIF — "GIF8" 뒤 논리 화면 크기(리틀엔디언).
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return ok(u16le(b, 6), u16le(b, 8));
  // BMP — "BM" 뒤 DIB 머리의 가로·세로(세로는 음수면 위에서 아래로 쌓인 것).
  if (b[0] === 0x42 && b[1] === 0x4d) return ok(Math.abs(i32le(b, 18)), Math.abs(i32le(b, 22)));
  // WebP — "RIFF....WEBP" + 덩어리 머리.
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const chunk = String.fromCharCode(b[12] ?? 0, b[13] ?? 0, b[14] ?? 0, b[15] ?? 0);
    if (chunk === 'VP8X') return ok(u24le(b, 24) + 1, u24le(b, 27) + 1);
    if (chunk === 'VP8 ') return ok(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
    if (chunk === 'VP8L') {
      const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
      return ok((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    return null;
  }
  // JPEG — SOF 표식(0xC0~0xCF, DHT·JPG·DAC 제외)을 찾아 세로·가로(빅엔디언).
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1] ?? 0;
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = u16be(b, i + 2);
      if (len < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return ok(u16be(b, i + 7), u16be(b, i + 5));
      }
      i += 2 + len;
    }
    return null;
  }
  return null;
}

// ─── ② 화면 기준 · ③ 한눈 기준 ───

export interface PreviewCandidate {
  readonly id: string;
  /** 캔버스 좌표의 지름(px) — 화면 지름은 여기에 줌을 곱한다. */
  readonly diameter: number;
  /** 지금 도는 것인가(같은 크기면 먼저). */
  readonly active?: boolean;
  /** 마지막 활동 시각(같으면 최근 것 먼저). */
  readonly last?: number;
}

export interface PreviewGrantOptions {
  readonly minScreenPx?: number;
  readonly showScreenPx?: number;
  readonly maxOnScreen?: number;
}

/**
 * ②③ — 지금 화면에서 **미리보기를 그릴 것**을 고른다. 화면 지름이 문턱 아래면 아이콘이고(이미 그리던 것은 `minScreenPx`,
 * 새로 켜는 것은 `showScreenPx` — 줌 경계에서 깜빡이지 않게), 남은 것 중 **크게 보이는 것부터** `maxOnScreen` 까지다
 * (같으면 지금 도는 것 → 최근 → id). 같은 입력은 같은 답이다.
 */
export function selectPreviewGrants(
  candidates: readonly PreviewCandidate[],
  zoom: number,
  previous: ReadonlySet<string>,
  opts: PreviewGrantOptions = {},
): Set<string> {
  const minPx = opts.minScreenPx ?? PREVIEW_POLICY.minScreenPx;
  const showPx = Math.max(minPx, opts.showScreenPx ?? PREVIEW_POLICY.showScreenPx);
  const max = Math.max(0, opts.maxOnScreen ?? PREVIEW_POLICY.maxOnScreen);
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const eligible: Array<{ c: PreviewCandidate; px: number }> = [];
  for (const c of candidates) {
    const px = c.diameter * z;
    const threshold = previous.has(c.id) ? minPx : showPx;
    if (px >= threshold) eligible.push({ c, px });
  }
  eligible.sort((a, b) => (b.px - a.px)
    || (Number(b.c.active === true) - Number(a.c.active === true))
    || ((b.c.last ?? 0) - (a.c.last ?? 0))
    || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0));
  return new Set(eligible.slice(0, max).map((e) => e.c.id));
}
