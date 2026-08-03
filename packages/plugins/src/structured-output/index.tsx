/**
 * §5.11 v3.93 — 구조화 출력(Structured Output): 보고가 자유 서술인가 스키마인가.
 *
 * 에이전트 출력이 다음 단계의 입력이 되는 순간 파싱 실패는 곧 파이프라인 중단이다. Vibisual 은
 * 작업 신고·질문·검수·목록을 구조화된 형식으로 받으므로, 여기서는 이 에이전트가 그 통로를
 * 실제로 쓰고 있는지를 센다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

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
