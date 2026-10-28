/** §5.11 — 대체(Supersede): 옛것을 지우지 않고 닫았는가. §5.10(Q) active·retired/superseded 집계를 읽는다 — 후보를 물린 `dismissedCount` 는 닫힌 절차 수가 아니다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const closed = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).retired;

const inspector = defineInspector({
  id: 'supersede', i18nKey: 'supersede', name: 'Supersede', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (!readAutoGoal(ctx).present) return { key: 'none', tone: 'neutral' };
    return closed(ctx) > 0 ? { key: 'history', tone: 'good' } : { key: 'flat', tone: 'neutral' };
  },
  checks: [
    { key: 'stored', value: (ctx) => String(readAutoGoal(ctx).stored) },
    { key: 'current', value: (ctx) => String(readAutoGoal(ctx).active) },
    { key: 'closed', value: (ctx) => String(closed(ctx)) },
  ],
  noteKey: () => '.note',
});

export const supersedeManifest = inspector.manifest;
export const supersedeClient = inspector.client;
