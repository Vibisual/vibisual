import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';

export type TabContextAction = 'close' | 'closeOthers' | 'closeLeft' | 'closeRight' | 'closeAll' | 'togglePin' | 'toggleDefault' | 'detach' | 'rename' | 'splitRight' | 'splitDown';

interface TabContextMenuProps {
  x: number;
  y: number;
  isPinned: boolean;
  isDefault: boolean;
  hasOthers: boolean;
  hasLeft: boolean;
  hasRight: boolean;
  /** §5.4 #14-1 — 별창 분리 메뉴 노출 여부. 기본 true. IDE 서브에이전트 탭 등에선 false. */
  showDetach?: boolean;
  /** 이름 변경 메뉴 노출 여부. 기본 false. IDE 서브에이전트 탭에서만 true. */
  showRename?: boolean;
  /**
   * §5.5 #17-34 — 화면 나누기 메뉴 노출 여부. 기본 false(프로젝트 탭바는 해당 없음).
   * 드래그만이 유일한 진입점이면 그런 기능이 있다는 것 자체를 알 길이 없고, 터치에서는 아예
   * 닿을 수 없다(HTML5 드래그는 손가락에 반응하지 않는다) — 그 두 구멍을 이 메뉴가 메운다.
   */
  showSplit?: boolean;
  onAction: (key: TabContextAction) => void;
  onClose: () => void;
}

export const TabContextMenu = memo(function TabContextMenu({
  x,
  y,
  isPinned,
  isDefault,
  hasOthers,
  hasLeft,
  hasRight,
  showDetach = true,
  showRename = false,
  showSplit = false,
  onAction,
  onClose,
}: TabContextMenuProps): React.JSX.Element {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  // 바깥 press 로 닫기(공통 규약). 우클릭(2)은 메뉴 재오픈용이라 닫기 사유가 아니다.
  useOutsidePressDismiss({
    onDismiss: onClose,
    refs: [menuRef],
    shouldConsider: (e) => e.button === 0 || e.button === 1,
  });

  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const actions: Array<{
    key: TabContextAction;
    label: string;
    disabled?: boolean;
    separatorAbove?: boolean;
    tooltip?: string;
  }> = [
    // 이름 변경 — IDE 서브에이전트 탭에서만(showRename). 인라인 편집 진입 트리거.
    ...(showRename
      ? [
          {
            key: 'rename' as const,
            label: t('tabMenu.rename', { defaultValue: 'Rename' }),
          },
        ]
      : []),
    // §5.5 #17-34 — 화면 나누기. 끌어다 놓는 길과 **같은 동작**이며, 여기서는 초점 칸을 기준으로 선다.
    ...(showSplit
      ? [
          {
            key: 'splitRight' as const,
            label: t('tabMenu.splitRight', { defaultValue: 'Split right' }),
            separatorAbove: showRename,
          },
          {
            key: 'splitDown' as const,
            label: t('tabMenu.splitDown', { defaultValue: 'Split down' }),
          },
        ]
      : []),
    { key: 'close', label: t('tabMenu.close'), separatorAbove: showRename || showSplit },
    { key: 'closeOthers', label: t('tabMenu.closeOthers'), disabled: !hasOthers },
    { key: 'closeLeft', label: t('tabMenu.closeLeft'), disabled: !hasLeft },
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
  // 항목이 늘면 아래가 잘리므로 높이 추정도 함께 늘린다(나누기 2줄 ≈ 56px).
  const menuHeight = showSplit ? 344 : 288;
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
