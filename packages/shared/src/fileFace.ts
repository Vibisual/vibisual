/** §5.1 #2-1 (A) — 파일 버블 얼굴 판정(순수): 경로 → 종류, 별자리용 이름 조각(줄기·낱말). 서버(위성 상한)·클라(그리기)가 같은 답을 내게 shared 에 둔다. */

import {
  CONSTELLATION,
  CONSTELLATION_STOP_TOKENS,
  FILE_FACE_BASE_FAMILY,
  FILE_FACE_EXTENSIONS,
  FILE_FACE_FAMILY_EXTENSIONS,
  FILE_FACE_MEDIA_KINDS,
} from './constants.js';
import type { FileFaceFamily, FileFaceKind } from './types.js';

/** 한글·한자·가나 — 이 글자가 든 낱말은 두 글자부터 이름 갈래로 친다(`familyTokenMinCjk`). */
const CJK_CHAR = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** 확장자 → 얼굴. 표의 앞 갈래가 이긴다(한 확장자는 한 얼굴). */
const FACE_BY_EXT: ReadonlyMap<string, FileFaceKind> = (() => {
  const map = new Map<string, FileFaceKind>();
  const entries = Object.entries(FILE_FACE_EXTENSIONS) as Array<[Exclude<FileFaceKind, 'other'>, readonly string[]]>;
  for (const [kind, exts] of entries) {
    for (const ext of exts) if (!map.has(ext)) map.set(ext, kind);
  }
  return map;
})();

/** §5.1 #2-1 (G) ⑤ — 확장자 → 갈래. 표의 앞 갈래가 이긴다(한 확장자는 한 갈래). 기본 갈래는 표에 없다. */
const FAMILY_BY_EXT: ReadonlyMap<string, FileFaceFamily> = (() => {
  const map = new Map<string, FileFaceFamily>();
  const entries = Object.entries(FILE_FACE_FAMILY_EXTENSIONS) as Array<[FileFaceFamily, readonly string[]]>;
  for (const [family, exts] of entries) {
    for (const ext of exts) if (!map.has(ext)) map.set(ext, family);
  }
  return map;
})();

/** 경로의 마지막 조각(파일 이름). 구분자는 `/`·`\` 둘 다. 끝 구분자는 무시한다. */
export function fileBaseName(filePath: string): string {
  const parts = filePath.split(/[/\\]/).filter((p) => p !== '');
  return parts[parts.length - 1] ?? '';
}

/** 소문자 확장자(마침표 포함, 없으면 ''). `.env` 처럼 점 하나로 시작하는 이름은 이름 전체가 확장자다(열기용 `workspaceFileExt` 와 일부러 다르다). */
export function fileFaceExtOf(filePath: string): string {
  const name = fileBaseName(filePath);
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  if (dot === 0) return name.toLowerCase();
  return name.slice(dot).toLowerCase();
}

/** 이 파일의 얼굴. 표에 없는 확장자는 `other`(종전 파일 버블 그대로). */
export function fileFaceKindOf(filePath: string): FileFaceKind {
  const ext = fileFaceExtOf(filePath);
  return ext === '' ? 'other' : FACE_BY_EXT.get(ext) ?? 'other';
}

/**
 * §5.1 #2-1 (G) ⑤ — 이 파일의 **갈래**(아이콘). 갈래 표에 있으면 그 갈래, 없으면 그 종류의 기본 갈래다.
 * 미리보기가 없는 모든 자리(굽지 않는 형식 · 성능 기준이 막았을 때 · 굽는 중)가 이 갈래의 아이콘을 쓴다.
 */
export function fileFaceFamilyOf(filePath: string): FileFaceFamily {
  const ext = fileFaceExtOf(filePath);
  const family = ext === '' ? undefined : FAMILY_BY_EXT.get(ext);
  return family ?? FILE_FACE_BASE_FAMILY[fileFaceKindOf(filePath)];
}

/** 버블 안에 미리보기를 굽는 미디어(영상·사진·소리·3D)인가. */
export function isMediaFaceKind(kind: FileFaceKind): kind is 'video' | 'image' | 'audio' | 'model' {
  return FILE_FACE_MEDIA_KINDS.has(kind);
}

/** 이름 줄기 — 첫 점 앞, 소문자(`teaser.composition.json` → `teaser`). 소문자 접기는 뜻 비교라 `pathKey` 대상이 아니다(경로 비교는 `constellation.ts`). */
export function fileStemOf(filePath: string): string {
  const name = fileBaseName(filePath);
  const dot = name.indexOf('.');
  if (dot === 0) return '';
  return (dot < 0 ? name : name.slice(0, dot)).toLowerCase();
}

/**
 * 줄기의 **낱말**(이름 갈래 판정용) — 기호·공백·camelCase 경계에서 쪼개 소문자로. 짧은 것(`familyTokenMin` 미만)·
 * 숫자뿐인 것·흔한 낱말(`CONSTELLATION_STOP_TOKENS`)은 뺀다. `teaserIntro_v2.tsx` → `['teaser', 'intro']`.
 */
export function stemTokensOf(filePath: string): string[] {
  const name = fileBaseName(filePath);
  const dot = name.indexOf('.');
  if (dot === 0) return [];
  const stem = dot < 0 ? name : name.slice(0, dot);
  const out: string[] = [];
  for (const chunk of stem.split(/[^\p{L}\p{N}]+/u)) {
    if (chunk === '') continue;
    for (const piece of chunk.split(/(?<=[\p{Ll}\p{N}])(?=\p{Lu})/u)) {
      const token = piece.toLowerCase();
      const min = CJK_CHAR.test(token) ? CONSTELLATION.familyTokenMinCjk : CONSTELLATION.familyTokenMin;
      if (token.length < min) continue;
      if (/^\p{N}+$/u.test(token)) continue;
      if (CONSTELLATION_STOP_TOKENS.has(token)) continue;
      if (!out.includes(token)) out.push(token);
    }
  }
  return out;
}

/** 줄기가 흔한 낱말이면 "같은 이름"의 근거가 되지 못한다(`index.html` 과 `index.png`). */
export function isMeaningfulStem(stem: string): boolean {
  return stem !== '' && !CONSTELLATION_STOP_TOKENS.has(stem) && !/^\p{N}+$/u.test(stem);
}
