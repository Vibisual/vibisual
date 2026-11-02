import { useTranslation } from 'react-i18next';
import type { StreamSystem } from './streamItems.js';

interface TransportRecoveryLineProps {
  recovery: NonNullable<StreamSystem['transportRecovery']>;
  content: string;
  sessionLabel?: string;
}

/** Compact connection status; retry counts and transport details stay in the tooltip. */
export function TransportRecoveryLine({ recovery, content, sessionLabel }: TransportRecoveryLineProps): React.JSX.Element {
  const { t } = useTranslation();
  const recovering = recovery.state === 'recovering';
  const labelKey = recovering ? 'reconnecting' : recovery.state;
  return (
    <div className="flex min-w-0 items-center gap-2 px-4 py-1 text-[12px] max-md:px-1.5" title={content}>
      <span
        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${recovering ? 'animate-pulse bg-blue-400/80' : 'bg-gray-500/60'}`}
        aria-hidden="true"
      />
      {sessionLabel && <span className="max-w-[40%] truncate text-gray-400">{sessionLabel}</span>}
      <span
        className={`min-w-0 truncate italic ${recovering ? 'text-blue-300/85' : 'text-gray-500'}`}
        role={recovering ? 'status' : undefined}
      >{t(`ide.transportRecovery.${labelKey}`)}</span>
    </div>
  );
}
