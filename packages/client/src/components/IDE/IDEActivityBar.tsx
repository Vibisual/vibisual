import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';
import type { IDEViewType } from '../../stores/graphStore.js';
import { useRunningSubagentTasks } from './IDERunningSubagentsView.js';

interface ActivityItem {
  view: IDEViewType;
  labelKey: string;
  icon: string;
}

const ACTIVITIES: ActivityItem[] = [
  { view: 'terminal', labelKey: 'ide.activityBar.terminal', icon: 'M4 17l6-5-6-5m8 10h8' },
  { view: 'files', labelKey: 'ide.activityBar.files', icon: 'M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z' },
  { view: 'events', labelKey: 'ide.activityBar.results', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
  // §5.5 #17-4 v2.32 — Skills: lucide sparkles 톤 (별 + 작은 별 2개) stroke SVG.
  { view: 'skills', labelKey: 'ide.activityBar.skills', icon: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z' },
];

export const IDEActivityBar = memo(function IDEActivityBar(): React.JSX.Element {
  const { t } = useTranslation();
  const activeView = useGraphStore((s) => selectIDEOverlay(s).activeView);
  const setActiveView = useGraphStore((s) => s.setIDEActiveView);
  const toggleSidebar = useGraphStore((s) => s.toggleIDESidebar);
  const sidebarCollapsed = useGraphStore((s) => selectIDEOverlay(s).sidebarCollapsed);

  const bookmarkCount = useGraphStore((s) => s.ideBookmarks.length);
  const bookmarkPanelOpen = useGraphStore((s) => s.bookmarkPanelOpen);
  const toggleBookmarkPanel = useGraphStore((s) => s.toggleBookmarkPanel);
  const setBookmarkPanelOpen = useGraphStore((s) => s.setBookmarkPanelOpen);

  // §5.5 #17-8 v2.95 — 세션 요약 보드 토글 + "미확인 완료" 세션 수 배지.
  const agentId = useGraphStore((s) => selectIDEOverlay(s).agentId);
  const summaryPanelOpen = useGraphStore((s) => s.summaryPanelOpen);
  const toggleSummaryPanel = useGraphStore((s) => s.toggleSummaryPanel);
  const setSummaryPanelOpen = useGraphStore((s) => s.setSummaryPanelOpen);
  const unreviewedCount = useGraphStore((s) => {
    const subs = agentId ? s.subAgents[agentId] : undefined;
    if (!subs) return 0;
    return subs.filter((su) => su.status === 'idle' && !s.acknowledgedSubAgents[su.id]).length;
  });

  // §5.5 #17-9 v3.51 — 백그라운드 서브에이전트: 도는 게 하나라도 있을 때만 항목이 나타난다.
  //   배지 = 현재 탭 기준 개수(세션 탭 선택 시 그 탭 것, 메인 탭이면 전부) — 패널과 같은 산식.
  const runningTasks = useRunningSubagentTasks(agentId);
  const runningTotal = useGraphStore((s) => (agentId ? s.runningSubagentTasks[agentId]?.length ?? 0 : 0));
  const subagentPanelOpen = useGraphStore((s) => s.subagentPanelOpen);
  const toggleSubagentPanel = useGraphStore((s) => s.toggleSubagentPanel);
  const setSubagentPanelOpen = useGraphStore((s) => s.setSubagentPanelOpen);

  const handleClick = useCallback((view: IDEViewType) => {
    // 사이드바 뷰를 열면 덮개 패널(북마크·세션 요약·실행 중 서브에이전트)은 닫는다 — 동시에 겹치지 않게.
    if (bookmarkPanelOpen) setBookmarkPanelOpen(false);
    if (summaryPanelOpen) setSummaryPanelOpen(false);
    if (subagentPanelOpen) setSubagentPanelOpen(false);
    if (activeView === view && !sidebarCollapsed) {
      toggleSidebar();
    } else {
      setActiveView(view);
      if (sidebarCollapsed) toggleSidebar();
    }
  }, [activeView, sidebarCollapsed, setActiveView, toggleSidebar, bookmarkPanelOpen, setBookmarkPanelOpen, summaryPanelOpen, setSummaryPanelOpen, subagentPanelOpen, setSubagentPanelOpen]);

  return (
    // §4 v3.24 — 폰(max-md)에선 타이틀바 토글로 열리는 오버레이(본문을 상시 짓누르지 않게).
    //   사이드바(v3.18 max-md 오버레이, left-12)와 나란히 뜨도록 좌측 고정 + 불투명 배경.
    <div className="flex w-12 flex-shrink-0 flex-col items-center gap-1 border-r border-gray-700 bg-gray-900/80 py-2 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:bg-gray-900">
      {ACTIVITIES.map((item) => {
        const isActive = activeView === item.view && !sidebarCollapsed;
        return (
          <button
            key={item.view}
            type="button"
            onClick={() => handleClick(item.view)}
            className={`flex h-10 w-10 items-center justify-center rounded transition-colors ${
              isActive
                ? 'border-l-2 border-blue-400 bg-gray-800 text-white'
                : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
            }`}
            title={t(item.labelKey)}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d={item.icon} />
            </svg>
          </button>
        );
      })}

      {/* 북마크 — 다른 항목과 같은 줄, 다음 순서. 클릭 시 세션창 전체를 덮는 북마크 패널 토글. */}
      <button
        type="button"
        onClick={toggleBookmarkPanel}
        className={`relative flex h-10 w-10 items-center justify-center rounded transition-colors ${
          bookmarkPanelOpen
            ? 'border-l-2 border-blue-400 bg-gray-800 text-white'
            : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
        }`}
        title={t('ide.activityBar.bookmarks')}
        aria-label={t('ide.activityBar.bookmarks')}
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
        {bookmarkCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-bold text-white">
            {bookmarkCount > 99 ? '99+' : bookmarkCount}
          </span>
        )}
      </button>

      {/* 세션 요약 — 쌓인 세션을 한눈에 요약 카드로. 배지 = 미확인 완료 세션 수("확인할 게 N개"). */}
      <button
        type="button"
        onClick={toggleSummaryPanel}
        className={`relative flex h-10 w-10 items-center justify-center rounded transition-colors ${
          summaryPanelOpen
            ? 'border-l-2 border-violet-400 bg-gray-800 text-white'
            : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
        }`}
        title={t('ide.activityBar.sessionSummary')}
        aria-label={t('ide.activityBar.sessionSummary')}
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x="8" y="3" width="8" height="4" rx="1" />
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <path d="M9 12h6" /><path d="M9 16h4" />
        </svg>
        {unreviewedCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-bold text-white">
            {unreviewedCount > 99 ? '99+' : unreviewedCount}
          </span>
        )}
      </button>

      {/* §5.5 #17-9 v3.51 — 실행 중 서브에이전트. 이 에이전트가 백단에 자식을 하나라도 띄운 동안에만
          나타나고, 마지막 자식이 끝나면 아이콘·배지가 통째로 사라진다(항상 자리를 차지하지 않게).
          배지는 현재 탭 기준 개수 — 그 탭이 띄운 게 없으면 0 을 숨겨 "다른 탭에서 돈다"를 표현. */}
      {runningTotal > 0 && (
        <button
          type="button"
          onClick={toggleSubagentPanel}
          className={`relative flex h-10 w-10 items-center justify-center rounded transition-colors ${
            subagentPanelOpen
              ? 'border-l-2 border-sky-400 bg-gray-800 text-white'
              : 'text-sky-400/80 hover:bg-gray-800 hover:text-sky-300'
          }`}
          title={t('ide.activityBar.runningSubagents', { count: runningTasks.length })}
          aria-label={t('ide.activityBar.runningSubagents', { count: runningTasks.length })}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          {runningTasks.length > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-500 px-1 text-[9px] font-bold text-white">
              {runningTasks.length > 99 ? '99+' : runningTasks.length}
            </span>
          )}
        </button>
      )}
    </div>
  );
});
