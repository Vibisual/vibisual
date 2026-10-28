/** §5.11 — 오케스트레이터(Orchestrator / Supervisor): 감독자는 판단만, 도구 실행은 하위에 — 위임 비중을 본다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

function delegated(ctx: PluginBubbleContext): number {
  return (ctx.data.subAgents ?? []).length;
}

function turns(ctx: PluginBubbleContext): number {
  return (ctx.data.agentEvents ?? []).length;
}

const inspector = defineInspector({
  id: 'orchestrator', i18nKey: 'orchestrator', name: 'Orchestrator', category: 'workflow',
  needs: ['subAgents', 'agentEvents', 'runningTasks'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (delegated(ctx) === 0) return { key: 'worker', tone: 'neutral' };
    if (delegated(ctx) >= 3) return { key: 'supervisor', tone: 'good' };
    return { key: 'mixed', tone: 'neutral' };
  },
  checks: [
    { key: 'delegated', value: (ctx) => String(delegated(ctx)) },
    { key: 'turns', value: (ctx) => String(turns(ctx)) },
    { key: 'running', value: (ctx) => String((ctx.data.runningTasks ?? []).length) },
  ],
  noteKey: () => '.note',
});

export const orchestratorManifest = inspector.manifest;
export const orchestratorClient = inspector.client;
