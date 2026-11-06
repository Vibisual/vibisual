/** 같은 화면의 미리보기 파일을 유형별로 묶는다. 경로 비교는 플랫폼별 pathKey를 공유한다. */

import { BUNDLE_BUBBLE, CONSTELLATION, EXTERNAL_NODE_KEY_MARK } from './constants.js';
import { fileFaceExtOf, fileFaceKindOf, isMediaFaceKind } from './fileFace.js';
import { normalizePathShape, pathKey, type PlatformName } from './pathCase.js';

/** 판정할 파일 하나. `path` 는 노드 키(외부 표식 포함 가능)나 경로 — 한 무리의 파일끼리 같은 형식이면 된다. */
export interface KindBundleFileInput {
  readonly id: string;
  readonly path: string;
  readonly lastActivity?: number | undefined;
}

export interface KindBundleOptions {
  readonly platform: PlatformName;
  /** 한 묶음의 구성 상한. 기본 `CONSTELLATION.moonMax`(한 중심이 거느리는 위성 상한과 같은 수). */
  readonly memberMax?: number;
  /** 루트 바로 아래 파일도 묶는다(메인 화면 원 둘레) — 그 묶음의 `dir` 은 빈 글자. 위성은 늘 폴더 안이라 서버는 안 쓴다. */
  readonly includeRoot?: boolean;
}

/** 묶음이 되는 미리보기 종류. */
export type KindBundleKind = 'video' | 'image' | 'audio' | 'model' | 'doc' | 'code';

export function isKindBundleKind(value: unknown): value is KindBundleKind {
  return value === 'video' || value === 'image' || value === 'audio' || value === 'model' || value === 'doc' || value === 'code';
}

/** 일반 텍스트와 별도로 미리보기하는 파일만 묶음·위성 상한 예외를 공유한다. */
export function previewBundleKindOf(filePath: string): KindBundleKind | null {
  const face = fileFaceKindOf(filePath);
  if (isMediaFaceKind(face)) return face;
  const ext = fileFaceExtOf(filePath);
  if (ext === '.pdf') return 'doc';
  if (ext === '.html' || ext === '.htm') return 'code';
  return null;
}

export function isPreviewBundleFile(filePath: string): boolean {
  return previewBundleKindOf(filePath) !== null;
}

export function bundleSatelliteKey(kind: KindBundleKind, sessionId?: string): string {
  return sessionId ? `${kind}:${sessionId}` : kind;
}

/** 세션별 표시 사본도 원본 파일의 선택·설정·삭제 경로를 공유한다. */
export function satelliteSourceNodeId(id: string): string {
  if (!id.startsWith('sat-')) return id;
  return id.slice(4).split(':preview-session:', 1)[0]!;
}

/** 묶음 하나 — 한 무리의 한 미디어 종류. */
export interface KindBundle {
  /** 묶음 열쇠 = 종류 이름(무리 안에서 종류마다 하나) — 공통 폴더가 움직여도 노드 id 가 다시 서지 않는다. 폴더까지 담은 열쇠는 `kindBundleDirToken`. */
  readonly token: string;
  readonly kind: KindBundleKind;
  /** 구성 파일이 함께 든 가장 가까운 폴더(외부 표식을 뗀 모양 · 글자는 첫 구성 그대로). 표시 이름은 `kindBundleNameOf`. */
  readonly dir: string;
  /** 구성 id — 최근 것부터, 상한까지. */
  readonly memberIds: readonly string[];
  /** 상한을 넘은 오래된 구성 id(최근 것부터). */
  readonly overflowIds: readonly string[];
}

/** 노드 키·경로에서 외부 표식(과 그 앞의 워크트리 접두)을 뗀 비교용 모양. 서버 `externalKeyParts` 와 같은 자리에서 가른다. */
export function kindBundlePathShape(p: string): string {
  const i = p.indexOf(EXTERNAL_NODE_KEY_MARK);
  return normalizePathShape(i >= 0 ? p.slice(i + EXTERNAL_NODE_KEY_MARK.length) : p);
}

function dirOf(shaped: string): string {
  const i = shaped.lastIndexOf('/');
  return i <= 0 ? '' : shaped.slice(0, i);
}

/** 묶음의 표시 이름 — 그 폴더의 마지막 조각(지어내지 않는다). 조각이 없으면 경로 그대로. */
export function kindBundleNameOf(dir: string): string {
  const i = dir.lastIndexOf('/');
  return i >= 0 && i < dir.length - 1 ? dir.slice(i + 1) : dir;
}

/**
 * 파일들이 함께 든 가장 가까운 폴더(외부 표식 뗀 모양) — 묶음 이름·툴팁 경로. 마디는 `pathKey` 로 견주고 글자는 첫 파일 것.
 * 없거나 하나라도 루트 바로 아래면 빈 글자, POSIX 절대 경로가 루트에서만 만나면 `/`.
 */
export function kindBundleCommonDir(paths: readonly string[], platform: PlatformName): string {
  let common: string[] | null = null;
  for (const p of paths) {
    const dir = dirOf(kindBundlePathShape(p));
    if (dir === '') return '';
    const segs = dir.split('/');
    if (common === null) {
      common = segs;
      continue;
    }
    let n = 0;
    while (n < common.length && n < segs.length && pathKey(common[n]!, platform) === pathKey(segs[n]!, platform)) n += 1;
    common = common.slice(0, n);
    if (common.length === 0) return '';
  }
  if (common === null) return '';
  // 빈 마디만 남았다 = 절대 경로의 머리에서만 만났다. POSIX 루트(`['']`)면 `/`, UNC 머리(`['', '']`)는 같은 서버가 아니다.
  if (common.every((s) => s === '')) return common.length === 1 ? '/' : '';
  return common.join('/');
}

/** 짧고 안정된 글자(FNV-1a 32비트) — 노드 id 에 긴 경로를 싣지 않으려고 쓴다. 보안 용도가 아니다. */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** 종류 + 폴더 열쇠 — 원 둘레 묶음(`bundle-radial-…`) 노드 id 용(화면=폴더마다 다른 id). 예전 묶음 열쇠와 같은 식이라 그 id 가 이어진다. */
export function kindBundleDirToken(kind: KindBundleKind, dir: string, platform: PlatformName): string {
  return `${kind}-${shortHash(`${kind}:${pathKey(dir, platform)}`)}`;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 한 무리의 같은 종류 묶음을 고른다(같은 미디어 종류 둘 이상 = 하나, 하위 폴더 무관). 열쇠 순 — 같은 입력은 같은 그림. */
export function planKindBundles(
  files: readonly KindBundleFileInput[],
  opts: KindBundleOptions,
): KindBundle[] {
  if (files.length < BUNDLE_BUBBLE.minMembers) return [];
  const memberMax = Math.max(BUNDLE_BUBBLE.minMembers, opts.memberMax ?? CONSTELLATION.moonMax);

  const groups = new Map<KindBundleKind, { id: string; path: string; last: number }[]>();
  const seen = new Set<string>();
  for (const f of files) {
    if (f.id === '' || f.path === '' || seen.has(f.id)) continue;
    seen.add(f.id);
    const shaped = kindBundlePathShape(f.path);
    const face = previewBundleKindOf(shaped);
    if (face === null) continue;
    // 폴더가 없는 자리(루트 바로 아래) — 루트를 묶으라 할 때만 묶는다.
    if (dirOf(shaped) === '' && opts.includeRoot !== true) continue;
    const kind = face as KindBundleKind;
    const item = { id: f.id, path: shaped, last: f.lastActivity ?? 0 };
    const group = groups.get(kind);
    if (group) group.push(item);
    else groups.set(kind, [item]);
  }

  const out: KindBundle[] = [];
  for (const [kind, items] of groups) {
    if (items.length < BUNDLE_BUBBLE.minMembers) continue;
    items.sort((a, b) => (b.last - a.last) || compareIds(a.id, b.id));
    out.push({
      token: kind,
      kind,
      dir: kindBundleCommonDir(items.map((i) => i.path), opts.platform),
      memberIds: items.slice(0, memberMax).map((i) => i.id),
      overflowIds: items.slice(memberMax).map((i) => i.id),
    });
  }
  out.sort((a, b) => compareIds(a.token, b.token));
  return out;
}

/** 일반 문서만 최근 cap개로 제한한다. 미리보기는 묶음 내부 전체 조회를 위해 모두 유지한다. */
export function keepSatelliteSeats(
  files: readonly KindBundleFileInput[],
  cap: number,
  _opts: KindBundleOptions,
): Set<string> {
  const keep = new Set<string>();
  const latest = new Map<string, number>();
  for (const f of files) {
    if (isPreviewBundleFile(f.path)) { keep.add(f.id); continue; }
    const at = f.lastActivity ?? 0;
    const prev = latest.get(f.id);
    if (prev === undefined || at > prev) latest.set(f.id, at);
  }
  const entries = latest.size <= cap ? latest.entries() : [...latest.entries()]
      .sort((a, b) => (b[1] - a[1]) || compareIds(a[0], b[0]))
      .slice(0, Math.max(0, cap));
  for (const [id] of entries) keep.add(id);
  return keep;
}
