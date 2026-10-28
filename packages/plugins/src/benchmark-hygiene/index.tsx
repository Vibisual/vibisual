/** §5.11 — 벤치마크 위생(Benchmark Hygiene): 공개 점수(포화·오염·스캐폴드 인플레이션) 대신 자기 작업으로 만든 자체 평가 기준이 쌓이는지 본다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { toneIfActive } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const own = (ctx: PluginBubbleContext): number =>
  (ctx.data.agentReports ?? []).reduce((n, r) => n + (r.learned ?? []).length, 0) +
  (ctx.data.agentReviews ?? []).reduce((n, r) => n + (r.checkpoints ?? []).length, 0);

const inspector = defineInspector({
  id: 'benchmark-hygiene', i18nKey: 'benchmarkHygiene', name: 'Benchmark Hygiene', category: 'observability',
  needs: ['agentReports', 'agentReviews', 'agentEvents', 'subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (own(ctx) === 0 ? { key: 'none', tone: toneIfActive(ctx) } : { key: 'own', tone: 'good' }),
  checks: [
    { key: 'own', value: (ctx) => String(own(ctx)), tone: (ctx) => (own(ctx) > 0 ? 'good' : 'warn') },
  ],
  noteKey: () => '.note',
});

export const benchmarkHygieneManifest = inspector.manifest;
export const benchmarkHygieneClient = inspector.client;
