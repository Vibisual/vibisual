/**
 * §5.11 v3.95 — 대체(Supersede): 옛 지식을 지우지 않고 닫았는가.
 *
 * 새 지식이 옛 지식과 충돌할 때 지우면 "왜 바뀌었는지"를 잃는다. 유효기간 2축(연 시각 / 닫힌 시각)이
 * **불변 기록 + 깨끗한 현재**를 동시에 준다. 저장 장수와 현재 진실 슬롯의 차이가 곧 닫힌 이력이다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const closed = (ctx: PluginBubbleContext): number =>
  Math.max(0, (ctx.data.brain?.cardCount ?? 0) - (ctx.data.brain?.currentCount ?? 0));

const inspector = defineInspector({
  id: 'supersede', i18nKey: 'supersede', name: 'Supersede', category: 'observability',
  needs: ['brain'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (!ctx.data.brain) return { key: 'none', tone: 'neutral' };
    return closed(ctx) > 0 ? { key: 'history', tone: 'good' } : { key: 'flat', tone: 'neutral' };
  },
  checks: [
    { key: 'stored', value: (ctx) => String(ctx.data.brain?.cardCount ?? 0) },
    { key: 'current', value: (ctx) => String(ctx.data.brain?.currentCount ?? 0) },
    { key: 'closed', value: (ctx) => String(closed(ctx)) },
  ],
  noteKey: () => '.note',
});

export const supersedeManifest = inspector.manifest;
export const supersedeClient = inspector.client;
