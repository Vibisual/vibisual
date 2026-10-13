import { useContext, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { StudioAccentContext } from './studioMotion.js';

/**
 * §5.13 (V) — 스튜디오의 떠 있는 판(문서 메뉴·판형 칩·내보내기·전환 고르기·구슬 메뉴).
 *
 * 문서 몸으로 포털한다 — 스튜디오는 앱 안 창(머리줄의 흐림 효과가 쌓임 맥락을 만든다)이나 분리된 창 어디에나 있을 수 있어,
 * 그 안에 두면 잘리거나 창 몸이 덮는다. 앱 창들의 z 순서(백만 단위) 위에 서고, 바깥 누름·Esc 로 닫힌다(§6 공통 규약 —
 * 판 안에서 시작한 손짓은 판을 닫지 못한다, `useOutsidePressDismiss`).
 */
export const STUDIO_POPOVER_Z = 2_100_000_000;

export interface StudioPopoverProps {
  readonly anchor: RefObject<HTMLElement | null>;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** 닻 아래(기본)·위. */
  readonly side?: 'below' | 'above';
  readonly align?: 'start' | 'end';
  readonly className?: string;
  readonly label?: string;
}

const GAP = 6;
const MARGIN = 8;

export function StudioPopover(p: StudioPopoverProps): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const accent = useContext(StudioAccentContext);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useOutsidePressDismiss({ enabled: p.open, onDismiss: p.onClose, refs: [panelRef, p.anchor] });

  useLayoutEffect(() => {
    if (!p.open) { setPos(null); return; }
    const place = (): void => {
      const a = p.anchor.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!a) return;
      const w = panel?.width ?? 240;
      const h = panel?.height ?? 200;
      let left = p.align === 'end' ? a.right - w : a.left;
      left = Math.max(MARGIN, Math.min(window.innerWidth - w - MARGIN, left));
      let top = p.side === 'above' ? a.top - h - GAP : a.bottom + GAP;
      if (top + h > window.innerHeight - MARGIN) top = Math.max(MARGIN, a.top - h - GAP);
      if (top < MARGIN) top = a.bottom + GAP;
      setPos({ left, top });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', place); };
  }, [p.open, p.anchor, p.side, p.align]);

  if (!p.open) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={p.label}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); p.onClose(); } }}
      className={`fixed animate-[vs-pop_140ms_ease-out] rounded-lg border border-white/[0.08] bg-vb-raised p-1.5 text-[13px] text-slate-200 shadow-xl shadow-black/50 ${p.className ?? ''}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: STUDIO_POPOVER_Z, '--vs-accent': accent } as CSSProperties}
    >
      {p.children}
    </div>,
    document.body,
  );
}

/** 판 안의 한 줄 단추. */
export function PopoverItem({ children, onClick, active, disabled, hint }: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly hint?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors duration-150 ease-out disabled:cursor-default disabled:opacity-40 ${active ? 'bg-white/10 text-slate-50' : 'text-slate-300 hover:bg-white/10 hover:text-slate-50'}`}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 text-[12px] tabular-nums text-slate-500">{hint}</span> : null}
    </button>
  );
}
