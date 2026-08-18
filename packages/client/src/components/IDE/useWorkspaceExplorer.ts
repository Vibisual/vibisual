import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceDirListing } from '@vibisual/shared';
import type { ExplorerDirCache } from './explorerModel.js';

/**
 * §5.5 #17-19 v4.71 — 탐색기의 서버 대화 담당(디렉터리 지연 조회 + 캐시).
 *
 * 한 번에 한 겹만 받는다: 폴더를 펼치는 순간 그 폴더의 자식만 `GET /api/workspace-dir` 로 받아
 * 캐시에 넣고, 접었다 다시 펴면 캐시를 그대로 쓴다. 새로고침은 캐시를 비우고 **지금 펼쳐져 있는
 * 폴더들만** 다시 받는다(트리 전체를 다시 걷지 않는다).
 *
 * 펼침·선택 같은 화면 상태는 전역 store 로 올리지 않는다(§코딩 규칙 "UI 상태는 컴포넌트 로컬").
 */

const ROOT_KEY = '';

export interface WorkspaceExplorerApi {
  /** relPath('' = 루트) → 그 디렉터리의 자식들 */
  cache: ExplorerDirCache;
  /** 펼쳐 둔 디렉터리 relPath 집합 */
  expanded: ReadonlySet<string>;
  /** 지금 받아오는 중인 디렉터리 relPath 집합 */
  loading: ReadonlySet<string>;
  /** 엔트리 상한에 걸려 잘린 디렉터리 relPath 집합 */
  truncated: ReadonlySet<string>;
  /** 읽기에 실패한 디렉터리 relPath 집합(권한 없음·중간에 사라짐 등) */
  failed: ReadonlySet<string>;
  /** 루트를 못 읽었을 때의 사유(그 외 오류는 해당 폴더만 빈 채로 남는다) */
  rootError: string | null;
  toggleDir: (relPath: string) => void;
  collapseAll: () => void;
  refresh: () => void;
}

/** 절대 경로로 파일을 에디터에서 연다 — 기존 열기 경로 재사용(새 열기 레일 ❌). */
export function openFileByPath(absolutePath: string, nodePath: string): void {
  void fetch('/api/open-node-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodePath, absolutePath }),
  }).catch(() => { /* 열기 실패는 화면을 막지 않는다 */ });
}

/** 절대 경로가 든 폴더를 시스템 탐색기에서 연다 — 기존 폴더 열기 경로 재사용(새 열기 레일 ❌). */
export function openFolderByPath(absolutePath: string, nodePath: string): void {
  void fetch('/api/open-node-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodePath, absolutePath }),
  }).catch(() => { /* 열기 실패는 화면을 막지 않는다 */ });
}

/** 루트 기준 상대 경로로 파일을 연다(트리 행에서 사용). */
export function openWorkspaceFile(rootPath: string, relPath: string): void {
  const base = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  openFileByPath(`${base}/${relPath}`, relPath);
}

async function fetchDir(root: string, relPath: string): Promise<WorkspaceDirListing | null> {
  try {
    const res = await fetch(
      `/api/workspace-dir?root=${encodeURIComponent(root)}&path=${encodeURIComponent(relPath)}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as WorkspaceDirListing;
  } catch {
    return null;
  }
}

/** 루트가 바뀌면(프로젝트 전환) 캐시·펼침을 통째로 버리고 처음부터 다시 읽는다. */
export function useWorkspaceExplorer(rootPath: string | null): WorkspaceExplorerApi {
  const [cache, setCache] = useState<ExplorerDirCache>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set<string>());
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set<string>());
  const [truncated, setTruncated] = useState<ReadonlySet<string>>(new Set<string>());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set<string>());
  const [rootError, setRootError] = useState<string | null>(null);

  /** 늦게 도착한 응답이 새 루트/새로고침 결과를 덮지 않게 하는 세대 번호. */
  const generationRef = useRef(0);

  const load = useCallback((root: string, relPath: string, generation: number): void => {
    setLoading((prev) => new Set(prev).add(relPath));
    void fetchDir(root, relPath).then((listing) => {
      if (generationRef.current !== generation) return;
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(relPath);
        return next;
      });
      if (!listing) {
        // 읽기 실패는 그 폴더에만 표시한다 — 트리 전체를 오류 화면으로 덮지 않는다(루트는 예외).
        setFailed((prev) => new Set(prev).add(relPath));
        if (relPath === ROOT_KEY) setRootError('load-failed');
        return;
      }
      setFailed((prev) => {
        if (!prev.has(relPath)) return prev;
        const next = new Set(prev);
        next.delete(relPath);
        return next;
      });
      setCache((prev) => ({ ...prev, [relPath]: listing.entries }));
      setTruncated((prev) => {
        if (listing.truncated === prev.has(relPath)) return prev;
        const next = new Set(prev);
        if (listing.truncated) next.add(relPath); else next.delete(relPath);
        return next;
      });
      if (relPath === ROOT_KEY) setRootError(null);
    });
  }, []);

  // 루트 교체 — 이전 세대 응답은 버려진다.
  useEffect(() => {
    generationRef.current += 1;
    setCache({});
    setExpanded(new Set<string>());
    setLoading(new Set<string>());
    setTruncated(new Set<string>());
    setFailed(new Set<string>());
    setRootError(null);
    if (!rootPath) return;
    load(rootPath, ROOT_KEY, generationRef.current);
  }, [rootPath, load]);

  const toggleDir = useCallback((relPath: string): void => {
    if (!rootPath) return;
    const isOpen = expanded.has(relPath);
    const next = new Set(expanded);
    if (isOpen) next.delete(relPath); else next.add(relPath);
    setExpanded(next);
    // 펼치는 순간에만, 아직 안 받은 폴더만 조회한다(접기는 통신 ❌ — 캐시를 그대로 둔다).
    if (!isOpen && !cache[relPath] && !loading.has(relPath)) {
      load(rootPath, relPath, generationRef.current);
    }
  }, [rootPath, expanded, cache, loading, load]);

  const collapseAll = useCallback((): void => {
    setExpanded(new Set<string>());
  }, []);

  const refresh = useCallback((): void => {
    if (!rootPath) return;
    generationRef.current += 1;
    const generation = generationRef.current;
    const stillOpen = [...expanded];
    setCache({});
    setTruncated(new Set<string>());
    setLoading(new Set<string>());
    setFailed(new Set<string>());
    setRootError(null);
    load(rootPath, ROOT_KEY, generation);
    for (const relPath of stillOpen) load(rootPath, relPath, generation);
  }, [rootPath, expanded, load]);

  return { cache, expanded, loading, truncated, failed, rootError, toggleDir, collapseAll, refresh };
}
