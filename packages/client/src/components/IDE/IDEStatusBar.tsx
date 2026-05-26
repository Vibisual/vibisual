import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BubbleData, SubAgent } from '@vibisual/shared';

interface IDEStatusBarProps {
  agent: BubbleData;
  activeSession: SubAgent | null;
  isCustom: boolean;
  sessionCount: number;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function formatModelName(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

export const IDEStatusBar = memo(function IDEStatusBar({
  agent,
  activeSession,
  isCustom,
  sessionCount,
}: IDEStatusBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const model = activeSession?.modelName ?? agent.modelName;
  const status = activeSession?.status ?? agent.status;
  const inputTokens = activeSession?.totalInputTokens ?? agent.totalInputTokens ?? 0;
  const outputTokens = activeSession?.totalOutputTokens ?? agent.totalOutputTokens ?? 0;

  return (
    <div className="flex h-6 flex-shrink-0 items-center gap-4 border-t border-gray-700 bg-gray-900/80 px-3 text-[10px]">
      {/* Agent type */}
      <span className={`rounded px-1.5 py-0.5 font-semibold ${
        isCustom ? 'bg-blue-500/15 text-blue-400' : 'bg-gray-600/30 text-gray-400'
      }`}>
        {isCustom ? t('ide.statusBar.custom') : t('ide.statusBar.hook')}
      </span>

      {/* Status */}
      <span className="flex items-center gap-1">
        <span className={`h-1.5 w-1.5 rounded-full ${
          status === 'active' ? 'bg-blue-400 animate-pulse'
            : status === 'completed' ? 'bg-cyan-400'
              : 'bg-gray-500'
        }`} />
        <span className="text-gray-400">{status}</span>
      </span>

      {/* Model */}
      {model && (
        <span className="text-gray-500">
          {formatModelName(model)}
        </span>
      )}

      {/* Context usage */}
      {agent.contextMax && (
        <span className="text-gray-500">
          {t('ide.statusBar.context', { used: formatTokenCount(agent.contextUsed ?? 0), max: formatTokenCount(agent.contextMax) })}
        </span>
      )}

      {/* Token usage */}
      {inputTokens > 0 && (
        <span className="text-violet-400/70">
          {t('ide.statusBar.tokens', { in: formatTokenCount(inputTokens), out: formatTokenCount(outputTokens) })}
        </span>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Session count */}
      <span className="text-gray-600">
        {sessionCount === 1
          ? t('ide.statusBar.sessionOne', { count: sessionCount })
          : t('ide.statusBar.sessionMany', { count: sessionCount })}
      </span>
    </div>
  );
});
