/**
 * 루트 패널("표시됨" / "파일")의 행 만들기 — **순수 함수**라 단위 테스트가 붙는다.
 *
 * 왜 따로 두는가:
 *
 * ① "표시됨" 은 종전에 **디스크 목록을 걸러서** 만들었다. 그런데 디스크 목록은 점으로 시작하는
 *    폴더(`.claude`)와 무시 목록(`node_modules`, `dist` …)을 일부러 감춘다 — 그래서 에이전트가
 *    `.claude/…` 를 만져 캔버스에 `.claude` 버블이 떠 있어도 목록에는 **한 줄도 나오지 않았다**
 *    (체크 표시가 안 되는 것처럼 보이던 증상). "표시됨" 의 SSOT 는 캔버스이므로, 캔버스에 뜬
 *    노드에서 **직접** 행을 만든다.
 *
 * ② 반대로 캔버스에는 디스크 경로가 아닌 합성 버블(프로젝트 루트 자신 `__root__:…`,
 *    루트 밖 외부 폴더 `__ext__…`, 워크트리 네임스페이스 `wt<hash>__…`, 도메인 `__web__…`)도 뜬다.
 *    이들은 이 루트 폴더 **안의** 항목이 아니고 `/api/root/toggle` 로 끌 수도 없다(디스크에 없어
 *    404). 그러니 행으로 만들지 않는다.
 */

import type { BubbleData, FolderFileEntry } from '@vibisual/shared';
import { LEGACY_ROOT_NODE_KEY, ROOT_NODE_KEY_PREFIX, WEB_KEY_MARK } from '@vibisual/shared';

/** 워크트리 네임스페이스 키(`wt<hash36>__<상대경로>`). */
const WORKTREE_KEY = /^wt[0-9a-z]+__/;

/** 절대 경로(윈도우 드라이브 · POSIX 루트 · UNC). */
const ABSOLUTE_PATH = /^([A-Za-z]:[\\/]|[\\/])/;

/**
 * 이 루트/폴더 **안의 실제 디스크 경로**가 아닌 노드 키인가.
 * 이런 키는 목록 행으로 만들지 않는다(토글 대상이 아니다).
 */
export function isSyntheticNodeKey(nodePath: string): boolean {
  if (!nodePath) return true;
  if (nodePath === LEGACY_ROOT_NODE_KEY || nodePath.startsWith(ROOT_NODE_KEY_PREFIX)) return true;
  if (nodePath.startsWith('__ext__') || nodePath.startsWith('__special__')) return true;
  if (nodePath.startsWith(WEB_KEY_MARK)) return true;
  if (WORKTREE_KEY.test(nodePath)) return true;
  if (ABSOLUTE_PATH.test(nodePath)) return true;
  return false;
}

/** 상대 경로의 마지막 조각 — 디스크 목록에 없는 노드의 표시 이름. */
export function baseName(nodePath: string): string {
  const parts = nodePath.split('/').filter((s) => s.length > 0);
  return parts[parts.length - 1] ?? nodePath;
}

/** 버블 타입이 폴더인가(아이콘 선택용). */
function isFolderBubble(node: BubbleData): boolean {
  return node.bubbleType === 'internal_folder' || node.bubbleType === 'external_folder';
}

/**
 * 캔버스에 떠 있는 노드 → "표시됨" 행.
 *
 * @param nodes    캔버스가 지금 그리고 있는 노드들(최상위 집합 또는 그 폴더의 children).
 * @param entries  디스크 목록(같은 항목이면 이름·자식 수를 여기서 가져와 화면이 흔들리지 않게 한다).
 * @param foldKey  경로 비교 키 만들기(플랫폼 규칙 — linux 는 대소문자를 보존한다).
 */
export function visibleRowsFrom(
  nodes: readonly BubbleData[],
  entries: readonly FolderFileEntry[],
  foldKey: (p: string) => string,
): FolderFileEntry[] {
  const byKey = new Map<string, FolderFileEntry>();
  for (const e of entries) byKey.set(foldKey(e.relativePath), e);

  const seen = new Set<string>();
  const rows: FolderFileEntry[] = [];
  for (const node of nodes) {
    if (isSyntheticNodeKey(node.path)) continue;
    const key = foldKey(node.path);
    if (seen.has(key)) continue;
    seen.add(key);
    const onDisk = byKey.get(key);
    if (onDisk) {
      rows.push(onDisk);
      continue;
    }
    // 디스크 목록이 감춘 항목(`.claude`, `node_modules` …) — 캔버스에 떠 있으니 행은 만든다.
    rows.push({
      name: node.label || baseName(node.path),
      relativePath: node.path,
      isDirectory: isFolderBubble(node),
      isSatellite: false,
    });
  }
  rows.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return rows;
}
