import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SESSION_MEMO, type SessionMemo } from '@vibisual/shared';
import { IDEContextMenu, type ContextMenuItem } from './IDEContextMenu.js';
import { memoTitle } from './sessionMemo.js';

interface SessionMemoHistoryProps {
  /** The owner's closed memos, newest first. */
  closedMemos: SessionMemo[];
  onRestore: (id: string) => void;
  restoreDisabled?: boolean;
  /** Also used outside a card when the last open memo was closed. */
  showLabel?: boolean;
  className?: string;
}

/** A trigger press dismisses the shared menu before its click reaches this button. */
const REOPEN_GUARD_MS = 200;

export function SessionMemoHistory({ closedMemos, onRestore, restoreDisabled = false, showLabel = false, className = '' }: SessionMemoHistoryProps): React.JSX.Element {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closedAtRef = useRef(0);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => {
    closedAtRef.current = Date.now();
    setAnchor(null);
  }, []);
  useEffect(() => {
    if (closedMemos.length === 0) setAnchor(null);
  }, [closedMemos.length]);
  const toggle = (): void => {
    if (closedMemos.length === 0 || Date.now() - closedAtRef.current < REOPEN_GUARD_MS) return;
    if (anchor) { close(); return; }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ x: rect.left, y: rect.bottom + 4 });
  };
  const label = t('ide.memo.history.title');
  const help = t('ide.memo.history.help');
  const limit = t('ide.memo.history.limit', { max: SESSION_MEMO.MAX_PER_OWNER });
  const items: ContextMenuItem[] = anchor ? [
    { id: 'history-heading', label, note: restoreDisabled ? limit : help, disabled: true, onClick: () => undefined },
    ...closedMemos.map((memo, index): ContextMenuItem => ({
      id: memo.id,
      label: memoTitle(memo, t('ide.memo.title')),
      hint: t('ide.memo.history.restore'),
      separatorBefore: index === 0,
      disabled: restoreDisabled,
      disabledTitle: restoreDisabled ? limit : undefined,
      onClick: () => { if (!restoreDisabled) onRestore(memo.id); },
    })),
  ] : [];

  return (
    // Portal events still follow the React tree. Keep both the button and menu out of header gestures.
    <span
      className="contents"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
    >
      <button
        ref={buttonRef}
        type="button"
        title={`${label}\n${closedMemos.length === 0 ? t('ide.memo.history.empty') : help}`}
        aria-label={closedMemos.length > 0 ? t('ide.memo.history.count', { n: closedMemos.length }) : label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null && closedMemos.length > 0}
        disabled={closedMemos.length === 0}
        onClick={toggle}
        className={`flex h-5 flex-shrink-0 items-center justify-center gap-1 rounded px-1 text-[12px] leading-none transition-colors hover:bg-[var(--memo-line)] disabled:cursor-default disabled:opacity-35 ${className}`}
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 11a9 9 0 1 1 2.6 7.4" />
          <path d="M3 4v7h7M12 7v5l3 2" />
        </svg>
        {showLabel && <span>{label}</span>}
        {closedMemos.length > 0 && <span className="tabular-nums" aria-hidden="true">{closedMemos.length}</span>}
      </button>
      {anchor && closedMemos.length > 0 && (
        <IDEContextMenu x={anchor.x} y={anchor.y} items={items} density="compact" onClose={close} />
      )}
    </span>
  );
}
