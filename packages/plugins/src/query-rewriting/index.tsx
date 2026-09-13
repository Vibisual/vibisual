/**
 * §5.11 v4.00 — 질의 재작성(Query Rewriting): 본 것을 그대로 저장하지 않는다.
 *
 * 사람이 쓴 문장과 저장된 지식의 표현은 다르므로, 다듬어야 걸린다. §5.10 에서 그 다듬기는
 * **채굴** 쪽에서 일어난다 — 에이전트가 친 명령 묶음을 그대로 쌓는 것이 아니라, 안정 키로 접어
 * "같은 절차"를 알아보고 이름을 뽑아낸다. 그 재작성이 실제로 걸렸는지는 **절차가 굳었는가**로 드러난다.
 * 훑기만 하고 하나도 안 굳었다면 접는 방식이 이 프로젝트의 일과 안 맞는다는 신호다. 표시 전용.
 */
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
