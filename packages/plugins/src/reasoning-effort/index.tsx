/**
 * §5.11 v3.93 — 사고 강도(Reasoning Effort)와 과잉 사고(Overthinking).
 *
 * "더 오래 생각하면 좋아진다"에는 실측된 반례가 있다 — 수확 체감을 넘어 **수확 역전** 구간이 있어,
 * 단순·조회형 작업에서는 강도를 올릴수록 비용도 늘고 품질도 떨어질 수 있다. 그래서 강도를 그냥
 * 보여주는 대신 **작업 크기와 함께** 보여주고, 짧은 작업에 최대 사고가 켜져 있으면 알린다. 표시 전용.
 */
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
    icon: ICONS.brain,
  },
});

export const reasoningEffortManifest = inspector.manifest;
export const reasoningEffortClient = inspector.client;
