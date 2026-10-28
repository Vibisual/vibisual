/** §5.11 — 재순위화(Reranking): §5.10 총량 예산(`AUTO_GOAL_SKILL_BUDGET`)이 "이만큼만 위에 둔다"다 — 넘은 적재는 색인이 프롬프트를 잠식한다는 뜻. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import { AUTO_GOAL_SKILL_BUDGET } from '@vibisual/shared';
import type { PluginBubbleContext } from '../sdk/index.js';

const carried = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).carried;

const inspector = defineInspector({
  id: 'reranking', i18nKey: 'reranking', name: 'Reranking', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (carried(ctx) === 0 ? { key: 'none', tone: 'neutral' } : carried(ctx) <= AUTO_GOAL_SKILL_BUDGET ? { key: 'tight', tone: 'good' } : { key: 'loose', tone: 'warn' }),
  checks: [
    { key: 'perEvent', value: (ctx) => (carried(ctx) > 0 ? String(carried(ctx)) : '—') },
    { key: 'topK', value: () => String(AUTO_GOAL_SKILL_BUDGET) },
  ],
  noteKey: () => '.note',
});

export const rerankingManifest = inspector.manifest;
export const rerankingClient = inspector.client;
