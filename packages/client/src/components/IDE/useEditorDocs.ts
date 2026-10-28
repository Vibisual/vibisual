import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceEol, WorkspaceFileContent, WorkspaceFileSaveResult } from '@vibisual/shared';
import { isDirty } from './editorModel.js';
import { registerIDEEditorDrafts } from '../../stores/ideEditorClose.js';
import { workspaceMediaQuery } from '../../utils/workspaceMedia.js';

/** §5.5 #17-27 내장 편집창의 서버 대화(읽기·저장·초안 보관). 탭을 오가도 초안이 살도록 relPath 별로 들고 있다(탭을 닫을 때만 버린다). */

export interface EditorDoc {
  status: 'loading' | 'ready' | 'error';
  /** 디스크에서 읽은 본문(저장 성공 시 갱신) — dirty 판정의 기준 */
  diskText: string;
  /** 화면에서 고치는 중인 본문 */
  draft: string;
  /** 읽을 때 본 수정 시각 — 저장할 때 되돌려 보내 그 사이 변경을 판정 */
  mtimeMs: number;
  revision?: string;
  eol: WorkspaceEol;
  size: number;
  truncated: boolean;
  binary: boolean;
  /** §5.5 #17-27 ⑭ — 그림으로 그릴 자리인가(서버 판정). `binary`("저장하지 마라")와 뜻이 다르다 — "본문 대신 미리보기를 그려라". */
  image: boolean;
  /**
   * §5.5 #17-27 ⑫ — 디스크가 쓰기를 막고 있는가(Perforce 체크아웃 전 파일 등).
   *
   * `truncated`/`binary` 와 달리 **타이핑을 막지 않는다** — 고쳐 두었다가 저장하는 순간 잠금을 푼다.
   */
  readOnly: boolean;
  /**
   * §5.5 #17-27 ⑥ — 열린 프로젝트 루트 **밖** 파일(캔버스에 버블로 떠 있어 읽기만 열렸다 — 서버 판정 그대로). 보기만 한다 —
   * `readOnly` 와 달리 풀 수 없다(쓰기는 루트 안만이다).
   */
  outside: boolean;
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
  outside: false,
  saving: false,
  conflict: false,
  saveError: null,
  savedAt: 0,
};

/**
 * 탭 열쇠(`relPath`) → 서버 루트·경로. 탭은 루트 기준 상대 경로이거나 절대경로(§5.1 #2-1 (A) 루트 밖 버블 파일)다 — 절대는 폴더 + 이름으로 푼다.
 * 서버는 그 폴더가 프로젝트 안이면 읽고 쓰고, 밖이면 버블로 떠 있는 그 파일만 읽는다.
 */
export function editorFileQuery(root: string, relPath: string): { readonly root: string; readonly path: string } {
  return workspaceMediaQuery(root, relPath);
}

async function fetchFile(root: string, relPath: string): Promise<WorkspaceFileContent | null> {
  try {
    const query = editorFileQuery(root, relPath);
    const res = await fetch(
      `/api/workspace-file?root=${encodeURIComponent(query.root)}&path=${encodeURIComponent(query.path)}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as WorkspaceFileContent;
  } catch {
    return null;
  }
}

async function putFile(
  body: { root: string; path: string; text: string; eol: WorkspaceEol; baseMtimeMs: number; baseRevision?: string; clearReadOnly?: boolean },
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
export function useEditorDocs(rootPath: string | null, paneKey?: string): EditorDocsApi {
  // 프로젝트를 떠났다 돌아와도 이전 요청을 되살리지 않는다. 파일마다 재읽기/닫기 소유권도 둔다.
  const scope = useMemo(() => ({ requests: new Map<string, symbol>(), saves: new Set<symbol>() }), [rootPath]);
  const activeScope = useRef<typeof scope | null>(scope);
  activeScope.current = scope;
  const [state, setState] = useState({ scope, docs: {} as Record<string, EditorDoc> });
  const docs = state.scope === scope ? state.docs : {};
  const currentDocs = useRef(docs);
  currentDocs.current = docs;
  useEffect(() => {
    if (paneKey === undefined) return;
    return registerIDEEditorDrafts(paneKey, () => Object.fromEntries(
      Object.entries(currentDocs.current)
        .filter(([, doc]) => doc.draft !== doc.diskText)
        .map(([path, doc]) => [path, doc.draft]),
    ));
  }, [paneKey, scope]);
  const setDocs = useCallback((update: (prev: Record<string, EditorDoc>) => Record<string, EditorDoc>): void => {
    setState((prev) => {
      if (activeScope.current !== scope) return prev;
      const current = prev.scope === scope ? prev.docs : {};
      const next = update(current);
      return next === current && prev.scope === scope ? prev : { scope, docs: next };
    });
  }, [scope]);
  useEffect(() => {
    activeScope.current = scope;
    return () => { if (activeScope.current === scope) activeScope.current = null; };
  }, [scope]);

  const patch = useCallback((relPath: string, next: Partial<EditorDoc>, request?: symbol): void => {
    setDocs((prev) => {
      const cur = prev[relPath];
      if (!cur || (request && scope.requests.get(relPath) !== request)) return prev;
      return { ...prev, [relPath]: { ...cur, ...next } };
    });
  }, [setDocs, scope]);

  const load = useCallback((relPath: string): void => {
    if (!rootPath || activeScope.current !== scope) return;
    const request = Symbol(relPath);
    scope.requests.set(relPath, request);
    setDocs((prev) => ({ ...prev, [relPath]: { ...EMPTY_DOC, ...prev[relPath], status: 'loading' } }));
    void fetchFile(rootPath, relPath).then((file) => {
      if (activeScope.current !== scope || scope.requests.get(relPath) !== request) return;
      setDocs((prev) => {
        if (!prev[relPath] || scope.requests.get(relPath) !== request) return prev;
        if (!file) return { ...prev, [relPath]: { ...EMPTY_DOC, ...prev[relPath], status: 'error' } };
        return {
          ...prev,
          [relPath]: {
            ...EMPTY_DOC,
            status: 'ready',
            diskText: file.text,
            draft: file.text,
            mtimeMs: file.mtimeMs,
            revision: file.revision,
            eol: file.eol,
            size: file.size,
            truncated: file.truncated,
            binary: file.binary,
            image: file.image,
            readOnly: file.readOnly,
            outside: file.outside === true,
          },
        };
      });
    });
  }, [rootPath, scope, setDocs]);

  const ensureLoaded = useCallback((relPath: string): void => {
    setDocs((prev) => {
      if (prev[relPath]) return prev;
      // 자리를 먼저 잡아 두 번 요청하지 않게 한다(같은 탭을 연달아 눌러도 요청은 하나).
      return { ...prev, [relPath]: { ...EMPTY_DOC, status: 'loading' } };
    });
  }, [setDocs]);

  // 자리만 잡힌(아직 본문 없는) 문서를 실제로 읽어 온다 — 요청 발사는 렌더 밖에서.
  useEffect(() => {
    for (const [relPath, doc] of Object.entries(docs)) {
      if (doc.status === 'loading' && !scope.requests.has(relPath)) {
        load(relPath);
      }
    }
  }, [docs, load, scope]);

  const reload = useCallback((relPath: string): void => {
    load(relPath);
  }, [load]);

  const setDraft = useCallback((relPath: string, text: string): void => {
    patch(relPath, { draft: text, conflict: false, saveError: null });
  }, [patch]);

  const save = useCallback((relPath: string, opts?: { force?: boolean; clearReadOnly?: boolean }): void => {
    if (!rootPath || activeScope.current !== scope) return;
    const force = opts?.force === true;
    const clearReadOnly = opts?.clearReadOnly === true;
    const doc = docs[relPath];
    const request = scope.requests.get(relPath);
    if (!request || scope.saves.has(request)) return;
    if (!doc || doc.status !== 'ready' || doc.saving) return;
    // ⑥ 루트 밖 파일은 보기만 한다 — 서버도 쓰기를 루트 안으로만 받는다.
    if (doc.truncated || doc.binary || doc.outside) return;
    // ⑫ 잠금 해제는 고친 것이 없어도 보낸다 — 푸는 것 자체가 사용자가 누른 일이다.
    if (!force && !clearReadOnly && !isDirty(doc.diskText, doc.draft)) return;

    scope.saves.add(request);
    patch(relPath, { saving: true, saveError: null });
    const target = editorFileQuery(rootPath, relPath);
    void putFile({
      root: target.root,
      path: target.path,
      text: doc.draft,
      eol: doc.eol,
      baseMtimeMs: force ? 0 : doc.mtimeMs,
      ...(!force && doc.revision ? { baseRevision: doc.revision } : {}),
      ...(clearReadOnly ? { clearReadOnly: true } : {}),
    }).then((out) => {
      scope.saves.delete(request);
      if (activeScope.current !== scope || scope.requests.get(relPath) !== request) return;
      if (out.ok) {
        patch(relPath, {
          saving: false,
          conflict: false,
          saveError: null,
          diskText: doc.draft,
          mtimeMs: out.result.mtimeMs,
          revision: out.result.revision,
          size: out.result.size,
          readOnly: out.result.readOnly,
          savedAt: Date.now(),
        }, request);
        return;
      }
      patch(relPath, {
        saving: false,
        conflict: out.status === 409,
        saveError: out.status === 409 ? null : saveErrorKey(out.status),
        // 읽을 때 못 잰 잠금(ACL 등)은 여기서 드러난다 — 그 사실을 문서에 남겨 띠가 서게 한다.
        ...(out.status === 423 ? { readOnly: true } : {}),
      }, request);
    });
  }, [rootPath, docs, patch, scope]);

  const drop = useCallback((relPath: string): void => {
    scope.requests.delete(relPath);
    setDocs((prev) => {
      if (!prev[relPath]) return prev;
      const next = { ...prev };
      delete next[relPath];
      return next;
    });
  }, [scope, setDocs]);

  return { docs, ensureLoaded, reload, setDraft, save, drop };
}
