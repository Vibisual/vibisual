import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubAgent } from '@vibisual/shared';
import { ScrollFade } from '../ScrollFade.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { SESSION_STATUS_DOT, SESSION_STATUS_LABEL_KEY, sessionRunStateOf, serializeBusySubIds, parseBusySubIds } from '../../utils/sessionStatus.js';

interface SubAgentListProps {
  subAgents: SubAgent[];
}

// 색·라벨 규약은 `utils/sessionStatus` 공용(종전 사본은 확인 여부를 안 봐서 IDE 탭바와 어긋났다).

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
  // IDE 탭바와 같은 규약 — 확인한 세션은 조용한 색으로 내려간다.
  const acknowledged = useGraphStore((s) => s.acknowledgedSubAgents);
  // 백단 작업을 가진 세션은 IDE 탭바와 같이 도트가 켜진다(부모 id 는 목록의 sub 에서 얻는다).
  const parentAgentId = subAgents[0]?.parentAgentId;
  const busySubKey = useGraphStore((s) => serializeBusySubIds(parentAgentId ? s.runningSubagentTasks[parentAgentId] : undefined));
  const busySubIds = useMemo(() => parseBusySubIds(busySubKey), [busySubKey]);
  if (subAgents.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-gray-500">
        {t('panel.subAgent.heading', { count: subAgents.length })}
      </span>
      <ScrollFade maxHeight={256}><ul className="flex flex-col gap-1.5">
        {subAgents.map((sub) => {
          const runState = sessionRunStateOf(sub, !!acknowledged[sub.id], busySubIds.has(sub.id));
          return (
            <li
              key={sub.id}
              className="flex items-center gap-2 rounded border border-gray-700/50 bg-gray-800/60 px-2.5 py-1.5"
            >
              <span className={`h-2 w-2 flex-shrink-0 rounded-full ${SESSION_STATUS_DOT[runState]}`} />
              <div className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-gray-200">
                  {sub.label}
                </span>
                {sub.lastCommand && (
                  <span className="block truncate text-[12px] text-gray-500">
                    {sub.lastCommand}
                  </span>
                )}
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className={`text-[12px] ${runState === 'error' ? 'text-red-400' : 'text-gray-500'}`}>
                  {t(SESSION_STATUS_LABEL_KEY[runState])}
                </span>
                {/* §2.4 (잠듦) — 이 세션의 자식 프로세스는 회수됐다. 다음 명령이 --resume 으로 되살린다. */}
                {sub.dormant && (
                  <span className="text-[12px] text-gray-500">
                    {t('common.bubble.dormant')}
                  </span>
                )}
                {(sub.totalInputTokens ?? 0) > 0 && (
                  <span className="text-[12px] text-violet-400/70">
                    {t('panel.subAgent.tokensInOut', { in: formatTokenShort(sub.totalInputTokens ?? 0), out: formatTokenShort(sub.totalOutputTokens ?? 0) })}
                  </span>
                )}
                <span className="text-[12px] text-gray-600">
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
