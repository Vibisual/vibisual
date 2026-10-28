/** §5.11 — 질의 재작성(Query Rewriting): §5.10 채굴이 명령 묶음을 안정 키로 접는다 — 걸렸는지는 절차가 굳었는가로 드러난다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const searches = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).fromCommand;
const hits = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).skills;

const inspector = defineInspector({
  id: 'query-rewriting', i18nKey: 'queryRewriting', name: 'Query Rewriting', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (searches(ctx) === 0 ? { key: 'none', tone: 'neutral' } : hits(ctx) > 0 ? { key: 'effective', tone: 'good' } : { key: 'empty', tone: 'warn' }),
  checks: [
    { key: 'searches', value: (ctx) => String(searches(ctx)) },
    { key: 'hits', value: (ctx) => String(hits(ctx)), tone: (ctx) => (hits(ctx) > 0 ? 'good' : 'warn') },
  ],
  noteKey: () => '.note',
});

export const queryRewritingManifest = inspector.manifest;
export const queryRewritingClient = inspector.client;
