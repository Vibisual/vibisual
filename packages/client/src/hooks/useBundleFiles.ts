import { useEffect, useState } from 'react';
import type { BubbleData } from '@vibisual/shared';
import { useGraphStore, type InteriorView } from '../stores/graphStore.js';
import { bundlePageWindow } from '../utils/bundlePages.js';

interface BundlePageResult {
  key: string;
  items: BubbleData[];
  total: number;
  page: number;
}

/** 서버 묶음은 표시할 한 페이지만 받는다. 연속 번호는 정확한 로컬 구성 목록을 유지한다. */
export function useBundleFiles(view: InteriorView | null, page: number, projectPath: string | null, fallback: BubbleData[],
  options: { registerPageNodes?: boolean; enabled?: boolean; preferLocal?: boolean } = {}): {
  members: BubbleData[]; total: number; layoutPage: number; loading: boolean; failed: boolean; retry: () => void;
} {
  const folder = options.enabled !== false && view?.kind === 'bundle' && view.source !== 'sequence' && view.folderId !== undefined ? view : null;
  const sequence = options.enabled !== false && view?.kind === 'bundle' && view.source === 'sequence' ? view : null;
  const sequencePage = bundlePageWindow(sequence?.memberIds.length ?? 0, page);
  const sequenceBody = sequence ? JSON.stringify({
    ids: sequence.memberIds.slice(sequencePage.start, sequencePage.end), kind: sequence.fileKind,
    ...(sequence.sessionId ? { sessionId: sequence.sessionId } : {}), ...(projectPath ? { absolutePath: projectPath } : {}),
  }) : null;
  const query = folder ? new URLSearchParams({
    folderId: folder.folderId!, ...(folder.sessionId ? { sessionId: folder.sessionId } : {}), kind: folder.fileKind ?? '',
    ...(folder.folderAbsolutePath ? { folderAbsolutePath: folder.folderAbsolutePath } : {}),
    page: String(page), ...(projectPath ? { absolutePath: projectPath } : {}),
  }).toString() : sequenceBody ? `sequence:${sequenceBody}` : null;
  const sequenceTotal = sequence?.memberIds.length ?? 0;
  const refreshKey = folder || sequence ? JSON.stringify([sequenceTotal, fallback.map((node) => [node.id, node.lastActivity, node.fileMtime,
    node.previewSessionCounts?.[view?.kind === 'bundle' ? view.sessionId ?? '' : ''], node.folderKindCount])]) : '';
  const [result, setResult] = useState<BundlePageResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const retry = (): void => { setFailure(null); setRevision((v) => v + 1); };
  useEffect(() => {
    if (query === null) return;
    const controller = new AbortController();
    void fetch(sequenceBody ? '/api/bundle-files' : `/api/bundle-files?${query}`, sequenceBody
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: sequenceBody, signal: controller.signal }
      : { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('bundle-page');
      const raw = await response.json() as { items: BubbleData[]; total: number; page: number };
      const data = sequenceBody ? { items: raw.items, total: sequenceTotal, page: sequencePage.page } : raw;
      if (!Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0
        || !Number.isSafeInteger(data.page) || data.page < 0) throw new Error('bundle-page');
      if (!controller.signal.aborted) { setResult({ ...data, key: query }); setFailure(null); }
    }).catch(() => { if (!controller.signal.aborted) setFailure(query); });
    return () => controller.abort();
  }, [query, refreshKey, revision, sequenceBody, sequenceTotal, sequencePage.page]);
  useEffect(() => {
    if (options.registerPageNodes === false || result?.key !== query) return;
    const nodes = Object.fromEntries(result.items.map((node) => [node.id, node]));
    useGraphStore.setState({ bundlePageNodes: nodes });
    return () => {
      if (useGraphStore.getState().bundlePageNodes === nodes) useGraphStore.setState({ bundlePageNodes: {} });
    };
  }, [result, query, options.registerPageNodes]);
  if (query === null) return { members: fallback, total: fallback.length, layoutPage: page, loading: false, failed: false, retry };
  if (result?.key === query) return options.preferLocal && fallback.length > result.total
    ? { members: fallback, total: fallback.length, layoutPage: page, loading: false, failed: failure === query, retry }
    : { members: result.items, total: result.total, layoutPage: 0, loading: false, failed: failure === query, retry };
  return {
    members: sequence || page === 0 ? fallback : [], total: sequence ? sequenceTotal : view?.kind === 'bundle' ? view.totalCount ?? fallback.length : fallback.length,
    layoutPage: sequence ? page : 0, loading: failure !== query, failed: failure === query, retry,
  };
}
