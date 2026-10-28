/** §5.11 — 에이전트 카드(Agent Card): 능력 명세가 얼마나 채워졌나(비용·지연·실패 모드까지 있어야 자동 선택이 된다). 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

function filled(ctx: PluginBubbleContext): number {
  return [
    Boolean(ctx.agentConfig?.model),
    effectiveTools(ctx.agentConfig).size > 0,
    (ctx.agentConfig?.rules ?? '').trim().length > 0,
    (ctx.agentConfig?.skills ?? []).length > 0,
    (ctx.agentConfig?.maxBudgetUsd ?? 0) > 0 || (ctx.agentConfig?.maxTurns ?? 0) > 0,
  ].filter(Boolean).length;
}

const inspector = defineInspector({
  id: 'agent-card', i18nKey: 'agentCard', name: 'Agent Card', category: 'observability',
  status: (ctx) => (filled(ctx) >= 4 ? { key: 'complete', tone: 'good' } : filled(ctx) >= 2 ? { key: 'partial', tone: 'neutral' } : { key: 'thin', tone: 'warn' }),
  checks: [
    { key: 'filled', value: (ctx) => `${filled(ctx)} / 5` },
    { key: 'purpose', value: (ctx) => ((ctx.agentConfig?.rules ?? '').trim().length > 0 ? ctx.t('panel.plugins.agentCard.stated') : ctx.t('panel.plugins.agentCard.unstated')) },
    { key: 'limits', value: (ctx) => ((ctx.agentConfig?.maxTurns ?? 0) > 0 || (ctx.agentConfig?.maxBudgetUsd ?? 0) > 0 ? ctx.t('panel.plugins.agentCard.set') : ctx.t('panel.plugins.agentCard.unset')) },
  ],
  noteKey: () => '.note',
});

export const agentCardManifest = inspector.manifest;
export const agentCardClient = inspector.client;
