/**
 * §5.1 #2-1 (B)(D) — **같은 종류 묶음** 판정(순수). 2026-10-21 사용자 지시:
 * *"사진 묶음인데 위성이나 사진 묶음 안으로 들어가면 사진만 있는게 아니라 다른 파일들도 같이 있는게 문제야 … 사진 제외한
 * 다른 앱들표현도 마찬가지야 지금 2번째 사진들도 내가 비디오나 영상인줄알고 들어갔더니 묶음이야 묶음 버블로 변경하고"*,
 * 2026-10-22 사용자 지시: *"사용한 앱이 같은 폴더에 2개 이상이면 묶음 폴더로 승격 시키고 묶음 버블은 기존 앱과 동일한 위성을
 * 갖고 해당 묶음 버블 내부로 들어가면 위성 규칙으로 인해 사라졌던 사용한 버블들이 눈에 보이게 만들어 그리고 있어선 안되는규칙들
 * 수정하고"*.
 *
 * 한 부모(폴더)를 도는 위성 가운데 **같은 폴더**(그 폴더 자신 · 하위 폴더 하나하나)의 **같은 미디어 종류**(사진·영상·소리·3D)
 * 파일이 `BUNDLE_BUBBLE.minMembers` 개 이상이면 묶음 하나다. 묶음에는 그 종류만 든다 — 종전 묶음은 미디어 파일 중심 별자리를
 * 그대로 옮겨 사진 묶음 안을 그 사진을 적고 있는 md 가 함께 돌았다.
 *
 * 규율 셋:
 * - **폴더의 직속 파일도 묶는다(2026-10-22)** — 종전에는 "폴더 버블이 이미 그 묶음이다"며 뺐는데, 그래서 하위 폴더에서 올라온
 *   영상 다섯은 묶음이 되고 정작 png 40장이 든 폴더는 위성 상한에 걸려 35장이 화면에서 사라졌다. 사용자가 걷으라 한 규칙이다.
 * - **미디어가 아닌 종류는 묶지 않는다** — 묶음은 앱이 여는 종류(사진·영상·소리·3D)만이다.
 * - **한 묶음은 `memberMax` 까지** — 최근 것부터 남기고, 넘친 오래된 구성은 `overflowIds` 로 알린다(서버 위성 상한이 뺀다 —
 *   묶음 곁에 같은 폴더의 같은 종류가 낱자리로 따로 서지 않게). 위성 목록에서 빠질 뿐 파일 노드는 그대로라, 묶음 안은 그 폴더의
 *   같은 종류를 전부 세운다(`folderNodeId` 로 그 폴더를 범위로 선언한다).
 *
 * 경로는 외부 노드 표식(`EXTERNAL_NODE_KEY_MARK`)을 뗀 모양으로 견준다 — 서버 노드 키(`<워크트리 접두>__ext__c:/…`)와 화면의
 * 외부 파일 path 가 같은 자로 재야 한다. 대소문자는 `pathKey`(플랫폼은 인자 — `process.platform` 을 읽지 않는다,
 * 멀티플랫폼 1축). 서버(위성 상한의 "묶음은 자리 하나")와 클라(화면의 묶음 버블)가 이 함수 하나를 부른다 — 두 벌이 되면
 * 서버가 남긴 자리와 화면의 묶음이 갈린다.
 */

import { BUNDLE_BUBBLE, CONSTELLATION, EXTERNAL_NODE_KEY_MARK } from './constants.js';
import { fileFaceKindOf, isMediaFaceKind } from './fileFace.js';
import { normalizePathShape, pathKey, type PlatformName } from './pathCase.js';
import type { FileFaceKind } from './types.js';

/** 판정할 위성 파일 하나. `path` 는 노드 키(외부 표식 포함 가능)나 경로 — 같은 부모의 파일끼리 같은 형식이면 된다. */
export interface KindBundleFileInput {
  readonly id: string;
  readonly path: string;
  readonly lastActivity?: number | undefined;
}

export interface KindBundleOptions {
  readonly platform: PlatformName;
  /** 한 묶음의 구성 상한. 기본 `CONSTELLATION.moonMax`(한 중심이 거느리는 위성 상한과 같은 수). */
  readonly memberMax?: number;
  /**
   * 루트 바로 아래 파일(폴더 조각이 없는 경로)도 한 폴더로 묶는다 — 메인 화면 원 둘레의 최상위 파일(2026-10-22 사용자 지시
   * "같은개 2개 이상이면 공통 버블로 묶으라고"). 묶음의 `dir` 은 빈 글자다. 위성은 늘 폴더 안이라 서버는 쓰지 않는다.
   */
  readonly includeRoot?: boolean;
}

/** 묶음 하나 — 한 폴더의 한 미디어 종류. */
export interface KindBundle {
  /** 묶음 열쇠 — 같은 입력은 같은 열쇠. 한 부모 안에서 겹치지 않는 짧은 글자(화면의 노드 id 가 이것으로 선다). */
  readonly token: string;
  readonly kind: 'video' | 'image' | 'audio' | 'model';
  /** 구성 파일이 있는 폴더(외부 표식을 뗀 모양 · 대소문자 그대로). 표시 이름은 `kindBundleNameOf`. */
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

/** 짧고 안정된 글자(FNV-1a 32비트) — 노드 id 에 긴 경로를 싣지 않으려고 쓴다. 보안 용도가 아니다. */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 한 부모(폴더)를 도는 위성 파일들에서 같은 종류 묶음을 고른다 — 같은 폴더의 같은 미디어 종류 둘 이상이 묶음 하나다(그 부모의
 * 직속 파일 포함). 결과는 열쇠 순 — 같은 입력은 같은 그림이다.
 */
export function planKindBundles(
  files: readonly KindBundleFileInput[],
  opts: KindBundleOptions,
): KindBundle[] {
  if (files.length < BUNDLE_BUBBLE.minMembers) return [];
  const memberMax = Math.max(BUNDLE_BUBBLE.minMembers, opts.memberMax ?? CONSTELLATION.moonMax);

  const groups = new Map<string, { kind: KindBundle['kind']; dir: string; items: { id: string; last: number }[] }>();
  const seen = new Set<string>();
  for (const f of files) {
    if (f.id === '' || f.path === '' || seen.has(f.id)) continue;
    seen.add(f.id);
    const shaped = kindBundlePathShape(f.path);
    const kind: FileFaceKind = fileFaceKindOf(shaped);
    if (!isMediaFaceKind(kind)) continue;
    const dir = dirOf(shaped);
    if (dir === '' && opts.includeRoot !== true) continue; // 폴더가 없는 자리(루트 바로 아래) — 루트를 묶으라 할 때만 묶는다
    const key = `${kind}:${pathKey(dir, opts.platform)}`;
    const group = groups.get(key);
    const item = { id: f.id, last: f.lastActivity ?? 0 };
    if (group) group.items.push(item);
    else groups.set(key, { kind, dir, items: [item] });
  }

  const out: { key: string; bundle: KindBundle }[] = [];
  for (const [key, group] of groups) {
    if (group.items.length < BUNDLE_BUBBLE.minMembers) continue;
    group.items.sort((a, b) => (b.last - a.last) || compareIds(a.id, b.id));
    out.push({
      key,
      bundle: {
        token: `${group.kind}-${shortHash(key)}`,
        kind: group.kind,
        dir: group.dir,
        memberIds: group.items.slice(0, memberMax).map((i) => i.id),
        overflowIds: group.items.slice(memberMax).map((i) => i.id),
      },
    });
  }
  out.sort((a, b) => compareIds(a.key, b.key));
  return out.map((o) => o.bundle);
}
