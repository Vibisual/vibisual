/**
 * §5.11 v3.93 — 지시 표류(Instruction Drift): 초반 지시가 아직 유효한가.
 *
 * 긴 세션에서는 새 내용이 쌓일수록 앞쪽 규칙의 영향력이 옅어지고, 컴팩션이 돌면 초기 지시가 요약되며
 * 더 빨리 희석된다. "한 번 말했으니 계속 지켜지겠지"는 성립하지 않는다. 이 에이전트가 상시 규칙을
 * 갖고 있는지와, 세션이 얼마나 길어졌는지를 나란히 본다. 표시 전용.
 */
import { defineInspector, ICONS } from '../framework/inspector.js';
import { defineDriftLevel } from './drift.js';
import type { PluginBubbleContext } from '../types.js';

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
  badge: { match: (ctx) => turns(ctx) >= 25, text: () => '', icon: ICONS.brain },
});

export const instructionDriftManifest = inspector.manifest;
export const instructionDriftClient = inspector.client;
