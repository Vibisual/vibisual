/**
 * §5.11 — 에이전틱 검색(Agentic RAG): 밀어 넣은 것인가, 스스로 찾은 것인가. 표시 전용.
 * §5.10 이후 절차의 출처로 읽는다 — 에이전트가 친 명령을 훑어 찾은 것이 능동, 사용자가 무대에 꽂은 단계가 밀어넣기.
 */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const searched = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).fromCommand;
const pushed = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).fromStep;

const inspector = defineInspector({
  id: 'agentic-rag', i18nKey: 'agenticRag', name: 'Agentic RAG', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (searched(ctx) + pushed(ctx) === 0) return { key: 'none', tone: 'neutral' };
    return searched(ctx) > 0 ? { key: 'agentic', tone: 'good' } : { key: 'static', tone: 'neutral' };
  },
  checks: [
    { key: 'searched', value: (ctx) => String(searched(ctx)), tone: (ctx) => (searched(ctx) > 0 ? 'good' : 'neutral') },
    { key: 'pushed', value: (ctx) => String(pushed(ctx)) },
  ],
  noteKey: () => '.note',
});

export const agenticRagManifest = inspector.manifest;
export const agenticRagClient = inspector.client;
