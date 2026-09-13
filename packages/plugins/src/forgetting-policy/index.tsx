/**
 * §5.11 v3.95 — 망각 정책(Forgetting Policy): 무엇을 언제 버릴지가 정해져 있는가.
 *
 * 기억 시스템의 고질병 1번은 "쓸모없는 것이 줄지 않는다"이다. 무한히 쌓이면 검색 정밀도가 떨어져
 * 결국 없느니만 못해진다. 안전한 형태는 총량 예산 + **삭제가 아니라 보관**이다.
 *
 * §5.10 의 자동 목표가 그 규약을 그대로 지킨다 — 예산(`AUTO_GOAL_SKILL_BUDGET`)을 넘으면
 * 더 짓지 않을 뿐 있던 것을 지우지 않고, 사용자가 물린 후보는 **덮일 뿐 사라지지 않는다.**
 * 그래서 여기서는 예산 대비 적재량과 물려 둔 수를 함께 본다. 표시 전용.
 */
import { AUTO_GOAL_SKILL_BUDGET } from '@vibisual/shared';
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const used = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).stored;
const ratio = (ctx: PluginBubbleContext): number => (AUTO_GOAL_SKILL_BUDGET > 0 ? used(ctx) / AUTO_GOAL_SKILL_BUDGET : 0);

const inspector = defineInspector({
  id: 'forgetting-policy', i18nKey: 'forgettingPolicy', name: 'Forgetting Policy', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (!readAutoGoal(ctx).present) return { key: 'none', tone: 'neutral' };
    if (ratio(ctx) >= 0.9) return { key: 'full', tone: 'warn' };
    return { key: 'room', tone: 'good' };
  },
  checks: [
    { key: 'used', value: (ctx) => `${used(ctx)} / ${AUTO_GOAL_SKILL_BUDGET}` },
    { key: 'share', value: (ctx) => `${Math.round(ratio(ctx) * 100)}%`, tone: (ctx) => (ratio(ctx) >= 0.9 ? 'warn' : 'good') },
    { key: 'archived', value: (ctx) => String(readAutoGoal(ctx).dismissed), tone: () => 'good' },
  ],
  noteKey: () => '.note',
});

export const forgettingPolicyManifest = inspector.manifest;
export const forgettingPolicyClient = inspector.client;
