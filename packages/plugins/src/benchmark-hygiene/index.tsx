/**
 * §5.11 v4.00 — 벤치마크 위생(Benchmark Hygiene): 공개 점수는 구매 근거가 되기 어렵다.
 *
 * 점수가 상단에 몰려 변별력을 잃거나(포화), 문제·정답이 학습 데이터에 섞이거나(오염), 같은 모델도 하네스를
 * 바꾸면 점수가 뛴다(스캐폴드 인플레이션). 유일하게 신뢰할 수 있는 신호는 **자기 도메인의 작업으로 만든
 * 자체 평가 셋**이다. 이 카드는 그 자체 기준이 쌓이고 있는지를 본다. 표시 전용.
 */
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
