import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { IDEEditorFile } from '../../stores/graphStore.js';
import { PANE_KIND_TEXT, PaneKindGlyph } from './paneKinds.js';

/**
 * IDEEditorTabs.tsx — §5.5 #17-27 우측 판 탭 줄. 미저장은 닫기 자리에 점, 같은 이름은 상위 폴더 한 겹(`tabLabels`).
 * ⑯ 탭 줄은 세션의 것([고정] 이면 지금 탭이 세션을 따라다닌다). ㉔ 맨 앞은 무대 탭 — [뷰 보기] 와 같은 글리프, 파일이 없어도 선다.
 */

/** §5.5 #17-17 ㉔ — 맨 앞의 무대 탭(닫혀 있으면 `undefined`). 경로가 없어 키도 라벨도 하나다. */
export interface StageTabProps {
  /** 지금 판이 무대를 비추고 있나(= 활성 파일이 없다). */
  active: boolean;
  /** 탭 라벨 — `ide.stage.title`("무대"). 문구를 여기서 짓지 않는다. */
  label: string;
  onSelect: () => void;
  onClose: () => void;
}

interface IDEEditorTabsProps {
  files: readonly IDEEditorFile[];
  /** relPath → 탭에 적을 라벨 */
  labels: Record<string, string>;
  activePath: string;
  onSelect: (relPath: string) => void;
  onClose: (relPath: string) => void;
  onCloseAll: () => void;
  /** §5.5 #17-27 ⑨ — 탭 우클릭(대상은 누른 탭 — 활성 탭이 아닐 수 있다). */
  onTabContextMenu?: (e: React.MouseEvent, relPath: string) => void;
  /** §5.5 #17-27 ⑯ — [고정]이 켜져 있는가(켜져 있으면 세션을 옮겨도 이 탭들이 그대로 있다). */
  pinned: boolean;
  onTogglePinned: () => void;
  /** §5.5 #17-17 ㉔ — 무대 탭(닫혀 있으면 없다). */
  stageTab?: StageTabProps;
  /** §5.5 #17-27 ⑰ — [최대화]. 누르면 이 줄이 걷히므로 되돌리기는 판 구석에 따로 선다(`IDEEditorPane`). */
  onMaximize: () => void;
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
  stageTab,
  onMaximize,
}: IDEEditorTabsProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="flex items-stretch border-b border-gray-800 bg-gray-900/80">
      <div className="scrollbar-thin flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {/* ㉔ — 무대 탭. 파일 탭과 **같은 뼈대**(고른 탭이 밝고, 오른쪽에 닫기)라 손버릇이 하나다.
            다른 것은 앞의 글리프 하나뿐 — 이 탭만 파일이 아니라는 것을 그림이 말한다. */}
        {stageTab && (
          <div
            className={`group/tab flex flex-shrink-0 items-center gap-1 border-r border-gray-800 pl-2 pr-1 ${
              stageTab.active ? 'bg-gray-950 text-emerald-200' : 'text-gray-500 hover:bg-gray-800/60 hover:text-gray-300'
            }`}
          >
            <button
              type="button"
              onClick={stageTab.onSelect}
              title={stageTab.label}
              aria-current={stageTab.active ? 'true' : undefined}
              className="flex max-w-[160px] items-center gap-1 truncate py-1 text-left text-[12px]"
            >
              {/* 이어진 노드 — 사이드바 [뷰 보기] 와 같은 그림(같은 것을 여는 손잡이는 같은 그림). */}
              <svg
                className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden
              >
                <circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="12" r="2.5" /><circle cx="6" cy="18" r="2.5" />
                <path d="M8.2 7.3 15.8 11M15.8 13 8.2 16.7" />
              </svg>
              <span className="truncate">{stageTab.label}</span>
            </button>
            <button
              type="button"
              onClick={stageTab.onClose}
              title={t('ide.editor.closeTab')}
              aria-label={t('ide.editor.closeTab')}
              className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-100 pointer-coarse:h-8 pointer-coarse:w-8"
            >
              <svg
                className="h-3 w-3"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {files.map((file) => {
          const isActive = file.relPath === activePath;
          // §5.5 #17-27 ⑱ — 빈 탭. 파일이 아니므로 무대 탭(㉔)처럼 라벨 앞 글리프가 무엇을 여는 탭인지
          //   말하고, 이름은 갈래에서 짓는다(경로가 없다). 뼈대·닫기·우클릭은 파일 탭과 같다.
          const opener = file.opener;
          return (
            <div
              key={file.relPath}
              onContextMenu={onTabContextMenu ? (e) => onTabContextMenu(e, file.relPath) : undefined}
              className={`group/tab flex flex-shrink-0 items-center gap-1 border-r border-gray-800 pl-2 pr-1 ${
                isActive
                  ? `bg-gray-950 ${opener ? 'text-sky-200' : 'text-gray-100'}`
                  : 'text-gray-500 hover:bg-gray-800/60 hover:text-gray-300'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(file.relPath)}
                title={opener ? t('ide.paneOpener.tabHint') : file.relPath}
                aria-current={isActive ? 'true' : undefined}
                className={`max-w-[160px] truncate py-1 text-left text-[12px] ${opener ? 'flex items-center gap-1' : ''}`}
              >
                {opener ? (
                  <>
                    <PaneKindGlyph kind={opener} />
                    <span className="truncate">{t(PANE_KIND_TEXT[opener].label)}</span>
                  </>
                ) : (labels[file.relPath] ?? file.name)}
              </button>
              {/* 안 저장한 탭은 점이 X 자리에 앉고, 마우스를 올리면 X 로 바뀐다. 터치에는 hover 가 없어
                  점만 보이고 그 점을 누르면 탭이 닫혔다 — 터치에서는 점과 X 를 **나란히** 세운다(안 저장했다는
                  표시도, 닫는 손잡이라는 표시도 지우지 않는다). */}
              <button
                type="button"
                onClick={() => onClose(file.relPath)}
                title={t('ide.editor.closeTab')}
                aria-label={t('ide.editor.closeTab')}
                className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-100 pointer-coarse:h-8 ${
                  file.dirty ? 'pointer-coarse:w-auto pointer-coarse:gap-1 pointer-coarse:px-2' : 'pointer-coarse:w-8'
                }`}
              >
                {file.dirty ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 group-hover/tab:hidden" />
                ) : null}
                <svg
                  className={`h-3 w-3 ${file.dirty ? 'hidden group-hover/tab:block pointer-coarse:block' : ''}`}
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
        className={`flex flex-shrink-0 items-center border-l border-gray-800 px-1.5 transition-colors pointer-coarse:px-2.5 ${
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
      {/* §5.5 #17-27 ⑰ — [최대화]. 네 모서리가 바깥으로 벌어진 그림(lucide `maximize`) — 그림 배율
          손잡이(⑭ 의 대각 화살표)와 갈라 보이게, 창을 키우는 흔한 그림을 쓴다. */}
      <button
        type="button"
        onClick={onMaximize}
        title={t('ide.editor.maximizePane')}
        aria-label={t('ide.editor.maximizePane')}
        className="flex flex-shrink-0 items-center border-l border-gray-800 px-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200 pointer-coarse:px-2.5"
      >
        <svg
          className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden
        >
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
          <path d="M3 16v3a2 2 0 0 0 2 2h3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onCloseAll}
        title={t('ide.editor.closePane')}
        aria-label={t('ide.editor.closePane')}
        className="flex flex-shrink-0 items-center px-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200 pointer-coarse:px-2.5"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
});
