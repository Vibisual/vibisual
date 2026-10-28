import { useContext, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { StudioAccentContext } from './studioMotion.js';

/**
 * §5.13 (V) — 스튜디오 떠 있는 판. 문서 몸으로 포털한다(앱 안 창 머리줄의 흐림이 쌓임 맥락을 만들어 안에선 잘린다). z 는 앱 창(백만 단위) 위.
 * 바깥 누름·Esc 로 닫되 판 안에서 시작한 손짓은 닫지 못한다(§6, `useOutsidePressDismiss`).
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
  const [pos, setPos] = useState<{ left: number; top: number; maxWidth: number; maxHeight: number } | null>(null);
  useOutsidePressDismiss({ enabled: p.open, onDismiss: p.onClose, refs: [panelRef, p.anchor] });

  useLayoutEffect(() => {
    if (!p.open) { setPos(null); return; }
    const place = (): void => {
      const a = p.anchor.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!a) return;
      // 판은 화면보다 클 수 없다 — 넘치면 화면 안에 묶고 안쪽을 스크롤한다(폰·낮은 창에서 문서 목록 아래 항목에 닿지 못하던 것).
      const maxWidth = Math.max(0, window.innerWidth - MARGIN * 2);
      const maxHeight = Math.max(0, window.innerHeight - MARGIN * 2);
      const w = Math.min(panel?.width ?? 240, maxWidth);
      const h = Math.min(panel?.height ?? 200, maxHeight);
      let left = p.align === 'end' ? a.right - w : a.left;
      left = Math.max(MARGIN, Math.min(window.innerWidth - w - MARGIN, left));
      let top = p.side === 'above' ? a.top - h - GAP : a.bottom + GAP;
      if (top + h > window.innerHeight - MARGIN) top = Math.max(MARGIN, a.top - h - GAP);
      if (top < MARGIN) top = a.bottom + GAP;
      // 위·아래 어느 쪽에도 다 들어가지 않으면(앵커가 화면 가운데·판이 거의 화면만 할 때) 화면 안으로 당긴다.
      top = Math.max(MARGIN, Math.min(top, window.innerHeight - MARGIN - h));
      setPos({ left, top, maxWidth, maxHeight });
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
      className={`fixed animate-[vs-pop_140ms_ease-out] overflow-y-auto rounded-lg border border-white/[0.08] bg-vb-raised p-1.5 text-[13px] text-slate-200 shadow-xl shadow-black/50 ${p.className ?? ''}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, maxWidth: pos?.maxWidth, maxHeight: pos?.maxHeight, zIndex: STUDIO_POPOVER_Z, '--vs-accent': accent } as CSSProperties}
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
