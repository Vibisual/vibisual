import type { WorkspaceEntry } from '@vibisual/shared';

/**
 * §5.5 #17-19 v4.71 — IDE 워크스페이스 탐색기의 순수 로직.
 *
 * 화면(JSX)과 통신(fetch)을 뺀 계산만 모아 둔다 — 트리를 행 목록으로 펴는 일, 경로를
 * `상위폴더/파일명` 으로 가르는 일, 절대 경로를 루트 기준 상대 경로로 되돌리는 일.
 * 좌표·경로 계산은 UI 통합 테스트보다 단위 테스트가 훨씬 촘촘히 잡아 준다.
 */

/** 탐색기에 실제로 그려지는 한 줄 — 엔트리 + 들여쓰기 깊이. */
export interface ExplorerRow {
  entry: WorkspaceEntry;
  /** 루트 자식 = 0 */
  depth: number;
}

/** 디렉터리 캐시 — key = 루트 기준 상대 경로('' = 루트 자신), value = 그 디렉터리의 자식들. */
export type ExplorerDirCache = Record<string, WorkspaceEntry[]>;

/**
 * 펼침 상태를 반영해 트리를 **화면 순서 그대로의 행 목록**으로 편다.
 *
 * 아직 받아오지 못한(캐시에 없는) 디렉터리는 펼쳐져 있어도 자식이 없는 것으로 둔다 —
 * 로딩 표시는 뷰가 `expanded && !cache[relPath]` 로 판정한다(여기서 자리표시자를 끼워 넣으면
 * 행 목록에 실재하지 않는 엔트리가 섞인다).
 */
export function flattenExplorerRows(
  cache: ExplorerDirCache,
  expanded: ReadonlySet<string>,
  dirRelPath = '',
  depth = 0,
): ExplorerRow[] {
  const children = cache[dirRelPath];
  if (!children) return [];

  const rows: ExplorerRow[] = [];
  for (const entry of children) {
    rows.push({ entry, depth });
    if (entry.isDirectory && expanded.has(entry.relPath)) {
      rows.push(...flattenExplorerRows(cache, expanded, entry.relPath, depth + 1));
    }
  }
  return rows;
}

/**
 * 경로를 `{ dir, name }` 으로 가른다 — 목록에서 상위 폴더를 흐리게, 파일명을 또렷하게 그리기 위함.
 * 최상위 항목이면 `dir` 은 빈 문자열.
 */
export function splitRelPath(relPath: string): { dir: string; name: string } {
  const normalized = relPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return { dir: '', name: normalized };
  return { dir: normalized.slice(0, idx), name: normalized.slice(idx + 1) };
}

/**
 * 절대 경로를 루트 기준 상대 경로로 되돌린다(Windows 대소문자·구분자 차이 흡수).
 * 루트 밖이면 절대 경로를 그대로 돌려준다 — 표시가 목적이라 숨기는 것보다 있는 그대로가 낫다.
 */
export function toRelativeFromRoot(absPath: string, root: string): string {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const a = norm(absPath);
  const r = norm(root);
  if (r.length === 0) return a;
  const lowerA = a.toLowerCase();
  const lowerR = r.toLowerCase();
  if (lowerA === lowerR) return '';
  if (lowerA.startsWith(`${lowerR}/`)) return a.slice(r.length + 1);
  return a;
}

/**
 * 어떤 경로를 화면에 드러내기 위해 펼쳐야 하는 조상 폴더들.
 * `packages/client/src/App.tsx` → `['packages', 'packages/client', 'packages/client/src']`.
 */
export function ancestorDirs(relPath: string): string[] {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const result: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    result.push(parts.slice(0, i + 1).join('/'));
  }
  return result;
}
