/**
 * §5.11 v3.95 — 대체(Supersede): 옛것을 지우지 않고 닫았는가.
 *
 * 새 지식이 옛 지식과 충돌할 때 지우면 "왜 바뀌었는지"를 잃는다. **불변 기록 + 깨끗한 현재**를
 * 동시에 주려면 닫되 남겨야 한다.
 *
 * §5.10(Q)의 active와 retired/superseded 집계를 읽는다. 후보를 물린 것은 절차의 대체 이력이
 * 아니므로 dismissedCount를 닫힌 절차 수로 쓰지 않는다. 표시 전용.
 */
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
