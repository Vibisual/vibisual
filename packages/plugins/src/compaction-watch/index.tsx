/**
 * §5.11 v3.99 — 컴팩션(Compaction): 압축 손실이 어디서 나는지 안다는 것.
 *
 * 지난 턴을 그대로 들고 가는 대신 요약 노트로 접어 넣는 표준 장치다. 다만 **요약은 대개 구체적 식별자
 * (파일 경로·함수명·에러 코드·결정의 이유)를 먼저 버린다** — 그게 바로 나중에 필요한 것들이다.
 * 자동 압축 전에 중요한 사실을 파일로 내보내는 것이 손실을 막는 요령이다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

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
