/** §5.11 — 훅 생명주기(Hook): 훅이 얼마나 자주 오는가 — 예상보다 잦아("세션 종료"가 매 턴 끝마다 오는 식) 훅의 동기 I/O 는 에이전트를 멈춘다(큐잉·코얼레스가 기본). 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

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
