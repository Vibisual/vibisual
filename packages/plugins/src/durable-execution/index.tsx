/**
 * §5.11 v3.98 — 지속 실행(Durable Execution): 중간에 끊겨도 이어지는가.
 *
 * 장기 작업의 실패는 능력 부족보다 **중간 크래시**에서 온다. 상태를 주기적으로 저장해 두면 처음부터 다시
 * 하지 않아도 된다. Vibisual 은 체크포인트로 이 층을 코어에서 보장하므로, 이 카드는 그 보장이 이 에이전트에
 * 어떻게 적용되는지를 보여준다. 표시 전용.
 */
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
