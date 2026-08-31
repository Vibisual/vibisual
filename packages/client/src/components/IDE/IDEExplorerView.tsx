import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WORKSPACE_DIR_ENTRY_MAX } from '@vibisual/shared';
import type { WorkspaceEntry, WorkspacePathKind } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { ScrollFade } from '../ScrollFade.js';
import { flattenExplorerRows, splitRelPath, workspaceMutateErrorKey, type ExplorerDraft } from './explorerModel.js';
import { editorFileFromAbsPath, editorFileFromRelPath } from './editorModel.js';
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  fetchWorkspaceTrashAvailable,
  moveWorkspaceEntry,
  openFolderByPath,
  openWorkspaceFile,
  renameWorkspaceEntry,
  useWorkspaceExplorer,
  workspaceAbsPath,
} from './useWorkspaceExplorer.js';
import { useIDEProjectRoot } from './useIDEProjectRoot.js';
import { readIDEPane, useIDEPaneActions, useIDEPaneKey } from './idePane.js';
import { useInsertPathIntoInput } from './useInsertPathIntoInput.js';
import {
  WORKSPACE_DRAG_MIME,
  WORKSPACE_DRAG_DIR_MIME,
  clearActiveWorkspaceDrag,
  decodeWorkspaceDrag,
  encodeWorkspaceDrag,
  parentRelOf,
  readActiveWorkspaceDrag,
  setActiveWorkspaceDrag,
  workspaceMoveBlock,
  type WorkspaceDragPayload,
} from './explorerDrag.js';
import { openWorkspaceTarget } from './openWorkspaceTarget.js';
import { IDEContextMenu, type ContextMenuItem } from './IDEContextMenu.js';
import { buildExplorerEntryMenuItems, buildExplorerRootMenuItems } from './explorerContextMenu.js';
import { IDEExplorerTree } from './IDEExplorerTree.js';
import { IDEExplorerEdited } from './IDEExplorerEdited.js';

/**
 * §5.5 #17-19 v4.71 — 활동바 **파일**이 여는 사이드바 = 워크스페이스 탐색기.
 *
 * 종전 파일 뷰는 이 에이전트가 만진 파일의 basename 만 나열해, 그 파일이 어디 있는지도
 * 아직 안 만진 파일이 무엇인지도 알 수 없었다. 이제 프로젝트 루트에서 시작하는 실제 디렉터리
 * 트리를 그리고, 경로는 세 곳에서 보인다 — 계층(들여쓰기) · 행 툴팁 · 바닥 경로 줄.
 *
 * ⑦ — 그 트리는 **읽기 전용이 아니다**. 다른 IDE 와 같은 자리(우클릭)에서 만들고, 이름을 바꾸고,
 * 지운다. 되돌릴 수 없는 것(삭제)만 되물으며, 지운 것은 OS 휴지통으로 간다.
 */

export const IDEExplorerView = memo(function IDEExplorerView({ agentId }: { agentId: string }): React.JSX.Element {
  const { t } = useTranslation();
  // §5.5 #17-27 — 트리 루트 판정은 편집창과 같은 훅 하나를 쓴다(둘이 갈라지면 같은 상대 경로가 다른 파일이 된다).
  const rootPath = useIDEProjectRoot();
  // §5.5 #17-1 — 탐색기에서 연 파일은 **이 창의** 편집창에 뜬다.
  const paneKey = useIDEPaneKey();
  const { openEditorFile: openInEditor, closeEditorFile } = useIDEPaneActions();
  /** #17-29 — 훅 버블은 전면 읽기 전용이라 넣을 입력창 자체가 없다(그때는 복사만 하고 이름도 갈린다). */
  const isCustom = useGraphStore((s) => s.nodeMap[agentId]?.customCreated ?? false);
  const { cache, expanded, loading, truncated, failed, rootError, toggleDir, collapseAll, refresh, refreshDir, expandDir } =
    useWorkspaceExplorer(rootPath);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  /** §5.5 #17-19 ③(c) — 복사 표시는 **행 단위**다(바닥 줄 버튼 하나였을 때의 boolean 이 아니다). */
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  /** ⑦ — 우클릭 메뉴(트리 행 · 빈 자리 공용 — 위젯은 IDE 공용 `IDEContextMenu` 하나다). */
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  /** ⑦ — 지금 이름을 치고 있는 자리. 트리 안의 한 줄로 뜬다(별도 창 ❌). */
  const [draft, setDraft] = useState<ExplorerDraft | null>(null);
  /** ⑦ — 바닥 줄에 잠깐 뜨는 한 줄(실패 사유 · 지운 결과). 경로 표시를 잠시 대신한다. */
  const [notice, setNotice] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);
  /**
   * ⑦ — 이 실행 형태가 휴지통을 쓸 수 있는가. **되물음 문구가 갈리는 값**이라 미리 물어 둔다
   * (되돌릴 수 있는 삭제와 영구 삭제는 사용자가 다른 결정을 내리는 문장이다).
   */
  const [trashAvailable, setTrashAvailable] = useState(false);

  const rows = useMemo(() => flattenExplorerRows(cache, expanded), [cache, expanded]);
  const rootName = useMemo(() => {
    if (!rootPath) return '';
    const parts = rootPath.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
    return parts[parts.length - 1] ?? rootPath;
  }, [rootPath]);

  useEffect(() => {
    let alive = true;
    void fetchWorkspaceTrashAvailable().then((available) => { if (alive) setTrashAvailable(available); });
    return () => { alive = false; };
  }, []);

  /** 프로젝트를 갈아타면 치던 이름·안내 줄은 남겨 둘 이유가 없다(그 트리의 것이었다). */
  useEffect(() => {
    setDraft(null);
    setNotice(null);
    setMenu(null);
  }, [rootPath]);

  /** 안내 줄은 잠깐만 — 다음 안내가 오면 그것으로 갈리고, 아무 일도 없으면 경로 표시로 돌아간다. */
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /** 앱 밖 편집기로 열기 — ↗ 버튼과 더블클릭(종전 동작 그대로 병행). */
  const handleOpenFile = useCallback((relPath: string) => {
    if (!rootPath) return;
    setSelectedPath(relPath);
    openWorkspaceFile(rootPath, relPath);
  }, [rootPath]);

  /**
   * §5.5 #17-27 / §5.13 (R-7) — 한 번 클릭 = **그 파일이 열릴 곳**에서 열기(선택 표시도 함께).
   *
   * 종전에는 무조건 편집창으로 보냈다. 영상·음악·3D·압축이 전부 그리로 갔고, 그중 대부분은
   * "바이너리 파일" 한 줄로 끝났다. 이제 본문의 경로 손잡이와 **같은 판정**을 쓴다.
   */
  const handleSelectFile = useCallback(
    (relPath: string, executable?: boolean) => {
      setSelectedPath(relPath);
      if (!rootPath) return;
      const file = editorFileFromRelPath(relPath, rootPath);
      void openWorkspaceTarget(
        { relPath, absPath: file.absPath, kind: 'file', ...(executable === true ? { executable: true } : {}) },
        rootPath,
        t('ide.streamRenderer.pathLink.runFailed'),
        paneKey,
      );
    },
    [rootPath, t, paneKey],
  );

  /** §5.5 #17-27 — 편집한 파일 구역은 절대 경로를 이미 알고 있다(루트 밖 파일도 그대로 열린다). */
  const handleOpenEdited = useCallback((absPath: string, relPath: string) => {
    setSelectedPath(relPath);
    openInEditor(editorFileFromAbsPath(absPath, rootPath));
  }, [rootPath, openInEditor]);

  const insertPathIntoInput = useInsertPathIntoInput(agentId);

  /**
   * §5.5 #17-19 ③-1 (b) — 클립보드에 남기는 것은 **절대 경로**다.
   *
   * 루트 기준 상대 경로는 루트 바로 밑의 파일에서 파일 이름과 글자 그대로 같아져, `경로 복사`를
   * 눌렀는데 이름만 나오는 것으로 읽힌다(사용자 지적). 편집창 탭(#17-27)의 `경로 복사`(`absPath`)·
   * 활동바 루트 복사(⑦-2)가 내놓는 문자열과 이제 같은 값이다.
   *
   * 되돌림 타이머는 "그 사이 다른 행을 눌렀으면 건드리지 않는다" — 그러지 않으면 앞 행의
   * 타이머가 방금 누른 뒷 행의 체크 표시를 지운다.
   */
  const copyPathToClipboard = useCallback((relPath: string) => {
    if (!relPath || !rootPath) return;
    void navigator.clipboard?.writeText(workspaceAbsPath(rootPath, relPath))
      .catch(() => { /* 클립보드 거부는 조용히 무시 */ });
    setCopiedPath(relPath);
    window.setTimeout(() => setCopiedPath((prev) => (prev === relPath ? null : prev)), 1200);
  }, [rootPath]);

  /**
   * §5.5 #17-19 ③-1 — 행 손잡이(그 행 옆, 바닥 줄 ❌)를 누르면 **입력창에 넣고 클립보드에도 남긴다**.
   *
   * 우클릭 메뉴의 `경로 복사`와 일부러 갈라 둔다 — 다른 IDE 에서 그 메뉴 항목은 복사만 하는
   * 자리라, 거기서 입력창에 타이핑까지 하면 놀란다. 손잡이 쪽은 이름도 그 둘을 다 적는다.
   *
   * 체크 표시는 **넣은 사실**에 반응한다(종전에는 클립보드 성공 콜백에만 달려 있어, 브라우저가
   * 클립보드를 거절하면 넣어 놓고도 아무 일 없는 것처럼 보였다).
   */
  const handleTakePath = useCallback((relPath: string) => {
    if (!relPath || !rootPath) return;
    insertPathIntoInput(workspaceAbsPath(rootPath, relPath));
    copyPathToClipboard(relPath);
  }, [rootPath, insertPathIntoInput, copyPathToClipboard]);

  const rootLoading = loading.has('');

  // ─── ⑦ 우클릭이 내는 쓰기 ───────────────────────────────────────────────────

  /** 시스템 탐색기에서 보기 — 파일을 넘겨도 서버가 그 파일이 든 폴더를 연다(`openFolder`). */
  const revealInFileExplorer = useCallback((relPath: string) => {
    if (!rootPath) return;
    openFolderByPath(workspaceAbsPath(rootPath, relPath), relPath);
  }, [rootPath]);

  /** 새로 만들기 — 부모 폴더를 펼쳐 두고 그 첫 자식 자리에 입력칸을 세운다. */
  const startCreate = useCallback((parent: string, kind: WorkspacePathKind) => {
    if (parent) expandDir(parent);
    setDraft({ mode: 'create', parent, kind });
  }, [expandDir]);

  const startRename = useCallback((entry: WorkspaceEntry) => {
    const { dir } = splitRelPath(entry.relPath);
    setDraft({ mode: 'rename', relPath: entry.relPath, parent: dir, initial: entry.name, isDirectory: entry.isDirectory });
  }, []);

  /** 열려 있는 편집 탭 중 이 경로(폴더면 그 아래 전부)에 해당하는 것들. */
  const openTabsUnder = useCallback((relPath: string): string[] => {
    const files = readIDEPane(paneKey).editorFiles;
    const prefix = `${relPath}/`;
    return files.filter((f) => f.relPath === relPath || f.relPath.startsWith(prefix)).map((f) => f.relPath);
  }, [paneKey]);

  /**
   * §5.5 #17-19 ⑧ — 행을 집어 든다. 짐표에는 **종류(MIME)와 값**을 함께 싣는다 — `dragover` 중에는
   * 값을 못 읽어 종류로만 판정하기 때문이다(#17-34 가 세운 규약 그대로).
   *
   * `text/plain` 도 함께 싣는 이유는 **바깥**이다 — 다른 앱·터미널·다른 입력칸에 놓으면 그 경로 글자가
   * 그대로 떨어진다(우리 화면 밖에서도 헛손질이 되지 않게).
   */
  const handleEntryDragStart = useCallback((e: React.DragEvent, entry: WorkspaceEntry) => {
    if (!rootPath) return;
    const payload: WorkspaceDragPayload = {
      root: rootPath,
      relPath: entry.relPath,
      name: entry.name,
      isDirectory: entry.isDirectory,
      absPath: workspaceAbsPath(rootPath, entry.relPath),
    };
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(WORKSPACE_DRAG_MIME, encodeWorkspaceDrag(payload));
    if (entry.isDirectory) e.dataTransfer.setData(WORKSPACE_DRAG_DIR_MIME, '1');
    e.dataTransfer.setData('text/plain', payload.absPath);
    setActiveWorkspaceDrag(payload);
  }, [rootPath]);

  const handleEntryDragEnd = useCallback(() => clearActiveWorkspaceDrag(), []);

  /**
   * ⑧ — 끌고 있는 동안의 판정(파란 테두리를 띄울지). 등록소가 비어 있으면 **막지 않는다** —
   * 별창에서 건너온 짐이 그렇고, 그때는 손을 뗄 때 같은 판정이 한 번 더 선다.
   */
  const canDropInto = useCallback((targetDirRel: string): boolean => {
    if (!rootPath) return false;
    const drag = readActiveWorkspaceDrag();
    if (!drag) return true;
    return workspaceMoveBlock(drag, rootPath, targetDirRel) === null;
  }, [rootPath]);

  /**
   * ⑧ — 폴더 위에서 손을 뗐다. **되물음은 여기서** 뜬다 — 되돌릴 수 없는 쓰기의 되물음은 언제나
   * 화면의 몫이고(⑦ 삭제와 같은 분담), 방식도 그 자리와 같은 것 하나(`window.confirm`)를 쓴다.
   *
   * 옮기고 나면 **열려 있던 탭은 옛 경로를 가리킨다** — 그대로 두면 저장이 없는 파일로 간다.
   * 그래서 영향을 받은 탭은 닫고, 방금 옮긴 그 파일만 새 자리에서 다시 연다(있던 자리를 잃지 않게).
   */
  const handleEntryDrop = useCallback((e: React.DragEvent, targetDir: WorkspaceEntry) => {
    if (!rootPath) return;
    const drag = decodeWorkspaceDrag(e.dataTransfer.getData(WORKSPACE_DRAG_MIME));
    clearActiveWorkspaceDrag();
    if (!drag) return;

    const block = workspaceMoveBlock(drag, rootPath, targetDir.relPath);
    if (block !== null) {
      // 헛손질(제자리·자기 자신)은 조용히 넘긴다 — 사용자가 이미 아는 사실을 말할 필요가 없다.
      if (block === 'into-self') setNotice({ text: t('ide.explorer.ctx.err.intoSelf'), tone: 'error' });
      else if (block === 'other-root') setNotice({ text: t('ide.explorer.ctx.err.outside'), tone: 'error' });
      return;
    }
    if (!window.confirm(t('ide.explorer.ctx.confirmMove', { name: drag.name, folder: targetDir.name }))) return;

    const fromDir = parentRelOf(drag.relPath);
    const openTabs = openTabsUnder(drag.relPath);
    const wasOpen = openTabs.includes(drag.relPath);
    void (async () => {
      const reply = await moveWorkspaceEntry(rootPath, drag.relPath, targetDir.relPath);
      if (!reply.ok) {
        setNotice({ text: t(workspaceMutateErrorKey(reply.error)), tone: 'error' });
        return;
      }
      refreshDir(fromDir);
      refreshDir(targetDir.relPath);
      for (const relPath of openTabs) closeEditorFile(relPath);
      if (wasOpen && !reply.result.isDirectory) openInEditor(editorFileFromRelPath(reply.result.path, rootPath));
      setSelectedPath((prev) => (prev === drag.relPath ? reply.result.path : prev));
      setNotice({ text: t('ide.explorer.ctx.moved', { name: drag.name, folder: targetDir.name }), tone: 'info' });
    })();
  }, [rootPath, t, refreshDir, openTabsUnder, closeEditorFile, openInEditor]);

  const handleDraftCancel = useCallback(() => setDraft(null), []);

  /**
   * 입력칸에서 Enter(또는 바깥 누름) — 여기서 서버에 낸다.
   *
   * 실패는 바닥 줄 한 줄로 말하고 **입력칸은 닫는다**(같은 이름을 다시 치게 붙잡아 두면, 이미
   * 있는 이름인지 권한 문제인지 읽지 않고 계속 부딪힌다). 성공하면 그 한 겹만 다시 읽는다.
   */
  const handleDraftCommit = useCallback((name: string) => {
    const current = draft;
    setDraft(null);
    if (!current || !rootPath) return;

    void (async () => {
      if (current.mode === 'create') {
        const reply = await createWorkspaceEntry(rootPath, current.parent, name, current.kind);
        if (!reply.ok) {
          setNotice({ text: t(workspaceMutateErrorKey(reply.error)), tone: 'error' });
          return;
        }
        refreshDir(current.parent);
        setSelectedPath(reply.result.path);
        // 만든 파일은 바로 그 자리에서 열어 준다(폴더는 펼쳐 둔다) — 만들고 나서 다시 찾아 누르지 않게.
        if (current.kind === 'directory') expandDir(reply.result.path);
        else openInEditor(editorFileFromRelPath(reply.result.path, rootPath));
        return;
      }

      if (name === current.initial) return;
      const openTabs = openTabsUnder(current.relPath);
      const reply = await renameWorkspaceEntry(rootPath, current.relPath, name);
      if (!reply.ok) {
        setNotice({ text: t(workspaceMutateErrorKey(reply.error)), tone: 'error' });
        return;
      }
      refreshDir(current.parent);
      setSelectedPath(reply.result.path);
      // 열려 있던 탭은 **더 이상 그 경로가 아니다** — 닫고, 바뀐 파일 자신은 새 이름으로 다시 연다
      // (폴더 아래 여러 탭은 닫기만 한다 — 어느 것을 다시 띄울지는 사용자가 고를 일이다).
      for (const relPath of openTabs) closeEditorFile(relPath);
      if (!current.isDirectory && openTabs.includes(current.relPath)) {
        openInEditor(editorFileFromRelPath(reply.result.path, rootPath));
      }
    })();
  }, [draft, rootPath, t, refreshDir, expandDir, openInEditor, closeEditorFile, openTabsUnder]);

  /** 삭제 — 되돌릴 수 없는 유일한 항목이라 **여기서만** 되묻는다. */
  const requestDelete = useCallback((entry: WorkspaceEntry) => {
    if (!rootPath) return;
    const message = trashAvailable
      ? t('ide.explorer.ctx.confirmTrash', { name: entry.name })
      : t('ide.explorer.ctx.confirmDelete', { name: entry.name });
    if (!window.confirm(message)) return;

    const { dir } = splitRelPath(entry.relPath);
    const openTabs = openTabsUnder(entry.relPath);
    void (async () => {
      const reply = await deleteWorkspaceEntry(rootPath, entry.relPath);
      if (!reply.ok) {
        setNotice({ text: t(workspaceMutateErrorKey(reply.error)), tone: 'error' });
        return;
      }
      refreshDir(dir);
      for (const relPath of openTabs) closeEditorFile(relPath);
      setSelectedPath((prev) => (prev === entry.relPath ? null : prev));
      setNotice({
        text: reply.result.trashed
          ? t('ide.explorer.ctx.trashed', { name: entry.name })
          : t('ide.explorer.ctx.deleted', { name: entry.name }),
        tone: 'info',
      });
    })();
  }, [rootPath, trashAvailable, t, refreshDir, closeEditorFile, openTabsUnder]);

  /** 트리 행 우클릭 — 고른 행을 표시로 옮기고(무엇에 대한 메뉴인지 보이게) 그 행의 메뉴를 연다. */
  const handleRowContextMenu = useCallback((e: React.MouseEvent, entry: WorkspaceEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedPath(entry.relPath);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: buildExplorerEntryMenuItems(
        { isDirectory: entry.isDirectory },
        {
          open: () => handleSelectFile(entry.relPath, entry.executable === true),
          openExternal: () => handleOpenFile(entry.relPath),
          revealFolder: () => revealInFileExplorer(entry.relPath),
          newFile: () => startCreate(entry.relPath, 'file'),
          newFolder: () => startCreate(entry.relPath, 'directory'),
          copyPath: () => copyPathToClipboard(entry.relPath),
          rename: () => startRename(entry),
          remove: () => requestDelete(entry),
        },
        t,
      ),
    });
  }, [handleSelectFile, handleOpenFile, revealInFileExplorer, startCreate, copyPathToClipboard, startRename, requestDelete, t]);

  /** 트리 빈 자리 우클릭 — 대상은 루트다(자기 자신을 지우거나 이름 바꾸는 항목은 없다). */
  const handleRootContextMenu = useCallback((e: React.MouseEvent) => {
    if (!rootPath) return;
    e.preventDefault();
    // IDE 창은 DOM 상 캔버스의 자식이라(§5.5 #17-6) 여기서 멈춰 세우지 않으면 손짓이 캔버스까지 올라간다.
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: buildExplorerRootMenuItems(
        {
          newFile: () => startCreate('', 'file'),
          newFolder: () => startCreate('', 'directory'),
          revealFolder: () => revealInFileExplorer(''),
          copyPath: () => { void navigator.clipboard?.writeText(rootPath).catch(() => { /* 거부는 무시 */ }); },
          refresh,
        },
        t,
      ),
    });
  }, [rootPath, startCreate, revealInFileExplorer, refresh, t]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 헤더 — 루트 이름(전체 경로는 툴팁) + 새로고침 / 모두 접기 */}
      <div className="flex items-center gap-1 border-b border-gray-800 px-1.5 py-1" onContextMenu={handleRootContextMenu}>
        <span
          className="min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-wider text-gray-400"
          title={rootPath ?? ''}
        >
          {rootName || t('ide.explorer.title')}
        </span>
        <button
          type="button"
          onClick={() => startCreate('', 'file')}
          disabled={!rootPath}
          title={t('ide.explorer.ctx.newFile')}
          aria-label={t('ide.explorer.ctx.newFile')}
          className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200 disabled:cursor-not-allowed disabled:text-gray-700"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
            <path d="M12 11v6M9 14h6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => startCreate('', 'directory')}
          disabled={!rootPath}
          title={t('ide.explorer.ctx.newFolder')}
          aria-label={t('ide.explorer.ctx.newFolder')}
          className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200 disabled:cursor-not-allowed disabled:text-gray-700"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" />
            <path d="M12 11v6M9 14h6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={refresh}
          title={t('ide.explorer.refresh')}
          aria-label={t('ide.explorer.refresh')}
          className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-2.6-6.4" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </button>
        <button
          type="button"
          onClick={collapseAll}
          title={t('ide.explorer.collapseAll')}
          aria-label={t('ide.explorer.collapseAll')}
          className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="m7 4 5 5 5-5" />
            <path d="m7 20 5-5 5 5" />
          </svg>
        </button>
      </div>

      <IDEExplorerEdited
        agentId={agentId}
        rootPath={rootPath}
        selectedPath={selectedPath}
        onOpen={handleOpenEdited}
      />

      {/* 빈 자리 우클릭 = 루트 메뉴. 행에서 시작한 우클릭은 행 핸들러가 멈춰 세운다(stopPropagation).
          `ScrollFade` 는 이벤트 핸들러를 받지 않으므로 감싸는 칸이 그 손짓을 받는다. */}
      <div className="flex min-h-0 flex-1 flex-col" onContextMenu={handleRootContextMenu}>
      <ScrollFade fill className="flex-1">
        {!rootPath ? (
          <p className="px-3 py-4 text-center text-[12px] text-gray-600">{t('ide.explorer.noProject')}</p>
        ) : rootError ? (
          <p className="px-3 py-4 text-center text-[12px] text-gray-600">{t('ide.explorer.error')}</p>
        ) : rows.length === 0 && !draft ? (
          <p className="px-3 py-4 text-center text-[12px] text-gray-600">
            {rootLoading ? t('ide.explorer.loading') : t('ide.explorer.empty')}
          </p>
        ) : (
          <>
            {truncated.has('') && (
              <p className="px-3 py-1 text-[12px] italic text-gray-600">
                {t('ide.explorer.truncated', { count: WORKSPACE_DIR_ENTRY_MAX })}
              </p>
            )}
            <IDEExplorerTree
              rows={rows}
              cache={cache}
              expanded={expanded}
              loading={loading}
              truncated={truncated}
              failed={failed}
              selectedPath={selectedPath}
              copiedPath={copiedPath}
              insertsIntoInput={isCustom}
              draft={draft}
              onToggleDir={toggleDir}
              onSelectFile={handleSelectFile}
              onOpenFile={handleOpenFile}
              onTakePath={handleTakePath}
              onEntryDragStart={handleEntryDragStart}
              onEntryDragEnd={handleEntryDragEnd}
              canDropInto={canDropInto}
              onEntryDrop={handleEntryDrop}
              onContextMenu={handleRowContextMenu}
              onRenameRequest={startRename}
              onDeleteRequest={requestDelete}
              onDraftCommit={handleDraftCommit}
              onDraftCancel={handleDraftCancel}
            />
          </>
        )}
      </ScrollFade>
      </div>

      {/*
        바닥 줄 — 평소에는 고른 파일의 루트 기준 경로(없으면 루트 경로)를 **보여 주기만** 한다.
        ⑦ 쓰기가 무언가 말할 것이 있을 때만(실패 사유·지운 결과) 그 자리를 잠시 빌린다.
        복사 버튼은 여기 있지 않다 — 고른 행 옆으로 옮겼다(§5.5 #17-19 ③(c), 트리 행 손잡이).
      */}
      <div className="flex items-center gap-1 border-t border-gray-800 bg-gray-900/60 px-1.5 py-1">
        <span
          className={`min-w-0 flex-1 truncate text-[12px] ${
            notice
              ? (notice.tone === 'error' ? 'text-rose-400' : 'text-emerald-400')
              : selectedPath ? 'text-gray-300' : 'text-gray-600'
          }`}
          title={notice?.text ?? selectedPath ?? rootPath ?? ''}
        >
          {notice?.text ?? selectedPath ?? rootPath ?? ''}
        </span>
      </div>

      {menu && (
        <IDEContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </div>
  );
});
