import { useTranslation } from 'react-i18next';
import type { StreamSystem } from './streamItems.js';

interface TransportRecoveryLineProps {
  recovery: NonNullable<StreamSystem['transportRecovery']>;
  content: string;
  sessionLabel?: string;
}

/** A recoverable connection notice, shared by the main timeline and session view. */
export function TransportRecoveryLine({ recovery, content, sessionLabel }: TransportRecoveryLineProps): React.JSX.Element {
  const { t } = useTranslation();
  const { notice, state } = recovery;
  const labelKey = state === 'recovering' ? notice.kind : state;
  const params = notice.kind === 'reconnecting'
    ? { attempt: notice.attempt, maxAttempts: notice.maxAttempts }
    : {};
  return (
    <div className="flex items-center gap-2 px-4 py-1 text-[12px] text-gray-400 max-md:px-1.5" title={content}>
      <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {state === 'resumed'
          ? <polyline points="5 12 9 16 19 6" />
          : <><path d="M20 7a9 9 0 0 0-15-2L2 8" /><path d="M2 3v5h5" /><path d="M4 17a9 9 0 0 0 15 2l3-3" /><path d="M22 21v-5h-5" /></>}
      </svg>
      {sessionLabel && <span className="flex-shrink-0 text-cyan-400/80">{sessionLabel}</span>}
      <span role={state === 'recovering' ? 'status' : undefined}>{t(`ide.transportRecovery.${labelKey}`, params)}</span>
    </div>
  );
}
