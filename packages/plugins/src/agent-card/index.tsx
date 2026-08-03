/**
 * §5.11 v3.99 — 에이전트 카드(Agent Card): 이 에이전트의 능력 명세.
 *
 * 자기 능력·입출력·인증 방식을 기계가 읽을 수 있게 공개하는 명세다. 다만 **비용·지연·실패 모드까지 적어야**
 * 실제로 자동 선택이 가능해진다. 이 카드는 지금 이 에이전트가 그 명세로서 얼마나 채워져 있는지 보여준다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import { effectiveTools } from '../lethal-trifecta/trifecta.js';
import type { PluginBubbleContext } from '../types.js';

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
