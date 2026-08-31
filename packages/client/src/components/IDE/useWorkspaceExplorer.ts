import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  WorkspaceDirListing,
  WorkspaceEntryDeleteResult,
  WorkspaceEntryResult,
  WorkspacePathKind,
} from '@vibisual/shared';
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
  /**
   * §5.5 #17-19 ⑦ — **그 한 겹만** 다시 읽는다(만들기·이름 바꾸기·삭제 뒤).
   * 트리 전체를 다시 걷지 않는 이유는 ② 와 같다 — 바뀐 것은 그 폴더 하나뿐이고,
   * 통째 새로고침은 펼쳐 둔 폴더 전부를 다시 요청한다.
   */
  refreshDir: (relPath: string) => void;
  /** 접혀 있으면 펼친다(새 항목을 만들기 전에 부모 폴더를 열어 두는 자리). */
  expandDir: (relPath: string) => void;
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

/** 루트 기준 상대 경로를 절대 경로로 — 열기·복사 손잡이가 쓰는 것과 같은 조립. */
export function workspaceAbsPath(rootPath: string, relPath: string): string {
  const base = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return relPath ? `${base}/${relPath}` : base;
}

/**
 * §5.5 #17-19 ⑦⑧ — 탐색기가 내는 **쓰기 넷**(만들기 · 이름 바꾸기 · 삭제 · 옮기기).
 *
 * 조회(`fetchDir`)와 같은 모듈에 두는 이유는 담당이 같아서다 — 이 파일이 "서버와 하는 말" 전부다.
 * 실패는 서버가 준 사유 코드를 **그대로** 올려 보낸다(화면이 번역문을 고른다 — 여기서 문구를 만들면
 * 언어 전환이 따라오지 않는다).
 */
export type WorkspaceMutateFailure =
  | 'outside' | 'root' | 'invalid-name' | 'exists' | 'not-found' | 'denied' | 'failed'
  /** ⑧ 폴더를 자기 자신·자기 하위로 옮기려 했다 */
  | 'into-self'
  /** ⑧ 다른 볼륨이라 옮길 수 없다(정션·심볼릭 링크로 물린 경우) */
  | 'cross-device'
  /** 서버에 닿지 못했다(앱이 잠깐 끊긴 경우) */
  | 'offline';

export type WorkspaceMutateReply<T> = { ok: true; result: T } | { ok: false; error: WorkspaceMutateFailure };

// ⚠ 서버가 사유를 늘리면 **여기도 함께 늘려야 한다** — 목록이 두 벌이라, 빠뜨린 사유는 조용히
//   `failed`("실패했습니다")로 뭉개져 사용자가 진짜 이유를 영영 못 본다.
const MUTATE_FAILURES = new Set<string>([
  'outside', 'root', 'invalid-name', 'exists', 'not-found', 'denied', 'into-self', 'cross-device', 'failed',
]);

async function mutateEntry<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  /** 창구가 갈리는 것은 옮기기 하나뿐이다(`/move`) — 되물음도 결과도 다른 기능이라 길을 갈라 둔다. */
  endpoint = '/api/workspace-entry',
): Promise<WorkspaceMutateReply<T>> {
  try {
    const res = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
      const code = typeof payload?.error === 'string' && MUTATE_FAILURES.has(payload.error) ? payload.error : 'failed';
      return { ok: false, error: code as WorkspaceMutateFailure };
    }
    return { ok: true, result: (await res.json()) as T };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

/** 새 파일·새 폴더 — `parent` 는 부모 폴더의 상대 경로('' = 루트 바로 아래). */
export function createWorkspaceEntry(
  root: string,
  parent: string,
  name: string,
  kind: WorkspacePathKind,
): Promise<WorkspaceMutateReply<WorkspaceEntryResult>> {
  return mutateEntry<WorkspaceEntryResult>('POST', { root, path: parent, name, kind });
}

/** 이름 바꾸기 — 같은 폴더 안에서만(옮기기 ❌). */
export function renameWorkspaceEntry(
  root: string,
  relPath: string,
  name: string,
): Promise<WorkspaceMutateReply<WorkspaceEntryResult>> {
  return mutateEntry<WorkspaceEntryResult>('PATCH', { root, path: relPath, name });
}

/**
 * §5.5 #17-19 ⑧ 옮기기 — 이름은 그대로 두고 **사는 폴더**만 바꾼다(`toDir` = '' 이면 루트 바로 아래).
 * 되물음은 화면이 이미 마쳤다는 전제다(되돌릴 수 없는 쓰기의 되물음은 언제나 화면의 몫).
 */
export function moveWorkspaceEntry(
  root: string,
  relPath: string,
  toDir: string,
): Promise<WorkspaceMutateReply<WorkspaceEntryResult>> {
  return mutateEntry<WorkspaceEntryResult>('POST', { root, path: relPath, toDir }, '/api/workspace-entry/move');
}

/** 삭제 — 데스크톱 앱에서는 OS 휴지통으로 간다(`trashed` 가 어느 쪽이었는지 말해 준다). */
export function deleteWorkspaceEntry(
  root: string,
  relPath: string,
): Promise<WorkspaceMutateReply<WorkspaceEntryDeleteResult>> {
  return mutateEntry<WorkspaceEntryDeleteResult>('DELETE', { root, path: relPath });
}

/**
 * 이 실행 형태가 **휴지통을 쓸 수 있는가** — 되물음 문구가 갈리는 자리라 미리 물어 둔다.
 * 못 물어봤으면 `false`(= 영구 삭제라고 말한다) — 되돌릴 수 없는 쪽으로 보수적으로 겁준다.
 */
export async function fetchWorkspaceTrashAvailable(): Promise<boolean> {
  try {
    const res = await fetch('/api/workspace-trash');
    if (!res.ok) return false;
    const payload = (await res.json()) as { available?: unknown };
    return payload.available === true;
  } catch {
    return false;
  }
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

  // §5.5 #17-19 ⑦ — 쓰기 뒤 그 폴더 한 겹만 다시 읽는다(세대 번호는 그대로 — 루트가 바뀐 게 아니다).
  const refreshDir = useCallback((relPath: string): void => {
    if (!rootPath) return;
    load(rootPath, relPath, generationRef.current);
  }, [rootPath, load]);

  const expandDir = useCallback((relPath: string): void => {
    if (!rootPath || relPath === ROOT_KEY) return;
    setExpanded((prev) => {
      if (prev.has(relPath)) return prev;
      return new Set(prev).add(relPath);
    });
    if (!cache[relPath] && !loading.has(relPath)) load(rootPath, relPath, generationRef.current);
  }, [rootPath, cache, loading, load]);

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

  return { cache, expanded, loading, truncated, failed, rootError, toggleDir, collapseAll, refresh, refreshDir, expandDir };
}
