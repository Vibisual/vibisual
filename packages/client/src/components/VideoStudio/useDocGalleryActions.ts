import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { classifyStudioError } from './studioErrors.js';
import { docLabel } from './docGalleryModel.js';
import { DocInUseError, VersionConflictError, copyDoc, deleteDoc, patchDoc, readDoc, type DocSummary } from './videoApi.js';

/**
 * §5.13 (V) 37-1 — 갤러리 항목 메뉴의 동작: 복제 · 이름 바꾸기 · 삭제. 끝나면 문서 목록을 새로 읽고, 실패는 사람이 읽는 한 줄로 `notice` 에 둔다.
 * 이름 바꾸기는 머리줄 제목 고치기와 같은 `setDoc{title}` 연산이다 — 지금 열린 문서는 같은 길(`onRenameCurrent`), 다른 문서는 최신 판을 읽어 같은 연산을 보낸다.
 */

const COPY_TITLE_MAX = 200;

/** 다른 문서의 제목 — 최신 판을 읽어 연산을 보낸다(그 사이 에이전트가 고쳐 409 면 한 번 더 읽고 보낸다). */
export async function renameOtherDoc(project: string, docId: string, title: string): Promise<void> {
  const ops = [{ op: 'setDoc', patch: { title } }] as const;
  for (let attempt = 0; ; attempt += 1) {
    const { doc } = await readDoc(project, docId);
    try {
      await patchDoc(project, docId, doc.version, ops);
      return;
    } catch (err) {
      if (!(err instanceof VersionConflictError) || attempt >= 1) throw err;
    }
  }
}

export interface DocGalleryActionsInput {
  readonly project: string;
  readonly currentDocId: string | null;
  readonly onRenameCurrent: (title: string) => void;
  readonly onRefreshDocs: () => Promise<void>;
  readonly onDocDeleted: (docId: string) => void;
}

export interface DocGalleryActions {
  /** 지금 처리 중인 문서(그 카드는 잠깐 눌리지 않는다). */
  readonly busyId: string | null;
  /** 가장 최근 실패의 사람 말 한 줄. */
  readonly notice: string | null;
  readonly clearNotice: () => void;
  /** 이름을 바꾼 직후 목록이 새로 읽히기 전까지 보일 제목. */
  readonly titles: Readonly<Record<string, string>>;
  readonly duplicate: (doc: DocSummary) => Promise<void>;
  readonly rename: (doc: DocSummary, title: string) => Promise<void>;
  readonly remove: (doc: DocSummary) => Promise<boolean>;
}

export function useDocGalleryActions(input: DocGalleryActionsInput): DocGalleryActions {
  const { t } = useTranslation();
  const latest = useRef({ ...input, t });
  latest.current = { ...input, t };
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [titles, setTitles] = useState<Readonly<Record<string, string>>>({});
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const fail = useCallback((err: unknown): void => {
    const { t: tr } = latest.current;
    if (!alive.current) return;
    if (err instanceof DocInUseError) { setNotice(tr('panel.videoStudio.gallery.errInUse')); return; }
    const kind = classifyStudioError(err).kind;
    setNotice(tr(`panel.videoStudio.errors.${kind === 'coded' ? 'generic' : kind}`));
  }, []);

  const run = useCallback(async (docId: string, work: () => Promise<void>): Promise<boolean> => {
    setBusyId(docId);
    setNotice(null);
    try {
      await work();
      return true;
    } catch (err) {
      fail(err);
      return false;
    } finally {
      if (alive.current) setBusyId(null);
    }
  }, [fail]);

  const duplicate = useCallback(async (doc: DocSummary): Promise<void> => {
    const { project, onRefreshDocs, t: tr } = latest.current;
    const title = tr('panel.videoStudio.gallery.copyTitle', { title: docLabel(doc) }).slice(0, COPY_TITLE_MAX);
    await run(doc.id, async () => { await copyDoc(project, doc.id, title); await onRefreshDocs(); });
  }, [run]);

  const rename = useCallback(async (doc: DocSummary, title: string): Promise<void> => {
    const { project, currentDocId, onRenameCurrent, onRefreshDocs } = latest.current;
    const ok = await run(doc.id, async () => {
      if (doc.id === currentDocId) onRenameCurrent(title);
      else { await renameOtherDoc(project, doc.id, title); await onRefreshDocs(); }
    });
    if (ok && alive.current) setTitles((prev) => ({ ...prev, [doc.id]: title }));
  }, [run]);

  const remove = useCallback((doc: DocSummary): Promise<boolean> => run(doc.id, async () => {
    const { project, onDocDeleted } = latest.current;
    await deleteDoc(project, doc.id);
    onDocDeleted(doc.id);
  }), [run]);

  return { busyId, notice, clearNotice: useCallback(() => setNotice(null), []), titles, duplicate, rename, remove };
}
