import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WORKSPACE_DIR_ENTRY_MAX, workspaceEntryNameError } from '@vibisual/shared';
import type { WorkspaceEntry } from '@vibisual/shared';
import type { ExplorerRow, ExplorerDirCache, ExplorerDraft } from './explorerModel.js';
import { workspaceNameErrorKey } from './explorerModel.js';

/**
 * §5.5 #17-19 v4.71 — 탐색기 트리 본체(행 목록).
 *
 * 계층 자체가 경로이므로 들여쓰기 폭이 정보다 — 깊이에 비례한 padding 은 Tailwind 클래스로
 * 표현할 수 없어 인라인 style 을 쓴다(기존 `FolderFileTree` 와 같은 예외).
 *
 * ⑦ — 행은 우클릭 메뉴(만들기·이름 바꾸기·삭제…)의 대상이고, 이름을 치는 자리도 **이 트리 안**이다
 * (별도 창 ❌ — 만들어질 곳이 보이는 채로 정해야 한다).
 */

interface IDEExplorerTreeProps {
  rows: ExplorerRow[];
  cache: ExplorerDirCache;
  expanded: ReadonlySet<string>;
  loading: ReadonlySet<string>;
  truncated: ReadonlySet<string>;
  failed: ReadonlySet<string>;
  selectedPath: string | null;
  /** §5.5 #17-19 ③(c) — 방금 복사한 행의 상대 경로(체크 표시가 그 행에만 뜨도록). */
  copiedPath: string | null;
  /** §5.5 #17-19 ⑦ — 지금 이름을 치고 있는 자리(없으면 평소 트리 그대로). */
  draft: ExplorerDraft | null;
  onToggleDir: (relPath: string) => void;
  /** §5.13 (R-7) — 실행 여부까지 넘긴다(목록이 서버에게 받아 둔 값). 여는 곳은 호출부가 정한다. */
  onSelectFile: (relPath: string, executable?: boolean) => void;
  onOpenFile: (relPath: string) => void;
  onCopyPath: (relPath: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: WorkspaceEntry) => void;
  onRenameRequest: (entry: WorkspaceEntry) => void;
  onDeleteRequest: (entry: WorkspaceEntry) => void;
  /** 입력칸에서 Enter — 이름 한 조각을 올려 보낸다(검사·요청은 호출부). */
  onDraftCommit: (name: string) => void;
  onDraftCancel: () => void;
}

/** 깊이 → 들여쓰기 px. 사이드바가 좁아(w-52) VS Code 보다 한 단계를 짧게 잡는다. */
const INDENT_PX = 10;
const BASE_PAD_PX = 6;

/**
 * §5.5 #17-19 ⑦ — 트리 안에서 이름을 치는 한 줄.
 *
 * - **Enter** 로 확정, **Esc** 로 취소, **바깥을 누르면 확정**(VS Code 와 같은 손버릇 — 이름을 다
 *   쳐 놓고 딴 데를 눌렀다고 그 타이핑이 사라지면 안 된다). 비었거나 규칙에 어긋나면 취소로 떨어진다.
 * - 규칙 위반은 **치는 동안** 붉은 테두리와 한 줄로 말한다(확정하고 나서 거절당하는 대신).
 *   판정은 서버와 **같은 순수 함수**(`workspaceEntryNameError`, shared)다.
 * - 파일 이름은 확장자 앞까지만 골라 둔다(`App.tsx` → `App`) — 이름만 바꾸는 것이 대부분이다.
 */
function ExplorerNameInput({
  initial,
  isDirectory,
  paddingLeft,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  isDirectory: boolean;
  paddingLeft: number;
  placeholder: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  /** 확정/취소는 한 번만 — blur 확정과 Enter 확정이 겹쳐 두 번 만들지 않게. */
  const doneRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf('.');
    // 숨김 파일(`.env`)의 첫 점은 확장자가 아니다 — 그때는 전체를 고른다.
    if (!isDirectory && dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [initial, isDirectory]);

  const nameError = value.length > 0 ? workspaceEntryNameError(value) : null;

  const commit = useCallback((): void => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (value.length === 0 || workspaceEntryNameError(value) !== null) onCancel();
    else onCommit(value);
  }, [value, onCommit, onCancel]);

  const cancel = useCallback((): void => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  }, [onCancel]);

  return (
    <div className="py-[2px] pr-1" style={{ paddingLeft }}>
      <input
        ref={ref}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        }}
        onBlur={commit}
        // 우클릭은 전역 입력칸 메뉴(`GlobalTextFieldContextMenu`)가 capture 단계에서 가로채
        // 트리 메뉴 대신 잘라내기·복사·붙여넣기를 띄운다. 여기서 따로 막을 것이 없다 —
        // 예전의 `stopPropagation` 은 "브라우저 기본 메뉴가 뜨게 둔다"는 뜻이었는데,
        // **Electron 에는 그 기본 메뉴가 없어** 실제로는 아무 것도 안 뜨는 자리였다.
        className={`w-full rounded border bg-gray-950 px-1 py-[1px] text-[12px] text-gray-100 outline-none ${
          nameError ? 'border-rose-500' : 'border-blue-500'
        }`}
      />
      {nameError && (
        <p className="truncate pt-0.5 text-[12px] text-rose-400">{t(workspaceNameErrorKey(nameError))}</p>
      )}
    </div>
  );
}

export const IDEExplorerTree = memo(function IDEExplorerTree({
  rows,
  cache,
  expanded,
  loading,
  truncated,
  failed,
  selectedPath,
  copiedPath,
  draft,
  onToggleDir,
  onSelectFile,
  onOpenFile,
  onCopyPath,
  onContextMenu,
  onRenameRequest,
  onDeleteRequest,
  onDraftCommit,
  onDraftCancel,
}: IDEExplorerTreeProps): React.JSX.Element {
  const { t } = useTranslation();

  /** ⑦ — 행 위에서의 F2(이름 바꾸기) · Delete(삭제, mac 은 ⌘⌫). 메뉴에 적어 둔 그대로 눌린다. */
  const handleRowKeyDown = useCallback((e: React.KeyboardEvent, entry: WorkspaceEntry): void => {
    if (e.key === 'F2') {
      e.preventDefault();
      onRenameRequest(entry);
      return;
    }
    // mac 키보드의 지우기(⌫)는 `Backspace` 로 온다 — 파인더와 같이 **⌘를 함께 눌렀을 때만** 받는다.
    if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      onDeleteRequest(entry);
    }
  }, [onRenameRequest, onDeleteRequest]);

  const draftPlaceholder = draft?.mode === 'create'
    ? (draft.kind === 'directory' ? t('ide.explorer.ctx.newFolderName') : t('ide.explorer.ctx.newFileName'))
    : t('ide.explorer.ctx.newName');

  /** `parent` 폴더의 첫 자식 자리에 끼우는 입력 줄(깊이는 그 폴더 + 1). */
  const createRowFor = (parent: string, depth: number): React.JSX.Element | null => {
    if (!draft || draft.mode !== 'create' || draft.parent !== parent) return null;
    return (
      <li key={`__draft-${parent}`}>
        <ExplorerNameInput
          initial=""
          isDirectory={draft.kind === 'directory'}
          paddingLeft={depth * INDENT_PX + BASE_PAD_PX + 16}
          placeholder={draftPlaceholder}
          onCommit={onDraftCommit}
          onCancel={onDraftCancel}
        />
      </li>
    );
  };

  return (
    <ul className="flex flex-col">
      {/* 루트에 만드는 중이면 목록 맨 위가 그 자리다. */}
      {createRowFor('', 0)}

      {rows.map(({ entry, depth }) => {
        const pad = depth * INDENT_PX + BASE_PAD_PX;
        const isSelected = selectedPath === entry.relPath;

        // 이름을 고치는 중인 행은 그 자리에서 입력칸이 된다(행을 지우고 새로 그리지 않는다 —
        // 위아래 행이 밀리면 어디를 고치는 중인지 놓친다).
        if (draft?.mode === 'rename' && draft.relPath === entry.relPath) {
          return (
            <li key={entry.relPath}>
              <ExplorerNameInput
                initial={draft.initial}
                isDirectory={draft.isDirectory}
                paddingLeft={pad + (entry.isDirectory ? 0 : 16)}
                placeholder={draftPlaceholder}
                onCommit={onDraftCommit}
                onCancel={onDraftCancel}
              />
            </li>
          );
        }

        if (entry.isDirectory) {
          const isOpen = expanded.has(entry.relPath);
          const isLoading = isOpen && loading.has(entry.relPath);
          const isFailed = isOpen && !isLoading && failed.has(entry.relPath);
          const isEmpty = isOpen && !isLoading && (cache[entry.relPath]?.length ?? -1) === 0;
          const isTruncated = isOpen && truncated.has(entry.relPath);
          // 만드는 중인 폴더는 "비었다" 문구를 내지 않는다 — 그 자리에 입력칸이 이미 서 있다.
          const isDraftParent = draft?.mode === 'create' && draft.parent === entry.relPath;
          return (
            <li key={entry.relPath}>
              <button
                type="button"
                onClick={() => onToggleDir(entry.relPath)}
                onContextMenu={(e) => onContextMenu(e, entry)}
                onKeyDown={(e) => handleRowKeyDown(e, entry)}
                title={entry.relPath}
                className={`flex w-full items-center gap-1 py-[3px] pr-1 text-left text-[12px] transition-colors ${
                  isSelected
                    ? 'bg-blue-500/20 text-blue-100'
                    : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
                }`}
                style={{ paddingLeft: pad }}
              >
                <svg
                  className={`h-3 w-3 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <svg
                  className="h-3.5 w-3.5 flex-shrink-0 text-amber-400/80"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z" />
                </svg>
                <span className="truncate">{entry.name}</span>
              </button>
              {createRowFor(entry.relPath, depth + 1)}
              {(isLoading || isFailed || (isEmpty && !isDraftParent) || isTruncated) && (
                <p
                  className="truncate py-[3px] text-[12px] italic text-gray-600"
                  style={{ paddingLeft: pad + INDENT_PX + 16 }}
                >
                  {isLoading
                    ? t('ide.explorer.loading')
                    : isFailed
                      ? t('ide.explorer.error')
                      : isEmpty
                        ? t('ide.explorer.empty')
                        : t('ide.explorer.truncated', { count: WORKSPACE_DIR_ENTRY_MAX })}
                </p>
              )}
            </li>
          );
        }

        const isCopied = copiedPath === entry.relPath;

        return (
          <li key={entry.relPath} className="group/row relative">
            <button
              type="button"
              onClick={() => onSelectFile(entry.relPath, entry.executable === true)}
              onDoubleClick={() => onOpenFile(entry.relPath)}
              onContextMenu={(e) => onContextMenu(e, entry)}
              onKeyDown={(e) => handleRowKeyDown(e, entry)}
              title={entry.relPath}
              className={`flex w-full items-center gap-1 py-[3px] pr-9 text-left text-[12px] transition-colors ${
                isSelected
                  ? 'bg-blue-500/20 text-blue-100'
                  : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
              }`}
              style={{ paddingLeft: pad + 16 }}
            >
              <svg
                className="h-3.5 w-3.5 flex-shrink-0 text-violet-400/80"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6" />
              </svg>
              <span className="truncate">{entry.name}</span>
            </button>
            {/*
              §5.5 #17-19 ③(c) — 행 손잡이 묶음. **고른 행에서는 늘 보이고**(지금 만질 행이라 손잡이가
              사라지면 안 된다), 고르지 않은 행에서는 마우스를 올렸을 때만 뜬다.
              왼쪽이 경로 복사, 오른쪽이 앱 밖 편집기로 열기.
            */}
            <div
              className={`absolute right-0.5 top-1/2 -translate-y-1/2 items-center gap-0.5 ${
                isSelected ? 'flex' : 'hidden group-hover/row:flex'
              }`}
            >
              <button
                type="button"
                onClick={() => onCopyPath(entry.relPath)}
                onContextMenu={(e) => onContextMenu(e, entry)}
                title={isCopied ? t('ide.explorer.copied') : t('ide.explorer.copyPath')}
                aria-label={t('ide.explorer.copyPath')}
                className={`rounded p-0.5 transition-colors hover:bg-gray-700 ${
                  isCopied ? 'text-emerald-400' : 'text-gray-500 hover:text-blue-300'
                }`}
              >
                {isCopied ? (
                  <svg
                    className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg
                    className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                onClick={() => onOpenFile(entry.relPath)}
                onContextMenu={(e) => onContextMenu(e, entry)}
                title={t('ide.explorer.openFile')}
                aria-label={t('ide.explorer.openFile')}
                className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-700 hover:text-blue-300"
              >
                <svg
                  className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
});
