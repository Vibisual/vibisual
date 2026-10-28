/** §5.11 — 지속 실행(Durable Execution): 코어의 체크포인트 보장이 이 에이전트에 어떻게 적용되는지 보여준다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const sessions = (ctx: PluginBubbleContext): number => (ctx.data.subAgents ?? []).length;
const turns = (ctx: PluginBubbleContext): number => (ctx.data.agentEvents ?? []).length;

const inspector = defineInspector({
  id: 'durable-execution', i18nKey: 'durableExecution', name: 'Durable Execution', category: 'observability',
  needs: ['subAgents', 'agentEvents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (turns(ctx) === 0 ? { key: 'fresh', tone: 'neutral' } : { key: 'checkpointed', tone: 'good' }),
  checks: [
    { key: 'turns', value: (ctx) => String(turns(ctx)) },
    { key: 'sessions', value: (ctx) => String(sessions(ctx)) },
    { key: 'guarantee', value: (ctx) => ctx.t('panel.plugins.durableExecution.core'), tone: () => 'good' },
  ],
  noteKey: () => '.note',
});

export const durableExecutionManifest = inspector.manifest;
export const durableExecutionClient = inspector.client;
