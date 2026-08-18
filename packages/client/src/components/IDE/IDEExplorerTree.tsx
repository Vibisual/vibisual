import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { WORKSPACE_DIR_ENTRY_MAX } from '@vibisual/shared';
import type { ExplorerRow, ExplorerDirCache } from './explorerModel.js';

/**
 * §5.5 #17-19 v4.71 — 탐색기 트리 본체(행 목록).
 *
 * 계층 자체가 경로이므로 들여쓰기 폭이 정보다 — 깊이에 비례한 padding 은 Tailwind 클래스로
 * 표현할 수 없어 인라인 style 을 쓴다(기존 `FolderFileTree` 와 같은 예외).
 */

interface IDEExplorerTreeProps {
  rows: ExplorerRow[];
  cache: ExplorerDirCache;
  expanded: ReadonlySet<string>;
  loading: ReadonlySet<string>;
  truncated: ReadonlySet<string>;
  failed: ReadonlySet<string>;
  selectedPath: string | null;
  onToggleDir: (relPath: string) => void;
  onSelectFile: (relPath: string) => void;
  onOpenFile: (relPath: string) => void;
}

/** 깊이 → 들여쓰기 px. 사이드바가 좁아(w-52) VS Code 보다 한 단계를 짧게 잡는다. */
const INDENT_PX = 10;
const BASE_PAD_PX = 6;

export const IDEExplorerTree = memo(function IDEExplorerTree({
  rows,
  cache,
  expanded,
  loading,
  truncated,
  failed,
  selectedPath,
  onToggleDir,
  onSelectFile,
  onOpenFile,
}: IDEExplorerTreeProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <ul className="flex flex-col">
      {rows.map(({ entry, depth }) => {
        const pad = depth * INDENT_PX + BASE_PAD_PX;
        const isSelected = selectedPath === entry.relPath;

        if (entry.isDirectory) {
          const isOpen = expanded.has(entry.relPath);
          const isLoading = isOpen && loading.has(entry.relPath);
          const isFailed = isOpen && !isLoading && failed.has(entry.relPath);
          const isEmpty = isOpen && !isLoading && (cache[entry.relPath]?.length ?? -1) === 0;
          const isTruncated = isOpen && truncated.has(entry.relPath);
          return (
            <li key={entry.relPath}>
              <button
                type="button"
                onClick={() => onToggleDir(entry.relPath)}
                title={entry.relPath}
                className="flex w-full items-center gap-1 py-[3px] pr-1 text-left text-[11px] text-gray-400 transition-colors hover:bg-gray-700/50 hover:text-gray-200"
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
              {(isLoading || isFailed || isEmpty || isTruncated) && (
                <p
                  className="truncate py-[3px] text-[10px] italic text-gray-600"
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

        return (
          <li key={entry.relPath} className="group/row relative">
            <button
              type="button"
              onClick={() => onSelectFile(entry.relPath)}
              onDoubleClick={() => onOpenFile(entry.relPath)}
              title={entry.relPath}
              className={`flex w-full items-center gap-1 py-[3px] pr-6 text-left text-[11px] transition-colors ${
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
            <button
              type="button"
              onClick={() => onOpenFile(entry.relPath)}
              title={t('ide.explorer.openFile')}
              aria-label={t('ide.explorer.openFile')}
              className="absolute right-0.5 top-1/2 hidden -translate-y-1/2 rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-700 hover:text-blue-300 group-hover/row:block"
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
          </li>
        );
      })}
    </ul>
  );
});
