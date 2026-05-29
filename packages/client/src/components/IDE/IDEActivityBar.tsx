import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';
import type { IDEViewType } from '../../stores/graphStore.js';

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

  const handleClick = useCallback((view: IDEViewType) => {
    if (activeView === view && !sidebarCollapsed) {
      toggleSidebar();
    } else {
      setActiveView(view);
      if (sidebarCollapsed) toggleSidebar();
    }
  }, [activeView, sidebarCollapsed, setActiveView, toggleSidebar]);

  return (
    <div className="flex w-12 flex-shrink-0 flex-col items-center gap-1 border-r border-gray-700 bg-gray-900/80 py-2">
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
    </div>
  );
});
