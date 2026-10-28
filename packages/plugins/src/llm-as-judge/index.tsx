/** §5.11 — 심판 모델(LLM-as-Judge): 채점자가 따로 있는가 — 편향(긴 답·자기 계열·제시 순서)이 있어 사람 채점과 대조하는 절차가 없으면 심판이 틀린지 모른다. 표시 전용. */
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
