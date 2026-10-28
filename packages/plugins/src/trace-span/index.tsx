/** §5.11 — 트레이스·스팬(Trace / Span): 한 요청의 경로가 재구성되는가(스팬에 비용·토큰을 싣는다). 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const spans = (ctx: PluginBubbleContext): number =>
  (ctx.data.agentEvents ?? []).length + (ctx.data.subAgents ?? []).length + (ctx.data.taskEdges ?? []).length;
const tokened = (ctx: PluginBubbleContext): number =>
  (ctx.data.subAgents ?? []).filter((s) => (s.totalInputTokens ?? 0) > 0 || (s.totalOutputTokens ?? 0) > 0).length;

const inspector = defineInspector({
  id: 'trace-span', i18nKey: 'traceSpan', name: 'Trace and Span', category: 'observability',
  needs: ['agentEvents', 'subAgents', 'taskEdges'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (spans(ctx) === 0) return { key: 'empty', tone: 'neutral' };
    return tokened(ctx) > 0 ? { key: 'costed', tone: 'good' } : { key: 'shapeOnly', tone: 'neutral' };
  },
  checks: [
    { key: 'spans', value: (ctx) => String(spans(ctx)) },
    { key: 'sessions', value: (ctx) => String((ctx.data.subAgents ?? []).length) },
    { key: 'costed', value: (ctx) => String(tokened(ctx)), tone: (ctx) => (tokened(ctx) > 0 ? 'good' : 'neutral') },
  ],
  noteKey: () => '.note',
});

export const traceSpanManifest = inspector.manifest;
export const traceSpanClient = inspector.client;
