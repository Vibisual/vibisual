/**
 * §5.11 v4.00 — 청킹(Chunking): 무엇을 한 덩어리로 두는가.
 *
 * 너무 잘게 나누면 맥락이 끊기고, 너무 크게 두면 무관한 내용이 함께 딸려 온다. Vibisual 의 기억은
 * **카드 한 장이 곧 한 덩어리**이고 주제 문서로 묶이므로, 청크 경계를 따로 조율할 필요가 없는 대신
 * 카드 하나의 크기가 곧 품질이 된다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

const cards = (ctx: PluginBubbleContext): number => ctx.data.brain?.cardCount ?? 0;

const inspector = defineInspector({
  id: 'chunking', i18nKey: 'chunking', name: 'Chunking', category: 'observability',
  needs: ['brain'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (cards(ctx) === 0 ? { key: 'none', tone: 'neutral' } : { key: 'perCard', tone: 'good' }),
  checks: [
    { key: 'cards', value: (ctx) => String(cards(ctx)) },
    { key: 'unit', value: (ctx) => ctx.t('panel.plugins.chunking.card') },
  ],
  noteKey: () => '.note',
});

export const chunkingManifest = inspector.manifest;
export const chunkingClient = inspector.client;
