import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClosedTabEntry } from '@vibisual/shared';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { useKeymapStore, selectBinding } from '../../stores/keymap.js';
import { shortcutLabel } from '../../utils/platform.js';
import { formatSince } from '../../formatSince.js';

/**
 * 메뉴 한 줄의 식별자.
 *
 * `reopenClosed`·`recentlyClosed` 는 **`onAction` 으로 나가지 않는다**(§5.4 #14-4) — 전용
 * 콜백(`onReopen`)이 있고, 이 둘은 "어느 항목을 여느냐"라는 인자를 함께 넘겨야 하기 때문이다.
 * 유니온에 넣어 두는 이유는 `actions` 배열이 이 타입으로 키를 잡기 때문이고, 실제 분기는
 * 아래 `handleClick` 이 `onAction` 에 닿기 전에 가른다.
 */
export type TabContextAction = 'close' | 'closeOthers' | 'closeLeft' | 'closeRight' | 'closeAll' | 'togglePin' | 'toggleDefault' | 'detach' | 'rename' | 'splitRight' | 'splitDown' | 'reopenClosed' | 'recentlyClosed';

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
  /**
   * §5.4 #14-4 — 최근에 닫은 탭(최신이 앞). 서버 `AppState.recentlyClosedTabs` 를 그대로 받는다.
   * 비었거나 `onReopen` 이 없으면 "다시 열기" 묶음 자체를 그리지 않는다 — IDE 세션 탭 메뉴처럼
   * 이 기능이 없는 자리에 빈 항목을 남기지 않기 위해서다.
   */
  recentlyClosed?: ClosedTabEntry[];
  /** 되열기. 인자가 없으면 **가장 최근에 닫은 것**(브라우저 Ctrl+Shift+T 와 같은 동작). */
  onReopen?: (key?: string) => void;
  /** "다시 열기" 목록 비우기. 없으면 그 항목만 빠진다. */
  onClearClosed?: () => void;
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
  recentlyClosed,
  onReopen,
  onClearClosed,
  onAction,
  onClose,
}: TabContextMenuProps): React.JSX.Element {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  // §5.4 #14-4 — 되열 수 있는 목록. 이 기능이 없는 자리(IDE 세션 탭)에서는 묶음 자체가 빠진다.
  const closed = useMemo(() => (onReopen ? (recentlyClosed ?? []) : []), [onReopen, recentlyClosed]);
  const hasClosed = closed.length > 0;
  // 힌트는 **지금 실제로 도는 키**를 그린다 — 하드코딩하면 재매핑한 사용자에게 거짓말이 된다.
  const reopenBinding = useKeymapStore(selectBinding('global.reopenClosedTab'));

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
    /** 오른쪽 끝 회색 글씨(단축키 힌트). */
    hint?: string;
    /** 이 줄에 하위 목록(▸)이 달리는가 — §5.4 #14-4 "최근에 닫은 탭". */
    submenu?: boolean;
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
    // §5.4 #14-4 — 닫기 묶음 **바로 아래**. Chrome·Firefox 가 둘 다 이 자리에 두므로, 다른 데
    //   두면 브라우저에서 손에 익은 사용자가 못 찾는다. 되열 것이 없으면 흐린 채로 남긴다 —
    //   항목이 통째로 사라지면 "이 앱엔 그 기능이 없다"로 읽힌다.
    ...(onReopen
      ? [
          {
            key: 'reopenClosed' as const,
            label: t('tabMenu.reopenClosed', { defaultValue: 'Reopen closed tab' }),
            disabled: !hasClosed,
            separatorAbove: true,
            ...(hasClosed && closed[0] ? { tooltip: closed[0].label } : {}),
            ...(reopenBinding ? { hint: shortcutLabel(reopenBinding) } : {}),
          },
          ...(hasClosed
            ? [
                {
                  key: 'recentlyClosed' as const,
                  label: t('tabMenu.recentlyClosed', { defaultValue: 'Recently closed' }),
                  submenu: true,
                },
              ]
            : []),
        ]
      : []),
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

  const handleClick = (action: TabContextAction, disabled?: boolean, el?: HTMLElement | null): void => {
    if (disabled) return;
    // §5.4 #14-4 — 하위 목록을 여는 줄. 마우스는 호버로 열지만 **손가락에는 호버가 없다** —
    //   눌러서도 열리지 않으면 터치 화면에서는 목록에 닿을 길이 아예 없다(#14-2 가 HTML5 드래그로
    //   같은 구멍을 냈던 자리와 같은 종류). 이미 열려 있으면 닫는다.
    if (action === 'recentlyClosed') {
      if (flyout) setFlyout(null);
      else if (el) openFlyout(el);
      return;
    }
    if (action === 'reopenClosed') {
      onReopen?.();
      onClose();
      return;
    }
    onAction(action);
    onClose();
  };

  /** 하위 목록에서 한 건을 고름 — 그 탭만 되연다. */
  const handlePickClosed = useCallback((key: string): void => {
    onReopen?.(key);
    onClose();
  }, [onReopen, onClose]);

  // 뷰포트 경계 보정
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const menuWidth = 208;
  // 높이는 **실제 줄 수에서 센다.** 종전엔 상수 두 개(288/344)로 짐작했는데, 그러면 항목이 늘 때마다
  //   여기를 같이 고쳐야 하고 잊으면 메뉴 아래가 화면 밖으로 잘린다(§5.4 #14-4 로 두 줄이 늘었다).
  const ITEM_H = 28;
  const SEP_H = 9;
  const menuHeight =
    actions.length * ITEM_H + actions.filter((a) => a.separatorAbove).length * SEP_H + 8;
  const left = Math.min(x, vw - menuWidth - 4);
  const top = Math.max(4, Math.min(y, vh - menuHeight - 4));

  // ── §5.4 #14-4 하위 목록(최근에 닫은 탭) ──
  // 부모 줄의 실제 사각형을 기준으로 옆에 세운다. 오른쪽이 모자라면 왼쪽으로 넘긴다.
  const [flyout, setFlyout] = useState<{ top: number; left: number } | null>(null);
  const closeTimer = useRef<number | null>(null);
  const SUB_W = 236;

  const openFlyout = useCallback((el: HTMLElement): void => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    const r = el.getBoundingClientRect();
    // 목록은 최대 10줄까지 보이고 그 뒤로는 스크롤한다(25건까지 쌓이므로 그대로 그리면 화면을 넘는다).
    const rows = Math.min(closed.length, 10);
    const subH = rows * ITEM_H + (onClearClosed ? ITEM_H + SEP_H : 0) + 8;
    const spillsRight = r.right + SUB_W > vw - 4;
    setFlyout({
      top: Math.max(4, Math.min(r.top - 4, vh - subH - 4)),
      left: spillsRight ? Math.max(4, r.left - SUB_W + 2) : r.right - 2,
    });
  }, [closed.length, onClearClosed, vh, vw]);

  /** 커서가 부모 줄과 하위 목록 사이를 지날 때 깜빡이지 않도록 닫기를 잠깐 미룬다. */
  const scheduleCloseFlyout = useCallback((): void => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setFlyout(null);
      closeTimer.current = null;
    }, 180);
  }, []);

  const keepFlyout = useCallback((): void => {
    if (closeTimer.current === null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

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
              onClick={(e) => handleClick(action.key, action.disabled, e.currentTarget)}
              // §5.4 #14-4 — 하위 목록은 **호버로 열고**, 다른 줄로 내려가면 닫는다(OS 메뉴와 같은 결).
              onMouseEnter={(e) => {
                if (action.submenu) openFlyout(e.currentTarget);
                else scheduleCloseFlyout();
              }}
              onFocus={(e) => {
                if (action.submenu) openFlyout(e.currentTarget);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                action.disabled
                  ? 'cursor-default text-gray-600'
                  : 'text-gray-200 hover:bg-gray-800'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
              {/* §9 한글 가독 하한 12px — 위계는 크기가 아니라 **색**으로 낸다(작게 하면 획이 무너진다). */}
              {action.hint && (
                <span className={`flex-shrink-0 text-[12px] tabular-nums ${action.disabled ? 'text-gray-700' : 'text-gray-500'}`}>
                  {action.hint}
                </span>
              )}
              {action.submenu && (
                <svg className="h-3 w-3 flex-shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              )}
            </button>
          </div>
        ))}
      </div>

      {/* §5.4 #14-4 — 최근에 닫은 탭 목록. 이 메뉴의 자식으로 두어야 바깥 클릭 판정(menuRef)이
          이 안의 클릭을 "바깥"으로 오해하지 않는다. */}
      {flyout && hasClosed && (
        <div
          className="fixed z-50"
          style={{ left: flyout.left, top: flyout.top, width: SUB_W }}
          onMouseEnter={keepFlyout}
          onMouseLeave={scheduleCloseFlyout}
        >
          <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl shadow-black/40">
            {closed.map((entry) => (
              <button
                key={entry.key}
                type="button"
                title={entry.kind === 'project' ? entry.path : entry.url}
                onClick={() => handlePickClosed(entry.key)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-200 transition-colors hover:bg-gray-800"
              >
                {entry.kind === 'project' ? (
                  <svg className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
                  </svg>
                )}
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.closedAt > 0 && (
                  <span className="flex-shrink-0 text-[12px] text-gray-500">
                    {formatSince(entry.closedAt, t)}
                  </span>
                )}
              </button>
            ))}
            {onClearClosed && (
              <>
                <div className="mx-2 my-1 border-t border-gray-700" />
                <button
                  type="button"
                  onClick={() => { onClearClosed(); onClose(); }}
                  className="flex w-full items-center px-3 py-1.5 text-left text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
                >
                  {t('tabMenu.clearRecentlyClosed', { defaultValue: 'Clear list' })}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
