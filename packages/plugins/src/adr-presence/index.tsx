/**
 * §5.11 v4.00 — 결정 기록(ADR): 무엇을 기각했는지가 남아 있는가.
 *
 * 기각 이유가 없으면 에이전트가 이미 버린 설계를 **선의로 다시 제안**한다. 결정 기록은 "하지 마라"를
 * 근거와 함께 남겨 두는 장치다. Vibisual 에서는 확정된 기억 슬롯과 작업 신고의 교훈이 그 자리를 맡는다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import { toneIfActive } from '../framework/activity.js';
import type { PluginBubbleContext } from '../types.js';

const decided = (ctx: PluginBubbleContext): number => ctx.data.brain?.currentCount ?? 0;
const lessons = (ctx: PluginBubbleContext): number =>
  (ctx.data.agentReports ?? []).reduce((n, r) => n + (r.learned ?? []).length, 0);

const inspector = defineInspector({
  id: 'adr-presence', i18nKey: 'adrPresence', name: 'Decision Records', category: 'observability',
  needs: ['brain', 'agentReports', 'agentEvents', 'subAgents'],
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
