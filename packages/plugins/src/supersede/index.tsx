/**
 * §5.11 v3.95 — 대체(Supersede): 옛것을 지우지 않고 닫았는가.
 *
 * 새 지식이 옛 지식과 충돌할 때 지우면 "왜 바뀌었는지"를 잃는다. **불변 기록 + 깨끗한 현재**를
 * 동시에 주려면 닫되 남겨야 한다.
 *
 * §5.10 의 자동 목표가 그 규약을 지킨다 — 사용자가 물린 후보는 지워지는 것이 아니라
 * **덮인다**. 같은 절차가 계속 관찰돼도 제안만 멈출 뿐 관찰 자체는 남는다. 그래서 물려 둔 수가 곧
 * 닫힌 이력이다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const closed = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).dismissed;

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
    { key: 'current', value: (ctx) => String(readAutoGoal(ctx).skills) },
    { key: 'closed', value: (ctx) => String(closed(ctx)) },
  ],
  noteKey: () => '.note',
});

export const supersedeManifest = inspector.manifest;
export const supersedeClient = inspector.client;
