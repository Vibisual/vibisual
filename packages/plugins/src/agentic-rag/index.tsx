/**
 * §5.11 v3.98 — 에이전틱 검색(Agentic RAG): 밀어 넣은 것인가, 스스로 찾은 것인가.
 *
 * 고정된 파이프라인이 한 번 검색해 주는 대신, 에이전트가 필요할 때 스스로 질의를 만들어 찾아 오는 형태다.
 * 밀어넣기만 있으면 필요 없는 것도 매번 실리고, 능동 검색이 있으면 필요한 순간에만 들어온다.
 *
 * §5.10 이후 이 축은 **절차가 어디서 자랐나**로 읽는다: 에이전트가 스스로 친 명령을 훑어
 * 찾아낸 것이 능동이고, 사용자가 무대에 꽂아 둔 단계에서 온 것이 밀어넣기다. 표시 전용.
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
