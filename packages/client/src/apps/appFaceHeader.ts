import { useCallback, useSyncExternalStore } from 'react';

import type { AppFaceHeader } from './registry.js';

/**
 * §5.4 #36 (J) ⑥ — 앱 화면이 알린 머리줄(제목 · 바뀐 것 열쇠)과 "본 것"의 기억 — 노드 id 마다 한 칸, 앱 세션 안 휘발(영속 ❌).
 * 처음 알린 열쇠는 본 것이고(켤 때의 판본), 포인터를 올리거나 고르면 지금 열쇠를 본 것으로 친다. 화면 밖으로 나가 언마운트돼도 남는다.
 */

export interface FaceHeaderEntry {
  readonly title: string | null;
  readonly changeKey: string | null;
  readonly seenKey: string | null;
}

export interface FaceHeaderView {
  readonly title: string | null;
  readonly unseen: boolean;
}

const EMPTY_VIEW: FaceHeaderView = { title: null, unseen: false };
const ENTRIES_MAX = 256;

const entries = new Map<string, FaceHeaderEntry>();
const views = new Map<string, FaceHeaderView>();
const listeners = new Map<string, Set<() => void>>();

/** 알린 머리줄을 칸에 앉힌다(순수). 처음 받은 열쇠는 본 것이다. */
export function nextFaceHeader(prev: FaceHeaderEntry | undefined, header: AppFaceHeader | null): FaceHeaderEntry {
  const title = header?.title?.trim() ? header.title.trim() : null;
  const changeKey = header?.changeKey ?? prev?.changeKey ?? null;
  const seenKey = prev?.seenKey ?? changeKey;
  return { title, changeKey, seenKey };
}

export function faceHeaderView(entry: FaceHeaderEntry | undefined): FaceHeaderView {
  if (!entry) return EMPTY_VIEW;
  return { title: entry.title, unseen: entry.changeKey !== null && entry.seenKey !== null && entry.changeKey !== entry.seenKey };
}

function put(nodeId: string, entry: FaceHeaderEntry): void {
  const prev = entries.get(nodeId);
  if (prev && prev.title === entry.title && prev.changeKey === entry.changeKey && prev.seenKey === entry.seenKey) return;
  entries.delete(nodeId);
  entries.set(nodeId, entry);
  views.set(nodeId, faceHeaderView(entry));
  while (entries.size > ENTRIES_MAX) {
    const oldest = [...entries.keys()].find((id) => !listeners.get(id)?.size);
    if (oldest === undefined) break;
    entries.delete(oldest);
    views.delete(oldest);
  }
  for (const listener of [...(listeners.get(nodeId) ?? [])]) listener();
}

export function reportFaceHeader(nodeId: string, header: AppFaceHeader | null): void {
  put(nodeId, nextFaceHeader(entries.get(nodeId), header));
}

/** 지금 열쇠를 본 것으로(포인터를 올렸다 · 골랐다). */
export function markFaceSeen(nodeId: string): void {
  const prev = entries.get(nodeId);
  if (!prev || prev.seenKey === prev.changeKey) return;
  put(nodeId, { ...prev, seenKey: prev.changeKey });
}

/** 구독 없이 지금 머리줄(시험·훅 밖). */
export function peekFaceHeader(nodeId: string): FaceHeaderView {
  return views.get(nodeId) ?? EMPTY_VIEW;
}

export function useFaceHeader(nodeId: string): FaceHeaderView {
  const subscribe = useCallback((listener: () => void): (() => void) => {
    let set = listeners.get(nodeId);
    if (!set) { set = new Set(); listeners.set(nodeId, set); }
    set.add(listener);
    return () => {
      const current = listeners.get(nodeId);
      current?.delete(listener);
      if (current && current.size === 0) listeners.delete(nodeId);
    };
  }, [nodeId]);
  const get = useCallback((): FaceHeaderView => peekFaceHeader(nodeId), [nodeId]);
  return useSyncExternalStore(subscribe, get, get);
}

/** 시험 전용 — 모듈 상태를 처음으로. */
export function __resetFaceHeadersForTest(): void {
  entries.clear();
  views.clear();
  listeners.clear();
}
