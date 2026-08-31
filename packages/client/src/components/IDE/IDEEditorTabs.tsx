import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { IDEEditorFile } from '../../stores/graphStore.js';

/**
 * IDEEditorTabs.tsx — §5.5 #17-27 v4.87 편집창 탭 줄(열어 둔 파일들).
 *
 * 탭 하나 = 파일 하나. 저장할 것이 남아 있으면 닫기 자리에 **점**이 뜨고(마우스를 올리면 X 로 바뀐다),
 * 같은 이름의 파일이 여럿이면 라벨에 상위 폴더 한 겹이 붙는다(`tabLabels`).
 *
 * §5.5 #17-27 ⑯ — 이 줄은 **그 세션의 것**이다. 세션 탭을 옮기면 탭 줄도 함께 바뀌고, 오른쪽 끝의
 * [고정] 을 켜 두면 그때만 지금 탭이 세션을 따라다닌다(참고 파일을 띄워 두고 여러 세션을 볼 때).
 */

interface IDEEditorTabsProps {
  files: readonly IDEEditorFile[];
  /** relPath → 탭에 적을 라벨 */
  labels: Record<string, string>;
  activePath: string;
  onSelect: (relPath: string) => void;
  onClose: (relPath: string) => void;
  onCloseAll: () => void;
  /** §5.5 #17-27 ⑨ v4.97 — 탭 우클릭(누른 그 탭이 대상 — 활성 탭이 아닐 수도 있다). */
  onTabContextMenu?: (e: React.MouseEvent, relPath: string) => void;
  /** §5.5 #17-27 ⑯ — [고정]이 켜져 있는가(켜져 있으면 세션을 옮겨도 이 탭들이 그대로 있다). */
  pinned: boolean;
  onTogglePinned: () => void;
}

export const IDEEditorTabs = memo(function IDEEditorTabs({
  files,
  labels,
  activePath,
  onSelect,
  onClose,
  onCloseAll,
  onTabContextMenu,
  pinned,
  onTogglePinned,
}: IDEEditorTabsProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="flex items-stretch border-b border-gray-800 bg-gray-900/80">
      <div className="scrollbar-thin flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {files.map((file) => {
          const isActive = file.relPath === activePath;
          return (
            <div
              key={file.relPath}
              onContextMenu={onTabContextMenu ? (e) => onTabContextMenu(e, file.relPath) : undefined}
              className={`group/tab flex flex-shrink-0 items-center gap-1 border-r border-gray-800 pl-2 pr-1 ${
                isActive ? 'bg-gray-950 text-gray-100' : 'text-gray-500 hover:bg-gray-800/60 hover:text-gray-300'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(file.relPath)}
                title={file.relPath}
                className="max-w-[160px] truncate py-1 text-left text-[12px]"
              >
                {labels[file.relPath] ?? file.name}
              </button>
              <button
                type="button"
                onClick={() => onClose(file.relPath)}
                title={t('ide.editor.closeTab')}
                aria-label={t('ide.editor.closeTab')}
                className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-100"
              >
                {file.dirty ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 group-hover/tab:hidden" />
                ) : null}
                <svg
                  className={`h-3 w-3 ${file.dirty ? 'hidden group-hover/tab:block' : ''}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
      {/* §5.5 #17-27 ⑯ — [고정]. 켜져 있으면 세션을 옮겨도 이 탭 줄이 따라간다. 켜짐은 색으로
          말한다(파랑) — 눌린 버튼이 회색으로만 어두워지면 켜졌는지 꺼졌는지 알 수 없다. */}
      <button
        type="button"
        onClick={onTogglePinned}
        aria-pressed={pinned}
        title={t(pinned ? 'ide.editor.unpinTabs' : 'ide.editor.pinTabs')}
        aria-label={t(pinned ? 'ide.editor.unpinTabs' : 'ide.editor.pinTabs')}
        className={`flex flex-shrink-0 items-center border-l border-gray-800 px-1.5 transition-colors ${
          pinned ? 'bg-blue-500/15 text-blue-300 hover:bg-blue-500/25' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-200'
        }`}
      >
        <svg
          className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden
        >
          <path d="M12 17v5" />
          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          {/* 꺼져 있을 때만 빗금 — 아이콘 하나로 "지금 안 걸려 있다"까지 말한다(lucide `pin-off`). */}
          {!pinned && <path d="m2 2 20 20" />}
        </svg>
      </button>
      <button
        type="button"
        onClick={onCloseAll}
        title={t('ide.editor.closePane')}
        aria-label={t('ide.editor.closePane')}
        className="flex flex-shrink-0 items-center px-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
});
