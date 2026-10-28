/** §5.11 — 지시 표류(Instruction Drift): 긴 세션·컴팩션에서 앞쪽 규칙이 옅어진다 — 상시 규칙 유무와 세션 길이를 나란히 본다. 표시 전용. */
import { defineInspector, ICONS } from '../sdk/index.js';
import { defineDriftLevel } from './drift.js';
import type { PluginBubbleContext } from '../sdk/index.js';

function turns(ctx: PluginBubbleContext): number {
  return (ctx.data.agentEvents ?? []).length;
}

function hasRules(ctx: PluginBubbleContext): boolean {
  return (ctx.agentConfig?.rules ?? '').trim().length > 0;
}

const inspector = defineInspector({
  id: 'instruction-drift', i18nKey: 'instructionDrift', name: 'Instruction Drift', category: 'observability',
  needs: ['agentEvents'],
  status: (ctx) => defineDriftLevel(hasRules(ctx), turns(ctx)),
  checks: [
    {
      key: 'rules',
      value: (ctx) => ctx.t(`panel.plugins.instructionDrift.${hasRules(ctx) ? 'yes' : 'no'}`),
      tone: (ctx) => (hasRules(ctx) ? 'good' : 'neutral'),
    },
    { key: 'turns', value: (ctx) => String(turns(ctx)) },
    { key: 'skills', value: (ctx) => String((ctx.agentConfig?.skills ?? []).length) },
  ],
  noteKey: (ctx) => (turns(ctx) >= 25 ? '.noteLong' : '.note'),
  badge: { match: (ctx) => turns(ctx) >= 25, text: () => '', icon: ICONS.think },
});

export const instructionDriftManifest = inspector.manifest;
export const instructionDriftClient = inspector.client;
