/** §5.11 — 청킹(Chunking): §5.10 이후 덩어리는 절차 한 벌(되풀이된 명령 묶음 = `SKILL.md` 하나)이라 그 묶음이 곧 품질이다. 표시 전용. */
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
