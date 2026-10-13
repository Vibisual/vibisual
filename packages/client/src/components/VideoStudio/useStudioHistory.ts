import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryEntry, PassRecord, VideoDoc } from '@vibisual/video';

import { deleteHistory, historyStill, readHistory, recordHistory, restoreHistory } from './studioApi.js';

/**
 * §5.13 (V) 37-3 — 판 기록 상태: 판·바퀴 목록(문서가 다시 읽힐 때마다 새로), 판 정지 화면(보일 때 한 번 굽고 기억), 저장점 찍기·
 * 돌아가기·지우기. 정지 화면 기억은 이 창의 것이고 프로젝트·문서로 가른다(§3.5 — 다른 탭의 판이 섞이지 않게).
 */
export interface StudioHistory {
  readonly entries: readonly HistoryEntry[];
  readonly passes: readonly PassRecord[];
  readonly stills: Readonly<Record<string, string | null>>;
  readonly requestStill: (revId: string) => void;
  readonly checkpoint: (label?: string) => Promise<void>;
  readonly restore: (revId: string) => Promise<VideoDoc>;
  readonly remove: (revId: string) => Promise<void>;
  readonly refresh: () => void;
}

const stillCache = new Map<string, string>();
const STILL_CACHE_MAX = 120;

function remember(key: string, image: string): void {
  stillCache.delete(key);
  stillCache.set(key, image);
  while (stillCache.size > STILL_CACHE_MAX) {
    const oldest = stillCache.keys().next().value;
    if (oldest === undefined) break;
    stillCache.delete(oldest);
  }
}

export function useStudioHistory(project: string, docId: string, reloadTick: number, onError: (err: unknown) => void): StudioHistory {
  const [entries, setEntries] = useState<readonly HistoryEntry[]>([]);
  const [passes, setPasses] = useState<readonly PassRecord[]>([]);
  const [stills, setStills] = useState<Record<string, string | null>>({});
  const [tick, setTick] = useState(0);
  const inflight = useRef(new Set<string>());
  const errRef = useRef(onError);
  errRef.current = onError;
  const keyOf = useCallback((revId: string) => JSON.stringify([project, docId, revId]), [project, docId]);

  useEffect(() => {
    setEntries([]); setPasses([]); setStills({}); inflight.current.clear();
  }, [project, docId]);

  useEffect(() => {
    if (project === '' || docId === '') return;
    let alive = true;
    readHistory(project, docId)
      .then((h) => { if (alive) { setEntries(h.entries); setPasses(h.passes); } })
      .catch(() => undefined); // 판 기록이 없는 문서(처음) — 빈 목록이 맞다.
    return () => { alive = false; };
  }, [project, docId, reloadTick, tick]);

  const requestStill = useCallback((revId: string): void => {
    const key = keyOf(revId);
    const cached = stillCache.get(key);
    if (cached) { setStills((s) => (s[revId] === cached ? s : { ...s, [revId]: cached })); return; }
    if (inflight.current.has(revId)) return;
    inflight.current.add(revId);
    setStills((s) => ({ ...s, [revId]: null }));
    historyStill(project, docId, revId)
      .then((image) => { remember(key, image); setStills((s) => ({ ...s, [revId]: image })); })
      .catch(() => undefined)
      .finally(() => inflight.current.delete(revId));
  }, [keyOf, project, docId]);

  const refresh = useCallback((): void => setTick((n) => n + 1), []);

  const checkpoint = useCallback(async (label?: string): Promise<void> => {
    try { await recordHistory(project, docId, { kind: 'checkpoint', ...(label ? { label } : {}) }); refresh(); }
    catch (err) { errRef.current(err); }
  }, [project, docId, refresh]);

  const restore = useCallback(async (revId: string): Promise<VideoDoc> => {
    const result = await restoreHistory(project, docId, revId);
    refresh();
    return result.doc;
  }, [project, docId, refresh]);

  const remove = useCallback(async (revId: string): Promise<void> => {
    try { await deleteHistory(project, docId, revId); refresh(); }
    catch (err) { errRef.current(err); }
  }, [project, docId, refresh]);

  return { entries, passes, stills, requestStill, checkpoint, restore, remove, refresh };
}
