import { memo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileEdit } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';

interface FileEditListProps {
  edits: FileEdit[];
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const time = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${m}/${d} ${time}`;
}

/** 한 줄 미리보기: old → new (truncated) */
function editPreview(edit: FileEdit): string {
  const oldLine = edit.oldString.split('\n')[0] ?? '';
  const newLine = edit.newString.split('\n')[0] ?? '';
  if (oldLine === newLine) return oldLine;
  return `${oldLine.slice(0, 30)} → ${newLine.slice(0, 30)}`;
}

function lineCount(text: string): number {
  return text.split('\n').length;
}

/** 서버 API로 에디터 열기 — 편집 위치로 이동 */
function openInEditor(filePath: string | undefined, searchText?: string): void {
  if (!filePath) return;
  fetch(`/api/open-in-editor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, searchText }),
  }).catch(() => {});
}

// ─── 연필 아이콘 ───

function PencilIcon(): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

// ─── 상세 팝업 ───

interface EditDetailPopupProps {
  edit: FileEdit;
  onClose: () => void;
}

function EditDetailPopup({ edit, onClose }: EditDetailPopupProps): React.JSX.Element {
  const { t } = useTranslation();
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    openInEditor(edit.filePath, edit.newString);
  }, [edit.filePath, edit.newString]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6" />
            </svg>
            <span className="text-sm font-semibold text-gray-100">
              {t('panel.fileEdit.edit')}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleOpen}
              className="flex h-6 w-6 items-center justify-center rounded text-violet-400 hover:bg-violet-500/20 hover:text-violet-300"
              aria-label={t('panel.fileEdit.openInEditor')}
              title={t('panel.fileEdit.openInVSCode')}
            >
              <PencilIcon />
            </button>
            <span className="text-xs text-gray-500">
              {formatTime(edit.timestamp)}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              aria-label={t('panel.fileEdit.closePopup')}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body — old / new diff */}
        <ScrollFade fill className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-4">
            {/* Removed */}
            <div className="flex shrink-0 flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-red-400">
                {t('panel.fileEdit.removed', { count: lineCount(edit.oldString) })}
              </span>
              <pre className="whitespace-pre-wrap break-all rounded border border-red-900/30 bg-red-950/20 p-3 font-mono text-xs leading-relaxed text-red-300">
                {edit.oldString}
              </pre>
            </div>

            {/* Added */}
            <div className="flex min-h-0 flex-col gap-1">
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                {t('panel.fileEdit.added', { count: lineCount(edit.newString) })}
              </span>
              <pre className="scrollbar-terminal whitespace-pre-wrap break-all rounded border border-emerald-900/30 bg-emerald-950/20 p-3 font-mono text-xs leading-relaxed text-emerald-300">
                {edit.newString}
              </pre>
            </div>
          </div>
        </ScrollFade>
      </div>
    </div>
  );
}

// ─── 리스트 ───

export const FileEditList = memo(function FileEditList({
  edits,
}: FileEditListProps): React.JSX.Element | null {
  const [selectedEdit, setSelectedEdit] = useState<FileEdit | null>(null);
  const handleClose = useCallback(() => setSelectedEdit(null), []);

  if (edits.length === 0) return null;

  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-500">
          Edits ({edits.length})
        </span>
        <ScrollFade maxHeight={256}>
          <ul className="flex flex-col gap-1.5">
            {edits.map((edit) => (
              <li
                key={edit.id}
                className="group/item cursor-pointer rounded border border-gray-700/50 bg-gray-800/60 px-2.5 py-1.5 transition-colors hover:border-gray-600 hover:bg-gray-700/60"
                onClick={() => setSelectedEdit(edit)}
              >
                {/* Top row: diff badges + preview + pencil */}
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 rounded bg-red-500/20 px-1 py-0.5 font-mono text-[10px] text-red-400">
                    -{lineCount(edit.oldString)}
                  </span>
                  <span className="shrink-0 rounded bg-emerald-500/20 px-1 py-0.5 font-mono text-[10px] text-emerald-400">
                    +{lineCount(edit.newString)}
                  </span>
                  <code className="min-w-0 flex-1 truncate text-[11px] text-gray-400">
                    {editPreview(edit)}
                  </code>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 text-gray-500 opacity-0 transition-all hover:bg-violet-500/20 hover:text-violet-400 group-hover/item:opacity-100"
                    aria-label="Open in editor"
                    title="Open in VS Code"
                    onClick={(e) => {
                      e.stopPropagation();
                      openInEditor(edit.filePath, edit.newString);
                    }}
                  >
                    <PencilIcon />
                  </button>
                </div>
                <span className="mt-0.5 block text-[10px] text-gray-500">
                  {formatTime(edit.timestamp)}
                </span>
              </li>
            ))}
          </ul>
        </ScrollFade>
      </div>

      {selectedEdit && (
        <EditDetailPopup edit={selectedEdit} onClose={handleClose} />
      )}
    </>
  );
});
