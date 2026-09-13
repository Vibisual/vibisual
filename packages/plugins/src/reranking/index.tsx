/**
 * §5.11 v4.00 — 재순위화(Reranking): 가져온 것 중 무엇을 위에 두는가.
 *
 * 1차 검색은 넓게 건지고, 재순위화가 그중 실제로 관련 있는 것을 위로 올린다. §5.10 의
 * 자동 목표는 **총량에 예산을 걸어**(`AUTO_GOAL_SKILL_BUDGET`) 그 위를 넘으면 더 짓지 않는다 —
 * 그 상한이 곧 "이만큼만 위에 둔다"의 결과다. 상한을 넘어선 적재는 색인이 프롬프트를 잠식한다는 뜻이다.
 * 표시 전용.
 */
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
