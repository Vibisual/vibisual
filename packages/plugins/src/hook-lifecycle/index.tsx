/**
 * §5.11 v3.96 — 훅 생명주기(Hook): 훅이 얼마나 자주 오는가.
 *
 * 훅은 하네스가 모델 내부를 안 고치고 행동을 관측·차단하는 통로이지만, **예상보다 자주 온다** —
 * "세션 종료" 훅이 실제로는 매 턴 종료마다 오는 식의 오해가 폭주 사고의 단골 원인이다. 훅에서 동기 I/O 를
 * 하면 에이전트가 그만큼 멈추므로 큐잉·코얼레스가 기본이다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

function perMinute(ctx: PluginBubbleContext): number {
  const list = ctx.data.agentEvents ?? [];
  if (list.length < 2) return 0;
  const first = list[0]?.timestamp ?? 0;
  const last = list[list.length - 1]?.timestamp ?? 0;
  const minutes = Math.max(1, (last - first) / 60_000);
  return list.length / minutes;
}

const inspector = defineInspector({
  id: 'hook-lifecycle', i18nKey: 'hookLifecycle', name: 'Hook Lifecycle', category: 'observability',
  needs: ['agentEvents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if ((ctx.data.agentEvents ?? []).length === 0) return { key: 'quiet', tone: 'neutral' };
    return perMinute(ctx) >= 6 ? { key: 'busy', tone: 'warn' } : { key: 'normal', tone: 'good' };
  },
  checks: [
    { key: 'events', value: (ctx) => String((ctx.data.agentEvents ?? []).length) },
    { key: 'rate', value: (ctx) => (perMinute(ctx) > 0 ? perMinute(ctx).toFixed(1) : '—'), tone: (ctx) => (perMinute(ctx) >= 6 ? 'warn' : 'neutral') },
  ],
  noteKey: () => '.note',
});

export const hookLifecycleManifest = inspector.manifest;
export const hookLifecycleClient = inspector.client;
