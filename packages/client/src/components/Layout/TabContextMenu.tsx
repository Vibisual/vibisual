import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export type TabContextAction = 'close' | 'closeOthers' | 'closeRight' | 'closeAll' | 'togglePin' | 'toggleDefault' | 'detach';

interface TabContextMenuProps {
  x: number;
  y: number;
  isPinned: boolean;
  isDefault: boolean;
  hasOthers: boolean;
  hasRight: boolean;
  /** §5.4 #14-1 — 별창 분리 메뉴 노출 여부. 기본 true. IDE 서브에이전트 탭 등에선 false. */
  showDetach?: boolean;
  onAction: (key: TabContextAction) => void;
  onClose: () => void;
}

export const TabContextMenu = memo(function TabContextMenu({
  x,
  y,
  isPinned,
  isDefault,
  hasOthers,
  hasRight,
  showDetach = true,
  onAction,
  onClose,
}: TabContextMenuProps): React.JSX.Element {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleDown(e: MouseEvent): void {
      if (e.button !== 0 && e.button !== 1) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleDown, true);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const actions: Array<{
    key: TabContextAction;
    label: string;
    disabled?: boolean;
    separatorAbove?: boolean;
    tooltip?: string;
  }> = [
    { key: 'close', label: t('tabMenu.close') },
    { key: 'closeOthers', label: t('tabMenu.closeOthers'), disabled: !hasOthers },
    { key: 'closeRight', label: t('tabMenu.closeRight'), disabled: !hasRight },
    { key: 'closeAll', label: t('tabMenu.closeAll') },
    {
      key: 'togglePin',
      label: isPinned ? t('tabMenu.unpin') : t('tabMenu.pin'),
      separatorAbove: true,
      tooltip: t('tabMenu.pinTooltip'),
    },
    {
      key: 'toggleDefault',
      label: isDefault ? t('tabMenu.unsetDefault') : t('tabMenu.setDefault'),
      tooltip: t('tabMenu.defaultTooltip'),
    },
    // §5.4 #14-1 (v2.29) — Drag-out 외에 컨텍스트 메뉴로도 분리 가능. showDetach=false 면 항목 제외.
    ...(showDetach
      ? [
          {
            key: 'detach' as const,
            label: t('tabMenu.detach', { defaultValue: 'Detach to new window' }),
            separatorAbove: true,
          },
        ]
      : []),
  ];

  const handleClick = (action: TabContextAction, disabled?: boolean): void => {
    if (disabled) return;
    onAction(action);
    onClose();
  };

  // 뷰포트 경계 보정
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const menuWidth = 208;
  const menuHeight = 260;
  const left = Math.min(x, vw - menuWidth - 4);
  const top = Math.min(y, vh - menuHeight - 4);

  return (
    <div
      ref={menuRef}
      className="fixed z-50"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="min-w-52 rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl shadow-black/40">
        {actions.map((action) => (
          <div key={action.key}>
            {action.separatorAbove && <div className="mx-2 my-1 border-t border-gray-700" />}
            <button
              type="button"
              disabled={action.disabled}
              title={action.tooltip}
              onClick={() => handleClick(action.key, action.disabled)}
              className={`flex w-full items-center px-3 py-1.5 text-left text-xs transition-colors ${
                action.disabled
                  ? 'cursor-default text-gray-600'
                  : 'text-gray-200 hover:bg-gray-800'
              }`}
            >
              {action.label}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
});
