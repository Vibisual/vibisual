/**
 * §5.11 v3.96 — 리플렉션(Reflexion): 자기 비평이 실행 가능한 신호에 근거하는가.
 *
 * 시도 후 무엇이 잘못됐는지 스스로 비평하고 그 교훈을 다음 시도에 넣는 루프다. 핵심은 비평이
 * **실행 가능한 신호**(테스트 실패 등)에 근거해야 한다는 것 — 근거 없는 자기 반성은 그럴듯한 소음이다.
 * Vibisual 에서는 작업 신고의 "배운 것"이 그 자리를 맡으므로 여기서 그 적립을 센다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const reports = (ctx: PluginBubbleContext) => ctx.data.agentReports ?? [];
const learned = (ctx: PluginBubbleContext): number => reports(ctx).reduce((n, r) => n + (r.learned ?? []).length, 0);

const inspector = defineInspector({
  id: 'reflexion', i18nKey: 'reflexion', name: 'Reflexion', category: 'workflow',
  needs: ['agentReports'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (reports(ctx).length === 0) return { key: 'none', tone: 'neutral' };
    return learned(ctx) > 0 ? { key: 'accruing', tone: 'good' } : { key: 'noLessons', tone: 'neutral' };
  },
  checks: [
    { key: 'reports', value: (ctx) => String(reports(ctx).length) },
    { key: 'learned', value: (ctx) => String(learned(ctx)), tone: (ctx) => (learned(ctx) > 0 ? 'good' : 'neutral') },
  ],
  noteKey: () => '.note',
});

export const reflexionManifest = inspector.manifest;
export const reflexionClient = inspector.client;
