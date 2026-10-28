/** §5.11 — 구조화 출력(Structured Output): 작업 신고·질문·검수·목록 같은 구조화 통로를 실제로 쓰는지 센다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

function reports(ctx: PluginBubbleContext): number {
  return (ctx.data.agentReports ?? []).length;
}

function reviews(ctx: PluginBubbleContext): number {
  return (ctx.data.agentReviews ?? []).length;
}

function userActions(ctx: PluginBubbleContext): number {
  return (ctx.data.agentReports ?? []).reduce((n, r) => n + (r.userActions ?? []).length, 0);
}

const inspector = defineInspector({
  id: 'structured-output', i18nKey: 'structuredOutput', name: 'Structured Output', category: 'observability',
  needs: ['agentReports', 'agentReviews'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const total = reports(ctx) + reviews(ctx);
    if (total === 0) return { key: 'prose', tone: 'neutral' };
    return { key: 'structured', tone: 'good' };
  },
  checks: [
    { key: 'reports', value: (ctx) => String(reports(ctx)) },
    { key: 'reviews', value: (ctx) => String(reviews(ctx)) },
    { key: 'userActions', value: (ctx) => String(userActions(ctx)) },
  ],
  noteKey: () => '.note',
});

export const structuredOutputManifest = inspector.manifest;
export const structuredOutputClient = inspector.client;
