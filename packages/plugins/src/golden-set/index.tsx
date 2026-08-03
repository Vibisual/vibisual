/**
 * §5.11 v3.97 — 골든 셋(Golden Set): 실패했던 사례가 기준 데이터로 적립되는가.
 *
 * 크기보다 **대표성**이 중요하고, 특히 실제로 실패했던 사례가 들어 있어야 한다. 잘 되는 경우만 모은
 * 골든 셋은 항상 만점을 준다. 운영 중 발견된 실패를 즉시 적립하는 습관이 가장 값싼 품질 인프라다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import { toneIfActive } from '../framework/activity.js';
import type { PluginBubbleContext } from '../types.js';

const lessons = (ctx: PluginBubbleContext): number =>
  (ctx.data.agentReports ?? []).reduce((n, r) => n + (r.learned ?? []).length, 0);
const cards = (ctx: PluginBubbleContext): number => ctx.data.brain?.cardCount ?? 0;

const inspector = defineInspector({
  id: 'golden-set', i18nKey: 'goldenSet', name: 'Golden Set', category: 'observability',
  needs: ['agentReports', 'brain', 'agentEvents', 'subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (lessons(ctx) === 0 && cards(ctx) === 0) return { key: 'empty', tone: toneIfActive(ctx) };
    return lessons(ctx) > 0 ? { key: 'accruing', tone: 'good' } : { key: 'partial', tone: 'neutral' };
  },
  checks: [
    { key: 'lessons', value: (ctx) => String(lessons(ctx)), tone: (ctx) => (lessons(ctx) > 0 ? 'good' : 'warn') },
    { key: 'cards', value: (ctx) => String(cards(ctx)) },
  ],
  noteKey: () => '.note',
});

export const goldenSetManifest = inspector.manifest;
export const goldenSetClient = inspector.client;
