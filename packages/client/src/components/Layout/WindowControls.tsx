import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 프레임 없는 창(`frame: false`)의 최소화 · 최대화/복원 · 닫기 버튼.
 *
 * 별창(DetachedShell) · Command Center · 내부 앱 창(§5.13)이 모두 같은
 * `vibisual:window:*-self` 채널을 쓰므로 버튼도 한 곳에서 그린다 — 창을 새로 만들 때마다
 * 이 세 개를 다시 손으로 붙이다 보면 이번처럼 통째로 빠진 창이 생긴다.
 *
 * 최대화 상태는 main 이 `maximize`/`unmaximize` 때 푸시하는 값을 그대로 따른다
 * (OS 더블클릭·스냅으로 바뀌어도 아이콘이 어긋나지 않게).
 */

interface WindowControlsProps {
  /**
   * 버튼의 pointerdown 이 부모로 올라가지 않게 막을지.
   * 타이틀바가 pointerdown 으로 드래그를 시작하는 창(별창 redock)에서 필요하다.
   */
  readonly stopPointerDown?: boolean;
}

export function WindowControls({ stopPointerDown = false }: WindowControlsProps): React.JSX.Element {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const api = window.api;
    if (!api?.window?.onMaximizeState) return;
    const off = api.window.onMaximizeState((s) => setMaximized(s.maximized));
    return () => { off(); };
  }, []);

  const handleMinimize = useCallback((): void => { void window.api?.window?.minimizeSelf(); }, []);
  const handleToggleMaximize = useCallback((): void => { void window.api?.window?.toggleMaximizeSelf(); }, []);
  const handleClose = useCallback((): void => { void window.api?.window?.closeSelf(); }, []);

  const onPointerDown = stopPointerDown
    ? (e: React.PointerEvent<HTMLButtonElement>): void => e.stopPropagation()
    : undefined;

  return (
    <div className="flex flex-shrink-0 items-center gap-1 pr-2 app-nodrag">
      <button
        type="button"
        {...(onPointerDown ? { onPointerDown } : {})}
        onClick={handleMinimize}
        className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-100"
        title={t('tabDetach.minimizeWindow', { defaultValue: 'Minimize' })}
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2.5 6h7" />
        </svg>
      </button>
      <button
        type="button"
        {...(onPointerDown ? { onPointerDown } : {})}
        onClick={handleToggleMaximize}
        className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-100"
        title={
          maximized
            ? t('tabDetach.restoreWindow', { defaultValue: 'Restore' })
            : t('tabDetach.maximizeWindow', { defaultValue: 'Maximize' })
        }
      >
        {maximized ? (
          <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3.5" y="3.5" width="6" height="6" rx="0.5" />
            <path d="M2.5 8V2.5H8" />
          </svg>
        ) : (
          <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2.5" y="2.5" width="7" height="7" rx="0.5" />
          </svg>
        )}
      </button>
      <button
        type="button"
        {...(onPointerDown ? { onPointerDown } : {})}
        onClick={handleClose}
        className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-red-500/80 hover:text-white"
        title={t('tabDetach.closeWindow', { defaultValue: 'Close window' })}
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 3l6 6M9 3l-6 6" />
        </svg>
      </button>
    </div>
  );
}
