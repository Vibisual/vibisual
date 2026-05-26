import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubAgent } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';

interface SubAgentListProps {
  subAgents: SubAgent[];
}

type StatusKey = 'idle' | 'running' | 'done' | 'error';

const STATUS_STYLES: Record<string, { dot: string; labelKey: StatusKey }> = {
  idle: { dot: 'bg-emerald-400', labelKey: 'idle' },
  active: { dot: 'bg-blue-400 animate-pulse', labelKey: 'running' },
  completed: { dot: 'bg-gray-400', labelKey: 'done' },
  error: { dot: 'bg-red-400', labelKey: 'error' },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatTokenShort(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

export const SubAgentList = memo(function SubAgentList({
  subAgents,
}: SubAgentListProps): React.JSX.Element | null {
  const { t } = useTranslation();
  if (subAgents.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-gray-500">
        {t('panel.subAgent.heading', { count: subAgents.length })}
      </span>
      <ScrollFade maxHeight={256}><ul className="flex flex-col gap-1.5">
        {subAgents.map((sub) => {
          const st = STATUS_STYLES[sub.status] ?? STATUS_STYLES['idle']!;
          return (
            <li
              key={sub.id}
              className="flex items-center gap-2 rounded border border-gray-700/50 bg-gray-800/60 px-2.5 py-1.5"
            >
              <span className={`h-2 w-2 flex-shrink-0 rounded-full ${st.dot}`} />
              <div className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-gray-200">
                  {sub.label}
                </span>
                {sub.lastCommand && (
                  <span className="block truncate text-[10px] text-gray-500">
                    {sub.lastCommand}
                  </span>
                )}
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className={`text-[9px] ${sub.status === 'error' ? 'text-red-400' : 'text-gray-500'}`}>
                  {t(`panel.subAgent.status.${st.labelKey}`)}
                </span>
                {(sub.totalInputTokens ?? 0) > 0 && (
                  <span className="text-[9px] text-violet-400/70">
                    {t('panel.subAgent.tokensInOut', { in: formatTokenShort(sub.totalInputTokens ?? 0), out: formatTokenShort(sub.totalOutputTokens ?? 0) })}
                  </span>
                )}
                <span className="text-[9px] text-gray-600">
                  {formatTime(sub.lastActivityAt)}
                </span>
              </div>
            </li>
          );
        })}
      </ul></ScrollFade>
    </div>
  );
});
