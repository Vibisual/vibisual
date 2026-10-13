/**
 * §5.13 (T-6)(V) 37-11 — **가져오기**(라이브러리·글꼴·컴포지션 묶음)의 순수 층: 목록 모양, 라이선스 찾기, 컴포지션에 넣을 태그.
 *
 * 우리는 어떤 애니메이션 라이브러리도 싣지 않는다((B)). 사용자가 고른 것을 **사용자의 프로젝트에** 들여놓는 길만 연다 —
 * 쓰기로 하는 것과 그 라이선스를 확인하는 것은 사용자의 몫이고, 우리는 찾은 라이선스를 그대로 보여 줄 뿐 판단하지 않는다.
 * 에이전트는 요청만 남기고(`requests`), 들여놓는 손은 사용자다(서버가 루프백 유입을 거절한다).
 */

export type LibKind = 'library' | 'font' | 'pack';
export type LibFormat = 'script' | 'module' | 'style' | 'font' | 'pack';

export interface LibVendored {
  readonly url: string;
  /** 그 묶음 폴더 기준 경로(`vendor/<sha16>-<이름>`). */
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly license?: string;
}

export interface LibItem {
  readonly id: string;
  readonly kind: LibKind;
  /** `vibi:libs` 에 적는 이름(글꼴이면 `font-family` 이름). */
  readonly name: string;
  readonly version?: string;
  /** 프로젝트 기준 폴더(`.vibisual/video/libs/<이름>` · 묶음이면 `.vibisual/video/compositions/<이름>`). */
  readonly folder: string;
  /** 폴더 기준 파일들. */
  readonly files: readonly string[];
  /** 폴더 기준 진입 파일(스크립트·스타일·글꼴·묶음의 HTML). */
  readonly entry?: string;
  readonly format: LibFormat;
  readonly source: { readonly kind: 'file' | 'url' | 'project'; readonly name?: string; readonly url?: string; readonly path?: string };
  readonly license?: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly addedAt: number;
  readonly vendored?: readonly LibVendored[];
}

export interface LibRequest {
  readonly id: string;
  readonly url: string;
  readonly reason: string;
  readonly from: 'agent' | 'user';
  readonly createdAt: number;
  readonly status: 'pending' | 'imported' | 'rejected';
}

export interface LibsFile {
  readonly schemaVersion: 1;
  readonly items: readonly LibItem[];
  readonly requests: readonly LibRequest[];
}

/** 주소로 받을 때 파일 하나의 상한. */
export const LIB_DOWNLOAD_MAX_BYTES = 24 * 1024 * 1024;
/** HTML 한 장 들여오기에서 묶음마다 받는 파일 수 상한. */
export const PACK_VENDOR_MAX_FILES = 40;

/** 파일 머리말·package.json·LICENSE 첫 줄에서 라이선스 이름을 찾는다(판단은 하지 않는다 — 보여 주기만). */
export function detectLicense(text: string): string | undefined {
  const head = text.slice(0, 4000);
  const spdx = /SPDX-License-Identifier:\s*([A-Za-z0-9.+\- ()]+?)\s*(?:\*\/|\n|$)/.exec(head);
  if (spdx?.[1]) return spdx[1].trim();
  const tag = /@license\s+([^\n*]+)/i.exec(head);
  if (tag?.[1]) return tag[1].trim().slice(0, 80);
  try {
    const pkg = JSON.parse(text) as { license?: unknown };
    if (typeof pkg.license === 'string') return pkg.license;
  } catch { /* 글이 JSON 이 아니다 */ }
  const first = head.split('\n').map((l) => l.trim()).find((l) => l !== '');
  if (first && /license/i.test(first) && first.length < 80) return first;
  return undefined;
}

/** 확장자로 형식을 가른다. */
export function libFormatOf(file: string, moduleHint = false): LibFormat {
  const f = file.toLowerCase();
  if (/\.(?:woff2?|ttf|otf)$/.test(f)) return 'font';
  if (f.endsWith('.css')) return 'style';
  if (f.endsWith('.mjs') || moduleHint) return 'module';
  return 'script';
}

/** `vibi:libs` 이름 하나로 쓸 안전한 이름. */
export function safeLibName(raw: string): string {
  return raw.trim().replace(/\.(?:min\.)?(?:js|mjs|css|woff2?|ttf|otf|zip)$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'lib';
}

function cssString(v: string): string {
  return v.replace(/["\\<>\n\r]/g, '');
}

/**
 * 컴포지션 문서 머리에 넣을 태그(런타임 심 **뒤**, 컴포지션 스크립트 **앞**). `names` 는 그 컴포지션의 `vibi:libs`. 글꼴은 이름을
 * 적지 않아도 늘 `@font-face` 로 선언한다(`font-family` 이름으로 바로 쓴다). `urlOf` 는 프로젝트 기준 경로 → 내주기 주소.
 */
export function libInjection(items: readonly LibItem[], names: readonly string[], urlOf: (projectRel: string) => string): string {
  const wanted = new Set(names.map((n) => n.trim().toLowerCase()).filter((n) => n !== ''));
  const parts: string[] = [];
  const faces: string[] = [];
  const imports: Record<string, string> = {};
  for (const item of items) {
    if (!item.entry || item.kind === 'pack') continue;
    const url = urlOf(`${item.folder}/${item.entry}`);
    if (item.format === 'font') {
      faces.push(`@font-face { font-family: "${cssString(item.name)}"; src: url("${cssString(url)}"); font-display: block; }`);
      continue;
    }
    if (!wanted.has(item.name.toLowerCase())) continue;
    if (item.format === 'style') parts.push(`<link rel="stylesheet" href="${cssString(url)}">`);
    else if (item.format === 'module') imports[item.name] = url;
    else parts.push(`<script src="${cssString(url)}"></script>`);
  }
  const map = Object.keys(imports).length > 0 ? `<script type="importmap">${JSON.stringify({ imports }).replace(/</g, '\\u003c')}</script>` : '';
  const style = faces.length > 0 ? `<style>${faces.join('\n')}</style>` : '';
  return `${map}${style}${parts.join('')}`;
}
