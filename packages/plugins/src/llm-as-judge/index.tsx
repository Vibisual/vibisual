/**
 * §5.11 v3.97 — 심판 모델(LLM-as-Judge): 채점자가 따로 있는가.
 *
 * 자연어 출력은 정답 문자열이 없어 자동 채점이 어려워 심판 모델이 현실적 타협안이 됐다. 다만 알려진 편향이
 * 있다 — **긴 답을 선호하고, 자기 계열 출력을 후하게 보며, 제시 순서에 영향을 받는다.** 심판의 채점을
 * 사람 채점과 대조해 검증하는 절차가 없으면 심판 자체가 틀린지 알 수 없다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const critique = (ctx: PluginBubbleContext): number => (ctx.data.taskEdges ?? []).filter((e) => e.kind === 'critique').length;
const reviews = (ctx: PluginBubbleContext): number => (ctx.data.agentReviews ?? []).length;

const inspector = defineInspector({
  id: 'llm-as-judge', i18nKey: 'llmAsJudge', name: 'LLM as Judge', category: 'observability',
  needs: ['taskEdges', 'agentReviews'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (critique(ctx) === 0 && reviews(ctx) === 0) return { key: 'none', tone: 'neutral' };
    return critique(ctx) > 0 ? { key: 'model', tone: 'neutral' } : { key: 'human', tone: 'good' };
  },
  checks: [
    { key: 'critique', value: (ctx) => String(critique(ctx)) },
    { key: 'human', value: (ctx) => String(reviews(ctx)), tone: (ctx) => (reviews(ctx) > 0 ? 'good' : 'neutral') },
  ],
  noteKey: () => '.note',
});

export const llmAsJudgeManifest = inspector.manifest;
export const llmAsJudgeClient = inspector.client;
