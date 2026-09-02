/**
 * 폴더 목록의 **겹별 페이지 로딩**(§7.5) — `FolderFileTree`/`RootFileList` 가 함께 쓴다.
 *
 * 규약 셋을 이 훅 하나가 지킨다:
 *  ① **한 겹만** 부른다. 하위는 사용자가 펼칠 때 그 겹을 따로 부른다.
 *  ② **한 장씩** 이어 받는다(`nextCursor`). 목록 바닥이 보이면 화면이 `loadMore` 를 부른다.
 *  ③ **안 보는 것은 들고 있지 않는다.** 접으면 그 겹과 그 아래를 즉시 버리고(`dropLevelSubtree`),
 *     대상 폴더가 바뀌거나 패널이 닫히면 통째로 사라진다(컴포넌트 로컬 상태 — 전역 store 캐시 ❌).
 *
 * 종전에는 폴더 하나를 통째로 재귀해 한 번에 받았고, 사용자 홈이 외부 폴더 버블로 뜨면 그 요청이
 * 영영 돌아오지 않아 화면이 "불러오는 중" 에서 멈춘 채 창까지 함께 굳었다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FolderFilePage } from '@vibisual/shared';
import { FOLDER_FILES_PAGE_SIZE } from '@vibisual/shared';
import {
  dropExpandedSubtree,
  dropLevelSubtree,
  type FolderLevelState,
} from './folderFileRows.js';

const API_BASE = '';

/**
 * 한 장을 기다려 주는 시간. 넘으면 그 겹을 **실패**로 표시해 다시 시도할 자리를 준다 —
 * 답이 안 오는 것과 "아직 오는 중"이 화면에서 같아 보이면 사용자는 앱이 멈춘 줄 안다.
 */
const PAGE_REQUEST_TIMEOUT_MS = 15_000;

/** 아직 아무것도 못 받은 겹의 초기값. */
const emptyLevel = (): FolderLevelState => ({
  entries: [],
  nextCursor: null,
  total: 0,
  loading: true,
  failed: false,
});

export interface FolderFilePagesApi {
  levels: Map<string, FolderLevelState>;
  expanded: Set<string>;
  /** 첫 겹을 아직 한 장도 못 받았는가(화면 전체의 "불러오는 중"). */
  rootLoading: boolean;
  /** 폴더 행을 눌렀을 때 — 펼치면 그 겹 첫 장을 받고, 접으면 그 아래를 통째로 버린다. */
  toggleExpand: (childSubPath: string) => void;
  /** 그 겹의 다음 장을 받는다(이미 받는 중이면 무시). */
  loadMore: (subPath: string) => void;
  /** 전부 버리고 첫 겹부터 다시 — 토글로 디스크가 바뀐 뒤에 쓴다. */
  reload: () => void;
}

export function useFolderFilePages(
  folderPath: string,
  folderAbsPath?: string | undefined,
): FolderFilePagesApi {
  const [levels, setLevels] = useState<Map<string, FolderLevelState>>(() => new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  /**
   * 지금 살아 있는 요청들. 대상 폴더가 바뀌거나 언마운트되면 **전부 끊는다** —
   * 끊지 않으면 늦게 도착한 남의 폴더 응답이 새 목록 위에 얹힌다.
   */
  const inflight = useRef(new Map<string, AbortController>());
  /** 이 훅 인스턴스가 지금 보고 있는 대상 — 늦게 온 응답을 버릴 때 대조한다. */
  const targetRef = useRef({ folderPath, folderAbsPath });
  targetRef.current = { folderPath, folderAbsPath };

  const abortAll = useCallback(() => {
    for (const controller of inflight.current.values()) controller.abort();
    inflight.current.clear();
  }, []);

  /**
   * 한 겹의 한 장을 받아 온다.
   *
   * @param subPath 받을 겹(`''` = 폴더 자신).
   * @param cursor  `null` 이면 첫 장(기존 항목을 갈아 끼운다), 그 외면 뒤에 이어 붙인다.
   */
  const fetchPage = useCallback((subPath: string, cursor: string | null) => {
    // 같은 겹의 요청이 이미 떠 있으면 그것을 끊고 새로 건다(마지막 의도가 이긴다).
    inflight.current.get(subPath)?.abort();
    const controller = new AbortController();
    inflight.current.set(subPath, controller);
    const timer = setTimeout(() => controller.abort(), PAGE_REQUEST_TIMEOUT_MS);

    const { folderPath: reqFolder, folderAbsPath: reqAbs } = targetRef.current;
    const qs = new URLSearchParams({ nodePath: reqFolder, limit: String(FOLDER_FILES_PAGE_SIZE) });
    if (reqAbs) qs.set('absolutePath', reqAbs);
    if (subPath) qs.set('relPath', subPath);
    if (cursor) qs.set('cursor', cursor);

    setLevels((prev) => {
      const next = new Map(prev);
      const cur = next.get(subPath) ?? emptyLevel();
      next.set(subPath, { ...cur, loading: true, failed: false });
      return next;
    });

    fetch(`${API_BASE}/api/folder-files?${qs.toString()}`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<FolderFilePage>) : Promise.reject(new Error(String(r.status)))))
      .then((page) => {
        // 기다리는 사이 다른 폴더로 옮겨 갔으면 이 답은 남의 것이다.
        if (targetRef.current.folderPath !== reqFolder) return;
        setLevels((prev) => {
          const next = new Map(prev);
          const cur = next.get(subPath);
          const base = cursor && cur ? cur.entries : [];
          next.set(subPath, {
            entries: [...base, ...page.entries],
            nextCursor: page.nextCursor,
            total: page.total,
            loading: false,
            failed: false,
          });
          return next;
        });
      })
      .catch(() => {
        if (controller.signal.aborted && targetRef.current.folderPath !== reqFolder) return;
        setLevels((prev) => {
          const next = new Map(prev);
          const cur = next.get(subPath) ?? emptyLevel();
          next.set(subPath, { ...cur, loading: false, failed: true });
          return next;
        });
      })
      .finally(() => {
        clearTimeout(timer);
        if (inflight.current.get(subPath) === controller) inflight.current.delete(subPath);
      });
  }, []);

  // 대상 폴더가 바뀌면 **전부 버리고** 첫 겹부터 다시 — 남의 폴더 내용이 섞이지 않는다.
  useEffect(() => {
    abortAll();
    setLevels(new Map());
    setExpanded(new Set());
    fetchPage('', null);
    return abortAll;
  }, [folderPath, folderAbsPath, fetchPage, abortAll]);

  // 최신 상태를 ref 로도 들고 있는다 — 스크롤 핸들러처럼 오래 사는 콜백이 옛 값을 보고
  // "더 없다"고 판단하는 것을 막고, 상태 갱신 함수 안에서 요청을 걸지 않기 위함이다
  // (갱신 함수는 StrictMode 에서 두 번 불릴 수 있어 부수효과를 두면 요청이 두 번 나간다).
  const levelsRef = useRef(levels);
  levelsRef.current = levels;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const toggleExpand = useCallback((childSubPath: string) => {
    if (expandedRef.current.has(childSubPath)) {
      // 접는다 — 그 겹과 그 아래를 즉시 버린다(§7.5 ③).
      inflight.current.get(childSubPath)?.abort();
      inflight.current.delete(childSubPath);
      setLevels((prev) => dropLevelSubtree(prev, childSubPath));
      setExpanded((prev) => dropExpandedSubtree(prev, childSubPath));
      return;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(childSubPath);
      return next;
    });
    fetchPage(childSubPath, null);
  }, [fetchPage]);

  const loadMore = useCallback((subPath: string) => {
    // 이미 그 겹의 요청이 떠 있으면 겹쳐 부르지 않는다(바닥 감지는 연달아 발화한다).
    if (inflight.current.has(subPath)) return;
    const cur = levelsRef.current.get(subPath);
    if (!cur || cur.loading || cur.nextCursor === null) return;
    fetchPage(subPath, cur.nextCursor);
  }, [fetchPage]);

  const reload = useCallback(() => {
    abortAll();
    setLevels(new Map());
    setExpanded(new Set());
    fetchPage('', null);
  }, [abortAll, fetchPage]);

  const root = levels.get('');
  return {
    levels,
    expanded,
    rootLoading: root === undefined || (root.loading && root.entries.length === 0),
    toggleExpand,
    loadMore,
    reload,
  };
}
