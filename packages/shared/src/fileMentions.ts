/**
 * §5.1 #2-1 (C) — 글 파일의 내용이 **이름으로 적고 있는** 다른 파일을 찾는다(순수).
 *
 * "이 컴포지션 json 이 저 그림·소리를 쓴다", "이 렌더 스크립트가 저 mp4 를 만든다" — 경로 계층으로는 보이지 않는
 * 관계 중 가장 강한 증거가 내용 안의 파일 이름이다. 서버가 앞부분만 비동기로 읽어(`CONSTELLATION.scanMaxBytes`) 이
 * 모듈로 이름 낱말을 뽑고, 같은 프로젝트의 파일 노드로 푼다. 판정은 순수 함수라 시험으로 고정한다.
 *
 * - **뽑기**는 넓게, **풀기**는 좁게 — 파일 이름처럼 생긴 낱말(`이름.확장자`, 앞에 경로가 붙어도 된다)을 모두 뽑되,
 *   알려진 얼굴의 확장자가 아니면 버린다(`window.location`·`this.state`·`1.5` 같은 코드 조각이 걸리지 않게).
 * - 풀 때는 **가장 긴 접미부터** 맞춘다 — 경로를 적었으면 경로로, 이름만 적었으면 그 이름이 하나뿐일 때만 잇는다.
 *   하나로 좁혀지지 않으면 잇지 않는다(판단이 서지 않으면 묶지 않는다).
 * - 경로 비교는 `pathKey`(플랫폼 인자 — 멀티플랫폼 1축). linux 는 `Logo.png` 와 `logo.png` 를 다른 파일로 본다.
 */

import { CONSTELLATION, CONSTELLATION_SCAN_MODEL_EXTENSIONS, CONSTELLATION_SCAN_SKIP_EXTENSIONS } from './constants.js';
import { fileFaceExtOf, fileFaceKindOf } from './fileFace.js';
import { normalizePathShape, pathKey, type PlatformName } from './pathCase.js';

/**
 * 내용 언급을 **읽을** 글 파일인가 — 코드·데이터·문서·자막 + 텍스트로 된 3D 형식(gltf·obj·dae).
 * 바이너리 문서와 잠금 파일은 뺀다(`CONSTELLATION_SCAN_SKIP_EXTENSIONS`). 미디어 바이너리는 애초에 대상이 아니다.
 */
export function isMentionScannablePath(filePath: string): boolean {
  const ext = fileFaceExtOf(filePath);
  if (CONSTELLATION_SCAN_SKIP_EXTENSIONS.includes(ext)) return false;
  if (CONSTELLATION_SCAN_MODEL_EXTENSIONS.includes(ext)) return true;
  const kind = fileFaceKindOf(filePath);
  return kind === 'code' || kind === 'data' || kind === 'doc' || kind === 'subtitle';
}

/**
 * 파일 이름처럼 생긴 낱말 — `[경로/]이름.확장자`. 따옴표·괄호·쉼표·공백·`:`(드라이브·URL 머리)에서 끊긴다.
 * 확장자 뒤에 글자가 이어지면(`file.tsxa`) 낱말이 아니다.
 */
const MENTION_TOKEN_DELIMITER = /[\s"'`<>()[\]{},;|*?=:]/;
const MENTION_EXTENSION_CHAR = /[A-Za-z0-9]/;
const MENTION_EXTENSION_MAX_LENGTH = 6;

/** 확장자 문법은 종전과 같다. 점마다 최대 7글자만 확인해 긴 낱말도 되짚지 않는다. */
function mentionExtensionEnd(text: string, dot: number): number {
  let end = dot + 1;
  while (end - dot <= MENTION_EXTENSION_MAX_LENGTH && MENTION_EXTENSION_CHAR.test(text[end] ?? '')) end += 1;
  if (end === dot + 1 || MENTION_EXTENSION_CHAR.test(text[end] ?? '') || text[end] === '_') return 0;
  return end;
}

/** 내용에서 파일 이름 낱말을 뽑는다(앞에서부터 `max` 개 · 중복 제거 · 구분자는 `/` · 앞의 `./` 는 걷는다). */
export function extractFileMentions(text: string, max: number = CONSTELLATION.scanTokenMax): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (max <= 0 || text === '') return out;
  let tokenStart = 0;
  let basenameStart = 0;
  let tokenEnd = 0;
  // 구분자 사이를 한 번만 훑는다. 종전 greedy 낱말처럼 마지막 유효 확장자까지 한 경로로 잡되,
  // 확장자가 없는 base64/긴 경로에서 시작점을 옮기며 같은 뒷부분을 반복 탐색하지 않는다(O(n)).
  for (let i = 0; i <= text.length; i += 1) {
    const char = text[i] ?? '';
    if (i === text.length || MENTION_TOKEN_DELIMITER.test(char)) {
      if (tokenEnd > tokenStart) {
        const token = text.slice(tokenStart, tokenEnd).replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^(?:\.\/)+/, '');
        if (token !== '' && !seen.has(token) && fileFaceKindOf(token) !== 'other') {
          seen.add(token);
          out.push(token);
          if (out.length >= max) break;
        }
      }
      tokenStart = i + 1;
      basenameStart = tokenStart;
      tokenEnd = 0;
    } else if (char === '/' || char === '\\') {
      basenameStart = i + 1;
    } else if (char === '.' && i > basenameStart) {
      const end = mentionExtensionEnd(text, i);
      if (end !== 0) tokenEnd = end;
    }
  }
  return out;
}

/** 풀 대상 파일 하나. `path` 는 같은 판정 안에서 한 가지 형식이면 된다(절대 또는 루트 기준 상대). */
export interface MentionCandidate {
  readonly id: string;
  readonly path: string;
}

/** 이름 낱말 → 그 파일 노드 id(자기 자신 제외 · 앞에서부터 `max` 개). */
export type MentionResolver = (tokens: readonly string[], selfId: string) => string[];

function segmentsOf(p: string): string[] {
  return normalizePathShape(p)
    .split('/')
    .filter((s) => s !== '' && s !== '.' && s !== '..');
}

/**
 * 후보 목록에서 한 번 색인을 짓고, 그 색인으로 여러 파일의 낱말을 푼다(스냅샷 한 번에 한 벌).
 * 경로 조각을 끝부터 색인한다(`c.png` → `b` → `a`). 모든 접미 문자열을 복사하지 않아
 * 후보 색인과 낱말 해소 모두 경로 길이에 비례한다. 파일 이름/경로 길이를 잘라 버리지 않는다.
 */
export function createMentionResolver(
  candidates: readonly MentionCandidate[],
  platform: PlatformName,
  max: number = CONSTELLATION.mentionMax,
): MentionResolver {
  interface SuffixNode {
    readonly children: Map<string, SuffixNode>;
    /** 이 접미의 유일한 후보. 서로 다른 id가 둘 이상이면 null(모호함). */
    id: string | null;
  }
  const root: SuffixNode = { children: new Map(), id: null };
  for (const c of candidates) {
    const segs = segmentsOf(pathKey(c.path, platform)).reverse();
    let node = root;
    for (const key of segs) {
      let child = node.children.get(key);
      if (!child) {
        child = { children: new Map(), id: c.id };
        node.children.set(key, child);
      } else if (child.id !== c.id) child.id = null;
      node = child;
    }
  }
  return (tokens, selfId) => {
    const out: string[] = [];
    if (max <= 0) return out;
    for (const raw of tokens) {
      const segs = segmentsOf(pathKey(raw, platform)).reverse();
      let node = root;
      // 끝에서 거슬러 갈 수 있는 가장 깊은 자리 = 종전의 가장 긴 접미.
      // 그 자리가 모호하거나 자기 자신이면 짧은 접미의 남의 파일로 되돌아가지 않는다.
      for (const key of segs) {
        const child = node.children.get(key);
        if (!child) break;
        node = child;
      }
      const hit = node.id;
      if (hit !== null && hit !== selfId && !out.includes(hit)) {
        out.push(hit);
        if (out.length >= max) break;
      }
    }
    return out;
  };
}
