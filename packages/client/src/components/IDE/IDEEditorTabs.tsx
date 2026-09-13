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
 *
 * §5.5 #17-17 ㉔ — 이 줄은 이제 **파일만의 것이 아니다.** 우측 판에 뜨는 것은 전부 여기 탭으로 선다 —
 * 맨 앞이 **무대**(단계 지도)이고 그 뒤로 열어 둔 파일들이다. 무대 탭은 파일이 아니므로 라벨 앞에
 * 글리프를 달아 한눈에 갈라 보이게 한다(사이드바 [뷰 보기] 가 쓰는 그 그림 — 같은 것을 여는 손잡이는
 * 같은 그림이어야 한다). 파일이 하나도 없어도 무대 탭 하나로 이 줄은 선다.
 */

/**
 * §5.5 #17-17 ㉔ — 탭 줄 맨 앞의 **무대 탭**. 무대가 닫혀 있으면 `undefined` 라 줄에 서지 않는다.
 * 파일 탭과 달리 경로가 없으므로(열려 있는 "그 세션의 지도" 하나뿐이다) 키도 라벨도 하나다.
 */
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
  /** §5.5 #17-27 ⑨ v4.97 — 탭 우클릭(누른 그 탭이 대상 — 활성 탭이 아닐 수도 있다). */
  onTabContextMenu?: (e: React.MouseEvent, relPath: string) => void;
  /** §5.5 #17-27 ⑯ — [고정]이 켜져 있는가(켜져 있으면 세션을 옮겨도 이 탭들이 그대로 있다). */
  pinned: boolean;
  onTogglePinned: () => void;
  /** §5.5 #17-17 ㉔ — 무대 탭(닫혀 있으면 없다). */
  stageTab?: StageTabProps;
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
              className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-100"
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
