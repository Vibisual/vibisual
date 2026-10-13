import { useCallback, useEffect, useRef, useState } from 'react';
import type { NoteStatus, VideoNote } from '@vibisual/video';

import { addNote, deleteNote, patchNote, readNotes } from './studioApi.js';

/**
 * §5.13 (V) 37-7 — **메모 핀** 상태: 목록(문서가 다시 읽힐 때마다·바퀴가 끝날 때마다 새로), 꽂기·고치기·확인(닫기)·지우기·
 * 맡겼다고 적기. 저장은 서버(프로젝트 안 파일)가 하고 화면은 그 목록을 그대로 그린다(§3.1). 쓰기는 낙관적으로 먼저 보이고
 * 실패하면 다시 읽는다.
 */
export interface StudioNotes {
  readonly notes: readonly VideoNote[];
  /** 아직 맡기지 않은 메모(열림). */
  readonly open: readonly VideoNote[];
  readonly add: (input: { t: number; x: number; y: number; text: string; itemId?: string; chapterId?: string; element?: string }) => Promise<VideoNote | null>;
  readonly setText: (noteId: string, text: string) => void;
  readonly setStatus: (noteId: string, status: NoteStatus, passId?: string) => void;
  readonly remove: (noteId: string) => void;
  readonly refresh: () => void;
}

/** 에이전트가 메모를 고쳤는지 묻는 간격(ms) — 보낸 메모가 있을 때만. */
const NOTES_POLL_MS = 4000;

export function useStudioNotes(project: string, docId: string, reloadTick: number, onError: (err: unknown) => void): StudioNotes {
  const [notes, setNotes] = useState<readonly VideoNote[]>([]);
  const [tick, setTick] = useState(0);
  const errRef = useRef(onError);
  errRef.current = onError;
  const scope = useRef({ project, docId });
  scope.current = { project, docId };

  useEffect(() => { setNotes([]); }, [project, docId]);

  useEffect(() => {
    if (project === '' || docId === '') return;
    let alive = true;
    readNotes(project, docId)
      .then((list) => { if (alive) setNotes(list); })
      .catch(() => undefined); // 메모가 없는 문서 — 빈 목록이 맞다.
    return () => { alive = false; };
  }, [project, docId, reloadTick, tick]);

  // 맡긴 메모가 있으면 에이전트의 '고침'을 기다리며 가볍게 다시 읽는다(문서가 안 바뀌어도 메모만 고칠 수 있다).
  const waiting = notes.some((n) => n.status === 'sent');
  useEffect(() => {
    if (!waiting || project === '' || docId === '') return;
    const timer = setInterval(() => setTick((n) => n + 1), NOTES_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, project, docId]);

  const refresh = useCallback((): void => setTick((n) => n + 1), []);

  const add = useCallback(async (input: { t: number; x: number; y: number; text: string; itemId?: string; chapterId?: string; element?: string }): Promise<VideoNote | null> => {
    const at = scope.current;
    try {
      const note = await addNote(at.project, at.docId, input);
      if (scope.current.project === at.project && scope.current.docId === at.docId) setNotes((prev) => [...prev, note]);
      return note;
    } catch (err) {
      errRef.current(err);
      return null;
    }
  }, []);

  const write = useCallback((noteId: string, patch: { status?: NoteStatus; text?: string; passId?: string }): void => {
    const at = scope.current;
    setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, ...patch, updatedAt: Date.now() } : n)));
    patchNote(at.project, at.docId, noteId, patch)
      .then((saved) => { if (scope.current.docId === at.docId) setNotes((prev) => prev.map((n) => (n.id === noteId ? saved : n))); })
      .catch((err: unknown) => { errRef.current(err); refresh(); });
  }, [refresh]);

  const setText = useCallback((noteId: string, text: string): void => write(noteId, { text }), [write]);
  const setStatus = useCallback((noteId: string, status: NoteStatus, passId?: string): void => write(noteId, { status, ...(passId ? { passId } : {}) }), [write]);

  const remove = useCallback((noteId: string): void => {
    const at = scope.current;
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
    deleteNote(at.project, at.docId, noteId).catch((err: unknown) => { errRef.current(err); refresh(); });
  }, [refresh]);

  return { notes, open: notes.filter((n) => n.status === 'open'), add, setText, setStatus, remove, refresh };
}
