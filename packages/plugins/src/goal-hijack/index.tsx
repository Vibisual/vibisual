/**
 * §5.11 v3.99 — 목표 탈취(Goal Hijack): 목표가 변경 불가능한 자리에 있는가.
 *
 * 단발 응답 조작과 달리 목표가 바뀌면 이후 모든 단계가 자율적으로 공격자를 돕고, 행동이 겉보기에 일관되므로
 * 사람이 알아채기 어렵다. 방어는 목표를 **고정된 자리**에 두고(사용자 지시와 도구 결과를 같은 층에 두지 않기),
 * 궤적으로 이탈을 탐지하는 것이다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const pinned = (ctx: PluginBubbleContext): boolean => (ctx.agentConfig?.rules ?? '').trim().length > 0;
const hasPlan = (ctx: PluginBubbleContext): boolean => (ctx.data.agentEvents ?? []).some((e) => (e.todos ?? []).length > 0);

const inspector = defineInspector({
  id: 'goal-hijack', i18nKey: 'goalHijack', name: 'Goal Hijack', category: 'security',
  needs: ['agentEvents'],
  status: (ctx) => {
    if (pinned(ctx) && hasPlan(ctx)) return { key: 'anchored', tone: 'good' };
    return pinned(ctx) || hasPlan(ctx) ? { key: 'partial', tone: 'neutral' } : { key: 'loose', tone: 'warn' };
  },
  checks: [
    {
      key: 'rules',
      value: (ctx) => ctx.t(`panel.plugins.goalHijack.${pinned(ctx) ? 'yes' : 'no'}`),
      tone: (ctx) => (pinned(ctx) ? 'good' : 'warn'),
    },
    {
      key: 'plan',
      value: (ctx) => ctx.t(`panel.plugins.goalHijack.${hasPlan(ctx) ? 'yes' : 'no'}`),
      tone: (ctx) => (hasPlan(ctx) ? 'good' : 'neutral'),
    },
  ],
  noteKey: () => '.note',
});

export const goalHijackManifest = inspector.manifest;
export const goalHijackClient = inspector.client;
