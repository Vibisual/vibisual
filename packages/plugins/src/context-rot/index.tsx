/**
 * §5.11 v3.93 — 컨텍스트 부패(Context Rot): 창을 얼마나 채웠는가.
 *
 * 창 크기는 상한이지 목표가 아니다. 성능은 절반 근처에서 이미 눈에 띄게 떨어지는 경우가 많고,
 * 길이보다 **비슷한 방해 정보의 혼입**이 더 큰 요인이다. 그래서 "몇 토큰 남았나"가 아니라
 * **채움 비율**을 보여준다. 표시 전용.
 */
import type { SubAgent } from '@vibisual/shared';
import { defineInspector, ICONS } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

/** 세션 여럿이면 가장 많이 찬 것이 병목이다. */
function worstSession(subAgents: readonly SubAgent[] | undefined): { used: number; max: number; ratio: number } {
  let best = { used: 0, max: 0, ratio: 0 };
  for (const s of subAgents ?? []) {
    const used = s.contextUsed ?? 0;
    const max = s.contextMax ?? 0;
    if (max <= 0) continue;
    const ratio = used / max;
    if (ratio > best.ratio) best = { used, max, ratio };
  }
  return best;
}

function stats(ctx: PluginBubbleContext): { used: number; max: number; ratio: number } {
  return worstSession(ctx.data.subAgents);
}

const pct = (r: number): string => `${Math.round(r * 100)}%`;

const inspector = defineInspector({
  id: 'context-rot',
  i18nKey: 'contextRot',
  name: 'Context Rot',
  category: 'observability',
  needs: ['subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const { ratio, max } = stats(ctx);
    if (max === 0) return { key: 'unknown', tone: 'neutral' };
    if (ratio >= 0.75) return { key: 'high', tone: 'bad' };
    if (ratio >= 0.5) return { key: 'half', tone: 'warn' };
    return { key: 'low', tone: 'good' };
  },
  checks: [
    {
      key: 'fill',
      value: (ctx) => (stats(ctx).max > 0 ? pct(stats(ctx).ratio) : '—'),
      tone: (ctx) => (stats(ctx).ratio >= 0.5 ? 'warn' : 'good'),
    },
    {
      key: 'tokens',
      value: (ctx) => {
        const { used, max } = stats(ctx);
        return max > 0 ? `${Math.round(used / 1000)}k / ${Math.round(max / 1000)}k` : '—';
      },
    },
    { key: 'sessions', value: (ctx) => String((ctx.data.subAgents ?? []).length) },
  ],
  noteKey: (ctx) => (stats(ctx).ratio >= 0.5 ? '.noteHigh' : '.noteLow'),
  badge: {
    match: (ctx) => stats(ctx).ratio >= 0.5,
    text: (ctx) => pct(stats(ctx).ratio),
    icon: ICONS.gauge,
  },
});

export const contextRotManifest = inspector.manifest;
export const contextRotClient = inspector.client;
