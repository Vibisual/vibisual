/**
 * §5.13 (T-1)(T-3) — 컴포지션 경로 판정 (순수).
 *
 * 컴포지션 소재는 **프로젝트 루트 기준 상대 경로의 HTML 파일 하나**다. 그 파일이 있는 폴더가 컴포지션 폴더이고,
 * 그 안의 그림·글꼴·스크립트를 상대 경로로 쓴다. 이 파일은 문자열만 보고 판정한다 — 실제 파일이 프로젝트 안에
 * 있는지(심볼릭 링크·정션 포함)는 서버가 `realpath` 로 다시 본다(`server/composition.ts`).
 */

import { COMPOSITION_WEB_EXTENSIONS } from '../constants.js';

/** `/` 구분으로 바꾼다 — 문서에 적히는 경로는 늘 `/` 다(멀티플랫폼 — Windows 역슬래시를 그대로 적지 않는다). */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** HTML 파일인가(`.html`·`.htm`, 대소문자 무관). */
export function isCompositionHtmlPath(p: string): boolean {
  return /\.html?$/i.test(p.trim());
}

/**
 * 프로젝트 루트 기준 **상대** 경로인가 — 절대 경로·드라이브 문자·UNC·`..` 세그먼트는 아니다.
 * 컴포지션이 프로젝트 밖을 가리키면 내주는 범위(T-3 ①)가 프로젝트 밖으로 새기 때문에 문서 단계에서 걸러 낸다.
 */
export function isProjectRelativePath(p: string): boolean {
  const s = toPosixPath(p).trim();
  if (s === '' || s.startsWith('/') || /^[A-Za-z]:/.test(s)) return false;
  return !s.split('/').some((seg) => seg === '..');
}

/** 상대 경로의 폴더 부분(`a/b/index.html` → `a/b`). 루트 바로 아래 파일이면 빈 문자열. */
export function compositionFolderOf(p: string): string {
  const s = toPosixPath(p).trim();
  const cut = s.lastIndexOf('/');
  return cut < 0 ? '' : s.slice(0, cut);
}

/** 내주는 웹 형식인가(T-3 ②). 확장자는 소문자로 본다. */
export function isCompositionWebFile(p: string): boolean {
  const s = p.toLowerCase();
  const dot = s.lastIndexOf('.');
  if (dot < 0) return false;
  return COMPOSITION_WEB_EXTENSIONS.includes(s.slice(dot));
}

/** 웹 형식 → 응답 형식. 모르는 것은 `null`(내주지 않는다). */
export function compositionMimeType(p: string): string | null {
  const s = p.toLowerCase();
  const ext = s.slice(s.lastIndexOf('.'));
  switch (ext) {
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.avif':
      return 'image/avif';
    case '.woff2':
      return 'font/woff2';
    case '.woff':
      return 'font/woff';
    case '.ttf':
      return 'font/ttf';
    case '.otf':
      return 'font/otf';
    default:
      return null;
  }
}

/**
 * 컴포지션 폴더 이름으로 쓸 안전한 이름 — 영문·숫자·`-`·`_` 만 남기고 길이를 묶는다.
 * Windows 금지 문자·예약 이름·끝의 점과 공백을 피한다(T-12 — 멀티플랫폼 경로).
 */
export function safeCompositionName(raw: string): string {
  const base = raw
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40);
  const reserved = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
  if (base === '' || reserved.test(base)) return 'comp';
  return base;
}
