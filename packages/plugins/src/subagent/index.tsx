/**
 * §5.11 v3.93 — 서브에이전트(Subagent): 컨텍스트 격리가 실제로 일어나고 있는가.
 *
 * 서브에이전트의 핵심은 성능이 아니라 **컨텍스트 격리**다 — 탐색 메모·헛발질·장황한 도구 출력이
 * 본 작업과 주의를 다투지 않게 한다. 대신 인계 품질이라는 새 병목이 생긴다. 표시 전용.
 */
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
