/**
 * §5.13 (AA) 42-2 — 결과 파일 이름 (순수).
 *
 * 이름 규칙(`{title} - {scene}`)을 풀고, 세 OS 어디서나 쓸 수 있는 이름으로 다듬는다. **한 규칙**이다 — 리눅스에서 만든 파일을
 * 윈도우로 옮겨도 열려야 하므로 가장 엄한 쪽(Windows)의 규칙을 모든 OS 에 그대로 건다(플랫폼 분기가 없어 어느 개발기에서도
 * 시험이 같은 답을 낸다).
 */

import { EXPORT_FILE_NAME_MAX_BYTES } from './constants.js';
import type { VideoFormatId } from './types.js';

/** 이름 규칙이 받는 자리 값. */
export interface RenderNameContext {
  readonly title: string;
  readonly docId: string;
  readonly format: VideoFormatId | null;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly scene: string | null;
  /** 한 번에 건 일감 안의 순번(0 부터). 없으면 `{n}` 은 비운다. */
  readonly index: number | null;
  readonly at: Date;
}

/** 이름 규칙에서 쓸 수 있는 자리(설정 창의 칩이 같은 목록을 그린다). */
export const RENDER_NAME_TOKENS: readonly string[] = ['{title}', '{scene}', '{format}', '{w}', '{h}', '{fps}', '{date}', '{time}', '{n}'];

/** 판형 → 이름에 쓰는 비율 글자(파일 이름에 `:` 는 못 쓴다). */
const FORMAT_TAG: Readonly<Record<VideoFormatId, string>> = { landscape: '16x9', portrait: '9x16', square: '1x1' };

const two = (n: number): string => String(n).padStart(2, '0');

/** 규칙을 푼다 — 모르는 자리는 그대로 남는다(그 뒤 다듬기가 글자를 고친다). */
export function buildRenderFileName(template: string, ctx: RenderNameContext): string {
  const d = ctx.at;
  const values: Readonly<Record<string, string>> = {
    '{title}': ctx.title.trim() || ctx.docId,
    '{scene}': ctx.scene ?? '',
    '{format}': ctx.format ? FORMAT_TAG[ctx.format] : '',
    '{w}': String(ctx.width),
    '{h}': String(ctx.height),
    '{fps}': String(ctx.fps),
    '{date}': `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`,
    '{time}': `${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`,
    '{n}': ctx.index === null ? '' : two(ctx.index + 1),
  };
  // 빈 자리는 표식으로 두었다가 그 앞의 구분자와 함께 걷는다(`{title} - {scene}` 에 장면이 없으면 `제목` — 사람이 적은 `--` 는 그대로).
  const EMPTY = '\u0000';
  const filled = template.replace(/\{(title|scene|format|w|h|fps|date|time|n)\}/g, (token) => {
    const value = values[token];
    return value === undefined ? token : value === '' ? EMPTY : value;
  });
  return filled.replace(/[ \t]*[-_·]?[ \t]*\u0000/g, '').replace(/^[\s\-_·]+|[\s\-_·]+$/g, '');
}

/** UTF-8 바이트 길이. */
export function utf8Bytes(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/** 글자를 쪼개지 않고 바이트 상한까지 자른다. */
function clipBytes(text: string, max: number): string {
  let out = '';
  let n = 0;
  for (const ch of text) {
    const size = utf8Bytes(ch);
    if (n + size > max) break;
    out += ch;
    n += size;
  }
  return out;
}

/** Windows 예약 이름(확장자가 붙어도 예약이다). */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * 세 OS 공통으로 쓸 수 있는 이름(확장자 앞 몫). `<>:"/\|?*`·제어 글자 → `_` · 끝의 점·공백을 걷고 · 예약 이름은 `_` 를 붙이고 ·
 * UTF-8 `EXPORT_FILE_NAME_MAX_BYTES` 까지. 다듬은 결과가 비면 `fallback`(그것도 다듬는다).
 */
export function sanitizeFileName(name: string, fallback: string): string {
  const clean = (text: string): string => {
    // eslint-disable-next-line no-control-regex -- 파일 이름에 못 쓰는 제어 글자를 바꾸는 것이 목적이다.
    let s = text.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/\s+/g, ' ').trim();
    s = clipBytes(s, EXPORT_FILE_NAME_MAX_BYTES).replace(/[. ]+$/g, '').trim();
    if (RESERVED.test(s)) s = `${s}_`;
    return s;
  };
  const first = clean(name);
  if (first !== '' && !/^[._]+$/.test(first)) return first;
  const second = clean(fallback);
  return second !== '' ? second : 'video';
}

/** `이름` → `이름 (n)`(n ≤ 1 이면 그대로). 바이트 상한 안으로 앞을 줄인다. */
export function numberedName(base: string, n: number): string {
  if (n <= 1) return base;
  const suffix = ` (${n})`;
  return `${clipBytes(base, EXPORT_FILE_NAME_MAX_BYTES - utf8Bytes(suffix)).trimEnd()}${suffix}`;
}

/** 같은 폴더에서 비어 있는 첫 이름(`exists` 가 그 자리를 답한다). 999 를 넘으면 시각을 붙인다. */
export function firstFreeName(base: string, ext: string, exists: (fileName: string) => boolean, now: number = Date.now()): string {
  for (let n = 1; n <= 999; n += 1) {
    const candidate = `${numberedName(base, n)}.${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return `${numberedName(base, 1)}-${now.toString(36)}.${ext}`;
}
