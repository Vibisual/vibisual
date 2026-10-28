/** §5.11 — 결정 기록(ADR): 기각한 것이 남아 있는가(없으면 버린 설계를 다시 제안한다). 여기서는 굳어진 절차(§5.10)와 작업 신고의 교훈이 그 자리다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal, toneIfActive } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const decided = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).skills;
const lessons = (ctx: PluginBubbleContext): number =>
  (ctx.data.agentReports ?? []).reduce((n, r) => n + (r.learned ?? []).length, 0);

const inspector = defineInspector({
  id: 'adr-presence', i18nKey: 'adrPresence', name: 'Decision Records', category: 'observability',
  needs: ['autoGoal', 'agentReports', 'agentEvents', 'subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (decided(ctx) + lessons(ctx) === 0 ? { key: 'none', tone: toneIfActive(ctx) } : { key: 'recorded', tone: 'good' }),
  checks: [
    { key: 'decided', value: (ctx) => String(decided(ctx)), tone: (ctx) => (decided(ctx) > 0 ? 'good' : 'warn') },
    { key: 'lessons', value: (ctx) => String(lessons(ctx)) },
  ],
  noteKey: () => '.note',
});

export const adrPresenceManifest = inspector.manifest;
export const adrPresenceClient = inspector.client;
