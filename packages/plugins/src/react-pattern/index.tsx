/**
 * §5.11 v3.93 — ReAct: 생각과 도구 호출을 번갈아 하는 기본형이 잘 돌고 있는가.
 *
 * ReAct 는 선택지가 아니라 기본값이고, 나머지 패턴은 이것으로 부족할 때 얹는 것이다. 부족하다는 신호는
 * 정해져 있다 — 같은 자리를 맴돌거나, 목표를 잊고 지엽으로 빠지거나, 검증 없이 다음으로 넘어갈 때.
 * 여기서는 그중 관측 가능한 것(계획 없이 길어지는 진행)을 본다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

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
