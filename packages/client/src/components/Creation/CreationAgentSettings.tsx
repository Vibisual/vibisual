import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUBBLE_COLORS } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

const AgentSettings = lazy(async () => ({ default: (await import('../Panel/AgentConfigPopup.js')).AgentConfigPopup }));

/** Reuse the engine's actual turn/budget/command-time limits, including its capability restrictions. */
export function CreationAgentSettings({ agentId }: { agentId: string }): React.JSX.Element | null {
  const { t } = useTranslation();
  const agent = useGraphStore(state => state.agents.find(item => item.id === agentId));
  const config = useGraphStore(state => state.agentConfigs[agentId] ?? null);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [agentId]);
  if (!agent) return null;
  return <>
    <button type="button" disabled={!agent.customCreated}
      title={!agent.customCreated ? t('panel.detailPanel.hookAgentSettingsLocked') : t('panel.detailPanel.agentSettings')}
      onClick={() => setOpen(true)} className="rounded border border-white/15 px-2 py-1 text-xs text-gray-300 enabled:hover:bg-white/10 disabled:opacity-40 pointer-coarse:py-2">
      {t('panel.detailPanel.agentSettings')}
    </button>
    {/* The bubble's own colour (as everywhere else this popup opens), not a fixed grey. */}
    {open && <Suspense fallback={null}><AgentSettings key={agentId} agentId={agentId} config={config}
      currentColor={config?.color ?? BUBBLE_COLORS[agent.bubbleType]} onClose={() => setOpen(false)} /></Suspense>}
  </>;
}
