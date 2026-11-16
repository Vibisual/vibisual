import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface SessionMemoCopyButtonProps {
  text: string;
}

const COPY_FEEDBACK_MS = 1400;
type CopyStatus = 'idle' | 'copying' | 'copied' | 'failed';

export function SessionMemoCopyButton({ text }: SessionMemoCopyButtonProps): React.JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CopyStatus>('idle');
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setStatus('idle');
    return () => {
      // A late clipboard response belongs to the old text or an unmounted memo.
      attemptRef.current += 1;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [text]);

  const handleCopy = async (): Promise<void> => {
    if (!text) return;
    const attempt = ++attemptRef.current;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setStatus('copying');
    try {
      await navigator.clipboard.writeText(text);
      if (attempt !== attemptRef.current) return;
      setStatus('copied');
      timerRef.current = setTimeout(() => {
        setStatus('idle');
        timerRef.current = null;
      }, COPY_FEEDBACK_MS);
    } catch {
      if (attempt === attemptRef.current) setStatus('failed');
    }
  };

  const label = t(status === 'copied' ? 'ide.streamRenderer.copied'
    : status === 'failed' ? 'common.appError.retry' : 'ide.streamRenderer.copy');

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={!text || status === 'copying'}
      onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); void handleCopy(); }}
      className="flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[12px] opacity-75 transition-colors hover:bg-[var(--memo-line)] hover:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-current disabled:cursor-default disabled:opacity-35 pointer-coarse:h-8 pointer-coarse:px-2"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {status === 'copied' ? <path d="m5 12 4 4L19 6" />
          : status === 'failed' ? <path d="m6 6 12 12M6 18 18 6" />
            : <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>}
      </svg>
      <span aria-live="polite">{label}</span>
    </button>
  );
}
