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
function u32le(b: Uint8Array, i: number): number {
  return i32le(b, i) >>> 0;
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

/**
 * §5.13 (R-9) · §5.1 #2-1 (G) ⑧ — JPEG 머리의 **EXIF 회전**(1~8, 모르면 1). 브라우저는 그림을 이 회전대로 세워 푼다
 * (`createImageBitmap` 기본값 · `<img>`) — 줄여 풀 크기를 정하려면 세운 뒤의 가로×세로가 필요하다. 다른 형식은 1 이다.
 */
export function imageHeaderOrientation(head: Uint8Array): number {
  const b = head;
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1] ?? 0;
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    // 화상 자료(SOS)·끝(EOI)부터는 머리가 없다.
    if (marker === 0xda || marker === 0xd9) return 1;
    const len = u16be(b, i + 2);
    if (len < 2) return 1;
    // APP1 "Exif\0\0" 뒤가 TIFF 머리다.
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66
      && b[i + 8] === 0 && b[i + 9] === 0) {
      const o = tiffOrientation(b, i + 10, Math.min(b.length, i + 2 + len));
      if (o !== null) return o;
    }
    i += 2 + len;
  }
  return 1;
}

/** TIFF 머리(`t` 부터 `end` 앞까지)의 첫 IFD 에서 회전 태그(0x0112)를 읽는다. 없거나 모양이 틀리면 null. */
function tiffOrientation(b: Uint8Array, t: number, end: number): number | null {
  if (t + 8 > end) return null;
  const little = b[t] === 0x49 && b[t + 1] === 0x49;
  const big = b[t] === 0x4d && b[t + 1] === 0x4d;
  if (!little && !big) return null;
  const r16 = (i: number): number => (little ? u16le(b, i) : u16be(b, i));
  const r32 = (i: number): number => (little ? u32le(b, i) : u32be(b, i));
  if (r16(t + 2) !== 42) return null;
  const ifd = t + r32(t + 4);
  if (ifd + 2 > end) return null;
  const count = r16(ifd);
  for (let k = 0; k < count; k += 1) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > end) return null;
    if (r16(e) !== 0x0112) continue;
    const value = r16(e + 8);
    return value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

/** EXIF 회전을 세운 뒤의 가로×세로 — 5~8 은 90도 돌아간 것이라 가로·세로가 바뀐다. */
export function orientedImageSize(
  size: { readonly width: number; readonly height: number },
  orientation: number,
): { width: number; height: number } {
  return orientation >= 5 && orientation <= 8
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

/**
 * §5.13 (R-9) — 머리로 보아 **움직이는 그림일 수 있는가** — GIF(전부 그렇다고 본다) · APNG(`IDAT` 앞의 `acTL` 덩어리) · 움직이는
 * WebP(VP8X 의 애니메이션 깃발). 줄여 풀면 첫 장만 남으므로 보기 창은 이것을 원본 그대로 그린다.
 */
export function imageHeaderAnimated(head: Uint8Array): boolean {
  const b = head;
  if (b.length < 21) return false;
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    let i = 8;
    while (i + 8 <= b.length) {
      const len = u32be(b, i);
      const type = String.fromCharCode(b[i + 4] ?? 0, b[i + 5] ?? 0, b[i + 6] ?? 0, b[i + 7] ?? 0);
      if (type === 'acTL') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      i += 12 + len;
    }
    return false;
  }
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
    && b[12] === 0x56 && b[13] === 0x50 && b[14] === 0x38 && b[15] === 0x58) {
    return ((b[20] ?? 0) & 0x02) !== 0;
  }
  return false;
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
