/** §5.11 — 부채꼴 분기(Fan-out): 동시에 도는 갈래 수와 "합칠 규칙을 정했는가"를 본다(병렬은 진짜 독립일 때만 이득). 표시 전용. */
import { defineInspector, ICONS } from '../sdk/index.js';
import { formatElapsed } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

function tasks(ctx: PluginBubbleContext): readonly { startedAt: number }[] {
  return ctx.data.runningTasks ?? [];
}

const inspector = defineInspector({
  id: 'fan-out', i18nKey: 'fanOut', name: 'Fan-out', category: 'observability',
  needs: ['runningTasks'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const n = tasks(ctx).length;
    if (n === 0) return { key: 'none', tone: 'neutral' };
    if (n >= 4) return { key: 'wide', tone: 'warn' };
    return { key: 'parallel', tone: 'good' };
  },
  checks: [
    { key: 'branches', value: (ctx) => String(tasks(ctx).length) },
    {
      key: 'oldest',
      value: (ctx) => {
        const list = tasks(ctx);
        if (list.length === 0) return '—';
        const oldest = Math.min(...list.map((t) => t.startedAt));
        return formatElapsed(Math.max(0, ctx.now - oldest));
      },
    },
  ],
  noteKey: (ctx) => (tasks(ctx).length >= 4 ? '.noteWide' : '.note'),
  badge: { match: (ctx) => tasks(ctx).length >= 2, text: (ctx) => String(tasks(ctx).length), icon: ICONS.route },
});

export const fanOutManifest = inspector.manifest;
export const fanOutClient = inspector.client;
