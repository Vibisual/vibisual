/**
 * §5.11 v3.93 — 범위 확장·축소(Scope Creep and Shrink).
 *
 * AI 협업에서는 **반대 방향도 똑같이 문제**다 — 모델이 "일단 핵심만"으로 조용히 줄이면 사용자는 전부
 * 됐다고 믿고 넘어가므로 발견이 늦다. 범위 조정은 지시하는 쪽의 결정권이지 모델의 재량이 아니다.
 * 여기서는 할일 목록이 도중에 늘었는지 줄었는지를 본다. 표시 전용.
 */
import { defineInspector, ICONS } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

/** 이벤트에 기록된 할일 총수의 처음/최대/마지막. */
function trend(ctx: PluginBubbleContext): { first: number; peak: number; last: number } {
  let first = 0;
  let peak = 0;
  let last = 0;
  for (const e of ctx.data.agentEvents ?? []) {
    const n = (e.todos ?? []).length;
    if (n === 0) continue;
    if (first === 0) first = n;
    if (n > peak) peak = n;
    last = n;
  }
  return { first, peak, last };
}

const inspector = defineInspector({
  id: 'scope-creep', i18nKey: 'scopeCreep', name: 'Scope Creep', category: 'workflow',
  needs: ['agentEvents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const { first, peak, last } = trend(ctx);
    if (first === 0) return { key: 'unknown', tone: 'neutral' };
    if (last < peak) return { key: 'shrank', tone: 'warn' };
    if (peak > first * 1.5) return { key: 'grew', tone: 'warn' };
    return { key: 'stable', tone: 'good' };
  },
  checks: [
    { key: 'first', value: (ctx) => (trend(ctx).first > 0 ? String(trend(ctx).first) : '—') },
    { key: 'peak', value: (ctx) => (trend(ctx).peak > 0 ? String(trend(ctx).peak) : '—') },
    { key: 'last', value: (ctx) => (trend(ctx).last > 0 ? String(trend(ctx).last) : '—') },
  ],
  noteKey: (ctx) => {
    const { first, peak, last } = trend(ctx);
    if (first > 0 && last < peak) return '.noteShrank';
    if (first > 0 && peak > first * 1.5) return '.noteGrew';
    return '.note';
  },
  badge: {
    match: (ctx) => {
      const { first, peak, last } = trend(ctx);
      return first > 0 && (last < peak || peak > first * 1.5);
    },
    text: () => '',
    icon: ICONS.log,
  },
});

export const scopeCreepManifest = inspector.manifest;
export const scopeCreepClient = inspector.client;
