/** §5.11 — 서브에이전트(Subagent): 컨텍스트 격리가 실제로 일어나는가(대신 인계 품질이 병목). 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

function sessions(ctx: PluginBubbleContext): number {
  return (ctx.data.subAgents ?? []).length;
}

function running(ctx: PluginBubbleContext): number {
  return (ctx.data.runningTasks ?? []).length;
}

const inspector = defineInspector({
  id: 'subagent', i18nKey: 'subagent', name: 'Subagent Isolation', category: 'observability',
  needs: ['subAgents', 'runningTasks'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (sessions(ctx) === 0) return { key: 'single', tone: 'neutral' };
    if (running(ctx) > 0) return { key: 'delegating', tone: 'good' };
    return { key: 'isolated', tone: 'good' };
  },
  checks: [
    { key: 'sessions', value: (ctx) => String(sessions(ctx)) },
    { key: 'running', value: (ctx) => String(running(ctx)), tone: (ctx) => (running(ctx) > 0 ? 'good' : 'neutral') },
    {
      key: 'kinds',
      value: (ctx) => {
        const kinds = new Set((ctx.data.runningTasks ?? []).map((t) => t.subagentType).filter(Boolean));
        return kinds.size > 0 ? [...kinds].join(' · ') : '—';
      },
    },
  ],
  noteKey: () => '.note',
});

export const subagentManifest = inspector.manifest;
export const subagentClient = inspector.client;
