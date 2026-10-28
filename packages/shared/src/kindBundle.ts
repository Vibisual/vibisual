/**
 * §5.1 #2-1 (B)(D) — 같은 종류 묶음 판정(순수). 한 무리(한 버블의 위성 · 한 화면의 원 둘레)에서 같은 미디어 종류가 `BUNDLE_BUBBLE.minMembers` 개
 * 이상이면 묶음 하나 — 하위 폴더 무관(폴더를 열쇠에 넣으면 흩어진 같은 종류가 낱자리로 선다). 묶음엔 그 종류만, 미디어 아닌 종류는 묶지 않는다.
 * 한 묶음은 `memberMax` 까지 — 넘친 오래된 구성은 `overflowIds` 로 서버 위성 상한이 뺀다. 묶음 안은 그 버블 아래 같은 종류 전부(범위 `folderNodeId`).
 * `dir` 은 이름일 뿐(`kindBundleCommonDir`). 비교는 `pathKey`(플랫폼 인자), 경로는 `EXTERNAL_NODE_KEY_MARK` 를 뗀 모양(서버 노드 키와 같은 자).
 * 서버(`keepSatelliteSeats`)·클라(묶음 버블·IDE 세션 지도)가 함께 부른다 — 두 벌이면 서버가 남긴 자리와 화면 묶음이 갈린다.
 */

import { BUNDLE_BUBBLE, CONSTELLATION, EXTERNAL_NODE_KEY_MARK } from './constants.js';
import { fileFaceKindOf, isMediaFaceKind } from './fileFace.js';
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

/** 묶음이 되는 종류 — 앱이 여는 미디어 넷. */
export type KindBundleKind = 'video' | 'image' | 'audio' | 'model';

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
    const face = fileFaceKindOf(shaped);
    if (!isMediaFaceKind(face)) continue;
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

/**
 * §5.1 #2-1 (D) — 위성 상한은 자리 수다: 같은 종류 묶음은 한 자리(구성 `memberMax` 까지), 나머지는 파일 하나가 한 자리.
 * 최근 구성의 `lastActivity` 로 최근 자리부터 `cap` 개 — 남길 파일 id 를 돌려준다(차례는 부르는 쪽 입력 그대로).
 * 서버 `trimSatellites`(등록 차례)와 IDE 세션 지도(§5.5 #17-50, 마지막으로 닿은 시각)가 함께 부른다.
 */
export function keepSatelliteSeats(
  files: readonly KindBundleFileInput[],
  cap: number,
  opts: KindBundleOptions,
): Set<string> {
  const keep = new Set(files.map((f) => f.id));
  if (keep.size <= cap) return keep;
  const unitOf = new Map<string, string>();
  for (const bundle of planKindBundles(files, opts)) {
    for (const id of bundle.overflowIds) keep.delete(id);
    // 자리 열쇠 — 묶음은 경로가 될 수 없는 머리(NUL)를 달아 파일 id 와 겹치지 않게 한다.
    for (const id of bundle.memberIds) unitOf.set(id, `\u0000${bundle.token}`);
  }
  if (keep.size <= cap) return keep;
  const latest = new Map<string, number>();
  for (const f of files) {
    if (!keep.has(f.id)) continue;
    const unit = unitOf.get(f.id) ?? f.id;
    const at = f.lastActivity ?? 0;
    const prev = latest.get(unit);
    if (prev === undefined || at > prev) latest.set(unit, at);
  }
  if (latest.size <= cap) return keep;
  const kept = new Set(
    [...latest.entries()]
      .sort((a, b) => (b[1] - a[1]) || compareIds(a[0], b[0]))
      .slice(0, Math.max(0, cap))
      .map(([unit]) => unit),
  );
  for (const id of [...keep]) if (!kept.has(unitOf.get(id) ?? id)) keep.delete(id);
  return keep;
}
