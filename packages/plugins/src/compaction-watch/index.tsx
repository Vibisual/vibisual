/** §5.11 — 컴팩션(Compaction): 요약은 구체적 식별자(경로·함수명·에러 코드·결정 이유)를 먼저 버린다 — 자동 압축 전에 중요한 사실을 파일로 내보낸다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const fill = (ctx: PluginBubbleContext): number => {
  let best = 0;
  for (const s of ctx.data.subAgents ?? []) {
    const max = s.contextMax ?? 0;
    if (max > 0) best = Math.max(best, (s.contextUsed ?? 0) / max);
  }
  return best;
};

const inspector = defineInspector({
  id: 'compaction-watch', i18nKey: 'compactionWatch', name: 'Compaction Watch', category: 'observability',
  needs: ['subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    if (fill(ctx) === 0) return { key: 'unknown', tone: 'neutral' };
    return fill(ctx) >= 0.7 ? { key: 'near', tone: 'warn' } : { key: 'far', tone: 'good' };
  },
  checks: [
    { key: 'fill', value: (ctx) => (fill(ctx) > 0 ? `${Math.round(fill(ctx) * 100)}%` : '—'), tone: (ctx) => (fill(ctx) >= 0.7 ? 'warn' : 'good') },
    { key: 'sessions', value: (ctx) => String((ctx.data.subAgents ?? []).length) },
  ],
  noteKey: (ctx) => (fill(ctx) >= 0.7 ? '.noteNear' : '.note'),
});

export const compactionWatchManifest = inspector.manifest;
export const compactionWatchClient = inspector.client;
