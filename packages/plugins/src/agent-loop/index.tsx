/** §5.11 — 에이전트 루프(Agent Loop): 회차의 리듬(턴 수·평균 간격)과 반복 상한 유무를 본다(루프에선 종료 조건·상한·중지 수단이 안전장치). 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { formatElapsed } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

function span(ctx: PluginBubbleContext): { turns: number; avgMs: number } {
  const list = ctx.data.agentEvents ?? [];
  if (list.length < 2) return { turns: list.length, avgMs: 0 };
  const first = list[0]?.timestamp ?? 0;
  const last = list[list.length - 1]?.timestamp ?? 0;
  return { turns: list.length, avgMs: Math.max(0, (last - first) / (list.length - 1)) };
}

const inspector = defineInspector({
  id: 'agent-loop', i18nKey: 'agentLoop', name: 'Agent Loop', category: 'observability',
  needs: ['agentEvents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const capped = (ctx.agentConfig?.maxTurns ?? 0) > 0;
    if (span(ctx).turns === 0) return { key: 'idle', tone: 'neutral' };
    return capped ? { key: 'capped', tone: 'good' } : { key: 'uncapped', tone: 'warn' };
  },
  checks: [
    { key: 'turns', value: (ctx) => String(span(ctx).turns) },
    { key: 'avg', value: (ctx) => (span(ctx).avgMs > 0 ? formatElapsed(span(ctx).avgMs) : '—') },
    {
      key: 'cap',
      value: (ctx) => ((ctx.agentConfig?.maxTurns ?? 0) > 0 ? String(ctx.agentConfig?.maxTurns) : ctx.t('panel.plugins.agentLoop.none')),
      tone: (ctx) => ((ctx.agentConfig?.maxTurns ?? 0) > 0 ? 'good' : 'warn'),
    },
  ],
  noteKey: (ctx) => ((ctx.agentConfig?.maxTurns ?? 0) > 0 ? '.note' : '.noteUncapped'),
});

export const agentLoopManifest = inspector.manifest;
export const agentLoopClient = inspector.client;
