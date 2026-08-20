import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceEol, WorkspaceFileContent, WorkspaceFileSaveResult } from '@vibisual/shared';
import { isDirty } from './editorModel.js';

/**
 * useEditorDocs.ts — §5.5 #17-27 v4.87 내장 편집창의 서버 대화 담당(파일 읽기·저장·초안 보관).
 *
 * 탐색기의 `useWorkspaceExplorer` 와 같은 자리의 훅이다 — 화면은 무엇을 그릴지만 알고,
 * "언제 읽고 언제 저장하는가" 는 여기 모은다. 탭을 오가도 **고치던 초안이 살아 있도록**
 * 문서를 relPath 별로 들고 있는다(탭을 닫을 때만 버린다).
 */

export interface EditorDoc {
  status: 'loading' | 'ready' | 'error';
  /** 디스크에서 읽은 본문(저장 성공 시 갱신) — dirty 판정의 기준 */
  diskText: string;
  /** 화면에서 고치는 중인 본문 */
  draft: string;
  /** 읽을 때 본 수정 시각 — 저장할 때 되돌려 보내 그 사이 변경을 판정 */
  mtimeMs: number;
  eol: WorkspaceEol;
  size: number;
  truncated: boolean;
  binary: boolean;
  /**
   * §5.5 #17-27 ⑭ — 이 문서를 **그림으로 그릴 자리**인가(서버 판정 그대로).
   *
   * `binary` 와 갈라 두는 이유는 뜻이 다르기 때문이다 — `binary` 는 "저장하지 마라"이고
   * 이 값은 "본문 대신 미리보기를 그려라"다. 이미지가 아닌 이진 파일은 종전 안내로 떨어진다.
   */
  image: boolean;
  /**
   * §5.5 #17-27 ⑫ — 디스크가 쓰기를 막고 있는가(Perforce 체크아웃 전 파일 등).
   *
   * `truncated`/`binary` 와 달리 **타이핑을 막지 않는다** — 고쳐 두었다가 저장하는 순간 잠금을 푼다.
   */
  readOnly: boolean;
  saving: boolean;
  /** 저장 시도가 디스크 변경으로 막혔는가(사용자가 [다시 읽기]/[그래도 저장]을 고른다) */
  conflict: boolean;
  /** 마지막 저장 실패 사유(표시용 키) */
  saveError: string | null;
  /** 마지막 저장 시각 — "저장됨" 표시를 잠깐 띄우는 용도 */
  savedAt: number;
}

export interface EditorDocsApi {
  docs: Record<string, EditorDoc>;
  /** 아직 안 읽었으면 읽어 온다(이미 읽었거나 읽는 중이면 아무것도 하지 않는다). */
  ensureLoaded: (relPath: string) => void;
  /** 디스크에서 다시 읽어 초안을 버린다(충돌 해소의 한쪽 답). */
  reload: (relPath: string) => void;
  setDraft: (relPath: string, text: string) => void;
  /**
   * 저장. `force` 면 수정 시각 대조를 건너뛴다(충돌 해소의 다른 쪽 답 = "그래도 저장").
   * `clearReadOnly` 면 디스크의 읽기 전용 잠금을 풀고 저장한다(§5.5 #17-27 ⑫) — 이때는
   * 고친 것이 없어도 보낸다(잠금을 푸는 것 자체가 사용자가 누른 일이다).
   */
  save: (relPath: string, opts?: { force?: boolean; clearReadOnly?: boolean }) => void;
  /** 탭을 닫을 때 — 그 문서와 초안을 버린다. */
  drop: (relPath: string) => void;
}

const EMPTY_DOC: Omit<EditorDoc, 'status'> = {
  diskText: '',
  draft: '',
  mtimeMs: 0,
  eol: 'lf',
  size: 0,
  truncated: false,
  binary: false,
  image: false,
  readOnly: false,
  saving: false,
  conflict: false,
  saveError: null,
  savedAt: 0,
};

async function fetchFile(root: string, relPath: string): Promise<WorkspaceFileContent | null> {
  try {
    const res = await fetch(
      `/api/workspace-file?root=${encodeURIComponent(root)}&path=${encodeURIComponent(relPath)}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as WorkspaceFileContent;
  } catch {
    return null;
  }
}

async function putFile(
  body: { root: string; path: string; text: string; eol: WorkspaceEol; baseMtimeMs: number; clearReadOnly?: boolean },
): Promise<{ ok: true; result: WorkspaceFileSaveResult } | { ok: false; status: number }> {
  try {
    const res = await fetch('/api/workspace-file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, result: (await res.json()) as WorkspaceFileSaveResult };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** 저장 실패 status → 화면에 띄울 i18n 키 꼬리. */
function saveErrorKey(status: number): string {
  if (status === 413) return 'tooLarge';
  if (status === 404) return 'missing';
  if (status === 403) return 'forbidden';
  // ⑫ 423 Locked — 디스크가 잠근 파일. 화면이 [읽기 전용 해제하고 저장]을 띄우는 유일한 사유다.
  if (status === 423) return 'readonly';
  return 'failed';
}

/** 루트가 바뀌면(프로젝트 전환) 열어 둔 문서를 통째로 버린다 — 같은 상대 경로가 다른 파일이 된다. */
export function useEditorDocs(rootPath: string | null): EditorDocsApi {
  const [docs, setDocs] = useState<Record<string, EditorDoc>>({});
  /** 늦게 도착한 응답이 새 루트/재읽기 결과를 덮지 않게 하는 세대 번호. */
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    setDocs({});
  }, [rootPath]);

  const patch = useCallback((relPath: string, next: Partial<EditorDoc>): void => {
    setDocs((prev) => {
      const cur = prev[relPath];
      if (!cur) return prev;
      return { ...prev, [relPath]: { ...cur, ...next } };
    });
  }, []);

  const load = useCallback((relPath: string): void => {
    if (!rootPath) return;
    const generation = generationRef.current;
    setDocs((prev) => ({ ...prev, [relPath]: { ...EMPTY_DOC, ...prev[relPath], status: 'loading' } }));
    void fetchFile(rootPath, relPath).then((file) => {
      if (generationRef.current !== generation) return;
      setDocs((prev) => {
        if (!prev[relPath]) return prev;
        if (!file) return { ...prev, [relPath]: { ...EMPTY_DOC, ...prev[relPath], status: 'error' } };
        return {
          ...prev,
          [relPath]: {
            ...EMPTY_DOC,
            status: 'ready',
            diskText: file.text,
            draft: file.text,
            mtimeMs: file.mtimeMs,
            eol: file.eol,
            size: file.size,
            truncated: file.truncated,
            binary: file.binary,
            image: file.image,
            readOnly: file.readOnly,
          },
        };
      });
    });
  }, [rootPath]);

  const ensureLoaded = useCallback((relPath: string): void => {
    setDocs((prev) => {
      if (prev[relPath]) return prev;
      // 자리를 먼저 잡아 두 번 요청하지 않게 한다(같은 탭을 연달아 눌러도 요청은 하나).
      return { ...prev, [relPath]: { ...EMPTY_DOC, status: 'loading' } };
    });
  }, []);

  // 자리만 잡힌(아직 본문 없는) 문서를 실제로 읽어 온다 — 요청 발사는 렌더 밖에서.
  const requestedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const [relPath, doc] of Object.entries(docs)) {
      if (doc.status === 'loading' && doc.mtimeMs === 0 && !requestedRef.current.has(relPath)) {
        requestedRef.current.add(relPath);
        load(relPath);
      }
    }
  }, [docs, load]);

  useEffect(() => {
    requestedRef.current = new Set();
  }, [rootPath]);

  const reload = useCallback((relPath: string): void => {
    requestedRef.current.delete(relPath);
    load(relPath);
  }, [load]);

  const setDraft = useCallback((relPath: string, text: string): void => {
    patch(relPath, { draft: text, conflict: false, saveError: null });
  }, [patch]);

  const save = useCallback((relPath: string, opts?: { force?: boolean; clearReadOnly?: boolean }): void => {
    if (!rootPath) return;
    const force = opts?.force === true;
    const clearReadOnly = opts?.clearReadOnly === true;
    const doc = docs[relPath];
    if (!doc || doc.status !== 'ready' || doc.saving) return;
    if (doc.truncated || doc.binary) return;
    // ⑫ 잠금 해제는 고친 것이 없어도 보낸다 — 푸는 것 자체가 사용자가 누른 일이다.
    if (!force && !clearReadOnly && !isDirty(doc.diskText, doc.draft)) return;

    const generation = generationRef.current;
    patch(relPath, { saving: true, saveError: null });
    void putFile({
      root: rootPath,
      path: relPath,
      text: doc.draft,
      eol: doc.eol,
      baseMtimeMs: force ? 0 : doc.mtimeMs,
      ...(clearReadOnly ? { clearReadOnly: true } : {}),
    }).then((out) => {
      if (generationRef.current !== generation) return;
      if (out.ok) {
        patch(relPath, {
          saving: false,
          conflict: false,
          saveError: null,
          diskText: doc.draft,
          mtimeMs: out.result.mtimeMs,
          size: out.result.size,
          readOnly: out.result.readOnly,
          savedAt: Date.now(),
        });
        return;
      }
      patch(relPath, {
        saving: false,
        conflict: out.status === 409,
        saveError: out.status === 409 ? null : saveErrorKey(out.status),
        // 읽을 때 못 잰 잠금(ACL 등)은 여기서 드러난다 — 그 사실을 문서에 남겨 띠가 서게 한다.
        ...(out.status === 423 ? { readOnly: true } : {}),
      });
    });
  }, [rootPath, docs, patch]);

  const drop = useCallback((relPath: string): void => {
    requestedRef.current.delete(relPath);
    setDocs((prev) => {
      if (!prev[relPath]) return prev;
      const next = { ...prev };
      delete next[relPath];
      return next;
    });
  }, []);

  return { docs, ensureLoaded, reload, setDraft, save, drop };
}
