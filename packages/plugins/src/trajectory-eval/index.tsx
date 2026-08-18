/**
 * §5.11 v3.97 — 궤적 평가(Trajectory Eval): 최종 답이 아니라 **어떻게 도달했는지**를 본다.
 *
 * 같은 답을 내도 도구를 3번 부른 경우와 40번 부른 경우는 전혀 다른 시스템이다. 결과만 보는 평가는 그 차이를
 * 못 보고, 에이전트에서는 결과 정확도보다 이쪽이 더 예측력 있는 지표인 경우가 많다. 표시 전용.
 */
import { defineInspector, ICONS } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const turns = (ctx: PluginBubbleContext): number => (ctx.data.agentEvents ?? []).length;
const sessions = (ctx: PluginBubbleContext): number => (ctx.data.subAgents ?? []).length;
const edges = (ctx: PluginBubbleContext): number => (ctx.data.taskEdges ?? []).length;
/** 한 세션이 감당한 턴 수 — 궤적이 길어질수록 낭비한 단계가 섞일 여지가 커진다. */
const density = (ctx: PluginBubbleContext): number => (sessions(ctx) > 0 ? turns(ctx) / sessions(ctx) : turns(ctx));

const inspector = defineInspector({
  id: 'trajectory-eval', i18nKey: 'trajectoryEval', name: 'Trajectory Eval', category: 'observability',
  needs: ['agentEvents', 'subAgents', 'taskEdges'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (turns(ctx) === 0) return { key: 'none', tone: 'neutral' };
    if (density(ctx) >= 25) return { key: 'long', tone: 'warn' };
    return { key: 'short', tone: 'good' };
  },
  checks: [
    { key: 'turns', value: (ctx) => String(turns(ctx)) },
    { key: 'sessions', value: (ctx) => String(sessions(ctx)) },
    { key: 'density', value: (ctx) => (turns(ctx) > 0 ? density(ctx).toFixed(1) : '—'), tone: (ctx) => (density(ctx) >= 25 ? 'warn' : 'neutral') },
    { key: 'edges', value: (ctx) => String(edges(ctx)) },
  ],
  noteKey: () => '.note',
  badge: { match: (ctx) => density(ctx) >= 25, text: (ctx) => String(Math.round(density(ctx))), icon: ICONS.route },
});

export const trajectoryEvalManifest = inspector.manifest;
export const trajectoryEvalClient = inspector.client;
