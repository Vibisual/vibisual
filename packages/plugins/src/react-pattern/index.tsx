/** §5.11 — ReAct: 기본형이 잘 도는가 — 관측 가능한 실패 신호(계획 없이 길어지는 진행)를 본다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

function turns(ctx: PluginBubbleContext): number {
  return (ctx.data.agentEvents ?? []).length;
}

function hasPlan(ctx: PluginBubbleContext): boolean {
  return (ctx.data.agentEvents ?? []).some((e) => (e.todos ?? []).length > 0);
}

const inspector = defineInspector({
  id: 'react-pattern', i18nKey: 'reactPattern', name: 'ReAct', category: 'workflow',
  needs: ['agentEvents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (turns(ctx) === 0) return { key: 'idle', tone: 'neutral' };
    if (!hasPlan(ctx) && turns(ctx) >= 15) return { key: 'drifting', tone: 'warn' };
    return { key: 'healthy', tone: 'good' };
  },
  checks: [
    { key: 'turns', value: (ctx) => String(turns(ctx)) },
    {
      key: 'plan',
      value: (ctx) => ctx.t(`panel.plugins.reactPattern.${hasPlan(ctx) ? 'yes' : 'no'}`),
      tone: (ctx) => (hasPlan(ctx) ? 'good' : 'neutral'),
    },
  ],
  noteKey: (ctx) => (!hasPlan(ctx) && turns(ctx) >= 15 ? '.noteDrifting' : '.note'),
});

export const reactPatternManifest = inspector.manifest;
export const reactPatternClient = inspector.client;
