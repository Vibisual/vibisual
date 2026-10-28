/** §5.11 — 사고 강도(Reasoning Effort)·과잉 사고: 단순 작업은 강도를 올릴수록 품질이 떨어지는 구간이 있어, 작업 크기와 함께 보이고 짧은 작업의 최대 사고를 알린다. 표시 전용. */
import { defineInspector, ICONS } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

/** 강도 이름은 공급자·버전마다 바뀌므로 하드코딩하지 않고 "높은 축인가"만 느슨하게 본다. */
const HIGH = ['high', 'xhigh', 'max'];

function effort(ctx: PluginBubbleContext): string {
  return ctx.agentConfig?.effort ?? 'default';
}

function turns(ctx: PluginBubbleContext): number {
  return (ctx.data.agentEvents ?? []).length;
}

function overthinking(ctx: PluginBubbleContext): boolean {
  return HIGH.includes(effort(ctx)) && turns(ctx) > 0 && turns(ctx) <= 3;
}

const inspector = defineInspector({
  id: 'reasoning-effort',
  i18nKey: 'reasoningEffort',
  name: 'Reasoning Effort',
  category: 'workflow',
  needs: ['agentEvents'],
  status: (ctx) => {
    if (overthinking(ctx)) return { key: 'overthinking', tone: 'warn' };
    return HIGH.includes(effort(ctx)) ? { key: 'deep', tone: 'neutral' } : { key: 'normal', tone: 'good' };
  },
  checks: [
    { key: 'effort', value: (ctx) => effort(ctx), tone: (ctx) => (HIGH.includes(effort(ctx)) ? 'warn' : 'neutral') },
    { key: 'turns', value: (ctx) => String(turns(ctx)) },
    { key: 'model', value: (ctx) => ctx.agentConfig?.model ?? '—' },
  ],
  noteKey: (ctx) => (overthinking(ctx) ? '.noteOverthinking' : '.noteMeasure'),
  badge: {
    match: (ctx) => overthinking(ctx),
    text: () => '',
    icon: ICONS.think,
  },
});

export const reasoningEffortManifest = inspector.manifest;
export const reasoningEffortClient = inspector.client;
