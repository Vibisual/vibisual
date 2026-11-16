import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionMemo } from '@vibisual/shared';
import { memoSurface, memoTitle } from './sessionMemo.js';

interface CanvasMemoBubbleProps {
  memo: SessionMemo;
  scale: number;
  disabled?: boolean;
  onMove: (id: string, x: number, y: number) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onMenu: (id: string, at: { x: number; y: number }) => void;
}

export function CanvasMemoBubble({ memo, scale, onMove, onRestore, onDelete, onMenu, disabled }: CanvasMemoBubbleProps): React.JSX.Element {
  const { t } = useTranslation();
  const drag = useRef<{ x: number; y: number } | null>(null);
  const title = memoTitle(memo, t('ide.memo.title'));
  const surface = memoSurface(memo.color, 1);
  return (
    <button type="button" disabled={disabled} data-canvas-memo-bubble={memo.id}
      className="pointer-events-auto absolute flex h-12 w-12 touch-none items-center justify-center rounded-full border shadow-lg outline-none focus:ring-2 focus:ring-sky-400 nodrag nopan"
      style={{ left: memo.x * scale, top: memo.y * scale, background: surface.background, borderColor: surface.border, color: surface.text }}
      title={t('ide.memo.canvasBubbleHint', { name: title })} aria-label={title}
      onDoubleClick={(e) => { e.stopPropagation(); onRestore(memo.id); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onMenu(memo.id, { x: e.clientX, y: e.clientY }); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onDelete(memo.id); }
        if (e.key === 'Enter') { e.preventDefault(); onRestore(memo.id); }
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        drag.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        e.currentTarget.style.transform = `translate(${e.clientX - drag.current.x}px, ${e.clientY - drag.current.y}px)`;
      }}
      onPointerUp={(e) => {
        const start = drag.current;
        drag.current = null;
        e.currentTarget.style.transform = '';
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        if (start) onMove(memo.id, memo.x + (e.clientX - start.x) / scale, memo.y + (e.clientY - start.y) / scale);
      }}
      onPointerCancel={(e) => { drag.current = null; e.currentTarget.style.transform = ''; }}
    >
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10l6-6V5a2 2 0 0 0-2-2h-5Z" /><path d="M15 21v-6h6M7 8h10M7 12h7" />
      </svg>
    </button>
  );
}
