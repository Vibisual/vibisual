/**
 * §5.11 v4.00 — 청킹(Chunking): 무엇을 한 덩어리로 두는가.
 *
 * 너무 잘게 나누면 맥락이 끊기고, 너무 크게 두면 무관한 내용이 함께 딸려 온다. §5.10 이후
 * Vibisual 의 덩어리는 **절차 한 벌**이다 — 되풀이해 온 명령의 묶음이 통째로 하나의 `SKILL.md` 가
 * 되므로 경계를 따로 조율할 필요가 없는 대신, 그 묶음이 곧 품질이 된다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import { readAutoGoal } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const units = (ctx: PluginBubbleContext): number => readAutoGoal(ctx).stored;

const inspector = defineInspector({
  id: 'chunking', i18nKey: 'chunking', name: 'Chunking', category: 'observability',
  needs: ['autoGoal'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (units(ctx) === 0 ? { key: 'none', tone: 'neutral' } : { key: 'perCard', tone: 'good' }),
  checks: [
    { key: 'cards', value: (ctx) => String(units(ctx)) },
    { key: 'unit', value: (ctx) => ctx.t('panel.plugins.chunking.card') },
  ],
  noteKey: () => '.note',
});

export const chunkingManifest = inspector.manifest;
export const chunkingClient = inspector.client;
