/**
 * §5.11 v3.95 — 의미 기억(Semantic Memory): "무엇이 사실인가" 가 몇 개나 확정돼 있는가.
 *
 * 사건이 아니라 **추출된 사실**의 층이다. 저장 장수가 아니라 "현재 진실로 확정된 슬롯 수"가 실제 크기이고,
 * 값이 갈려 확정을 잃은 슬롯은 사람의 판단을 기다리는 몫이다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const b = (ctx: PluginBubbleContext) => ctx.data.brain ?? null;

const inspector = defineInspector({
  id: 'semantic-memory', i18nKey: 'semanticMemory', name: 'Semantic Memory', category: 'observability',
  needs: ['brain'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const s = b(ctx);
    if (!s) return { key: 'none', tone: 'neutral' };
    if ((s.contestedCount ?? 0) > 0) return { key: 'contested', tone: 'warn' };
    return { key: 'settled', tone: 'good' };
  },
  checks: [
    { key: 'cards', value: (ctx) => String(b(ctx)?.cardCount ?? 0) },
    { key: 'current', value: (ctx) => String(b(ctx)?.currentCount ?? 0), tone: () => 'good' },
    { key: 'contested', value: (ctx) => String(b(ctx)?.contestedCount ?? 0), tone: (ctx) => ((b(ctx)?.contestedCount ?? 0) > 0 ? 'warn' : 'neutral') },
  ],
  noteKey: () => '.note',
});

export const semanticMemoryManifest = inspector.manifest;
export const semanticMemoryClient = inspector.client;
