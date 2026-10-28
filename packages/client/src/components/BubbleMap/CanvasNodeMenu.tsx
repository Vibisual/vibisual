import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { MENU_VIEWPORT_MARGIN, placeCanvasMenu } from './canvasMenuPlacement.js';

/**
 * 자기 메뉴를 가진 캔버스 노드(앱·선반·플레이·랩·스펙)의 우클릭 메뉴 껍데기. 화면 안으로 민다(`placeCanvasMenu` — 가장자리 8px 안쪽일 때만), 길면 스크롤.
 * 닫기: 바깥 press(캡처 단계 · 안에서 시작한 손짓 ❌) · 아무 키.
 */
export interface CanvasNodeMenuProps {
  /** 연 자리(화면 좌표). */
  x: number;
  y: number;
  /** 최소 폭 — 노드마다 달랐던 값을 그대로 받는다(`min-w-44` · `min-w-52`). */
  minWidthClass: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function CanvasNodeMenu({ x, y, minWidthClass, onClose, children }: CanvasNodeMenuProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 바깥 press 로 닫기(공통 규약 — 메뉴 안에서 시작한 press·드래그로는 안 닫힌다).
  // capture 단계 — React Flow 가 이벤트를 선점하기 전에 닫는다.
  useOutsidePressDismiss({ onDismiss: () => onCloseRef.current(), refs: [ref] });

  useEffect(() => {
    const close = (): void => onCloseRef.current();
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, []);

  /**
   * 그리기 전에 재서 화면 안으로 민다. 폭·높이 상한은 클래스(`dvh`·`vw`)가 먼저 걸고, 여기서는 핀치 줌으로
   * 줄어든 **보이는 영역**(visualViewport)에 한 번 더 맞춘다 — 버블 메뉴(`IDEContextMenuPanel`)와 같은 기준.
   */
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const update = (): void => {
      const visual = window.visualViewport;
      const viewport = {
        left: visual?.offsetLeft ?? 0,
        top: visual?.offsetTop ?? 0,
        width: visual?.width ?? window.innerWidth,
        height: visual?.height ?? window.innerHeight,
      };
      menu.style.maxWidth = `${Math.max(0, viewport.width - MENU_VIEWPORT_MARGIN * 2)}px`;
      menu.style.maxHeight = `${Math.max(0, viewport.height - MENU_VIEWPORT_MARGIN * 2)}px`;
      const position = placeCanvasMenu({ x, y }, menu.getBoundingClientRect(), viewport);
      menu.style.left = `${position.left}px`;
      menu.style.top = `${position.top}px`;
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(menu);
    window.addEventListener('resize', update);
    const visual = window.visualViewport;
    visual?.addEventListener('resize', update);
    visual?.addEventListener('scroll', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      visual?.removeEventListener('resize', update);
      visual?.removeEventListener('scroll', update);
    };
  }, [x, y]);

  return createPortal(
    <div
      ref={ref}
      className={`fixed z-[60] ${minWidthClass} max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl shadow-black/40`}
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface CanvasNodeMenuItemProps {
  onClick: () => void;
  label: string;
  danger?: boolean | undefined;
  disabled?: boolean | undefined;
  /** 흐려진 이유·덧붙일 말(툴팁). */
  title?: string | undefined;
}

/** 메뉴 한 줄 — 다섯 노드가 같은 모양으로 쓰던 버튼 그대로(글자 14px · 위아래 8px 이라 손가락에도 36px). */
export function CanvasNodeMenuItem({ onClick, label, danger, disabled, title }: CanvasNodeMenuItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled === true}
      title={title}
      className={`w-full px-3 py-2 text-left text-sm transition-colors ${
        disabled === true
          ? 'cursor-not-allowed text-gray-500'
          : `hover:bg-gray-800 ${danger === true ? 'text-rose-300' : 'text-gray-200'}`
      }`}
    >
      {label}
    </button>
  );
}

/** 묶음이 바뀌는 자리의 구분선. */
export function CanvasNodeMenuSeparator(): React.JSX.Element {
  return <div className="mx-2 my-1 border-t border-gray-700" />;
}
