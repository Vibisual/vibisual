/** §5.11 — 골든 셋(Golden Set): 실패 사례가 기준 데이터로 적립되는가 — 여기서는 작업 신고의 교훈과 굳어진 절차(§5.10) 두 갈래. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal, toneIfActive } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const lessons = (ctx: PluginBubbleContext): number =>
  (ctx.data.agentReports ?? []).reduce((n, r) => n + (r.learned ?? []).length, 0);
const procedures = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).skills;

const inspector = defineInspector({
  id: 'golden-set', i18nKey: 'goldenSet', name: 'Golden Set', category: 'observability',
  needs: ['agentReports', 'autoGoal', 'agentEvents', 'subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (lessons(ctx) === 0 && procedures(ctx) === 0) return { key: 'empty', tone: toneIfActive(ctx) };
    return lessons(ctx) > 0 ? { key: 'accruing', tone: 'good' } : { key: 'partial', tone: 'neutral' };
  },
  checks: [
    { key: 'lessons', value: (ctx) => String(lessons(ctx)), tone: (ctx) => (lessons(ctx) > 0 ? 'good' : 'warn') },
    { key: 'cards', value: (ctx) => String(procedures(ctx)) },
  ],
  noteKey: () => '.note',
});

export const goldenSetManifest = inspector.manifest;
export const goldenSetClient = inspector.client;
