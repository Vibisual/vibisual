import { useEffect, useRef, useState, type TableHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { useScrollReveal } from '../../hooks/useScrollReveal.js';
import { streamElementClipboard, writeStreamClipboard } from './streamClipboard.js';

const COPY_FEEDBACK_MS = 1400;
type CopyStatus = 'idle' | 'copying' | 'copied' | 'failed';

export function MarkdownTable({ children, node: _node, ...rest }: TableHTMLAttributes<HTMLTableElement> & { node?: unknown }): React.JSX.Element {
  const { t } = useTranslation();
  const tableRef = useRef<HTMLTableElement>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<CopyStatus>('idle');
  const scrollReveal = useScrollReveal();
  useEffect(() => {
    setStatus('idle');
    return () => {
      attemptRef.current += 1;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [children]);

  const handleCopy = async (): Promise<void> => {
    if (!tableRef.current) return;
    const attempt = ++attemptRef.current;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setStatus('copying');
    try {
      await writeStreamClipboard(streamElementClipboard(tableRef.current));
      if (attempt !== attemptRef.current) return;
      setStatus('copied');
      timerRef.current = setTimeout(() => { setStatus('idle'); timerRef.current = null; }, COPY_FEEDBACK_MS);
    } catch {
      if (attempt === attemptRef.current) setStatus('failed');
    }
  };
  const label = t(status === 'copied' ? 'ide.streamRenderer.copied'
    : status === 'failed' ? 'common.appError.retry' : 'ide.streamRenderer.copy');

  return <div className="ide-breakout group/table relative min-w-0">
    <div className="flex justify-end" data-clipboard-ignore="">
      <button type="button" title={label} aria-label={label} disabled={status === 'copying'}
        onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}
        onClick={event => { event.stopPropagation(); void handleCopy(); }}
        className="inline-flex select-none items-center gap-1 rounded border border-white/10 bg-gray-900/70 px-1.5 py-1 text-[12px] text-gray-300 opacity-60 transition-opacity hover:bg-gray-800/80 hover:text-gray-100 hover:opacity-100 focus:opacity-100 disabled:opacity-35 pointer-coarse:p-2.5 pointer-coarse:opacity-100">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {status === 'copied' ? <path d="m5 12 4 4L19 6" /> : status === 'failed' ? <path d="m6 6 12 12M6 18 18 6" />
            : <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>}
        </svg>
        <span aria-live="polite">{label}</span>
      </button>
    </div>
    <div className="scrollbar-thin overflow-x-auto" {...scrollReveal}><table ref={tableRef} {...rest}>{children}</table></div>
  </div>;
}
