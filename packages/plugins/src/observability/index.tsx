/** §5.11 — 관측 가능성(Observability): "왜 그랬지"를 사후에 재구성할 수 있는가. 관측도 앱을 죽인다 — 도구 이벤트마다 동기 쓰기·브로드캐스트 대신 샘플링·디바운스·배치. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { toneIfActive } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const signals = (ctx: PluginBubbleContext): number =>
  [
    (ctx.data.agentEvents ?? []).length > 0,
    (ctx.data.subAgents ?? []).length > 0,
    (ctx.data.agentReports ?? []).length > 0,
  ].filter(Boolean).length;

const inspector = defineInspector({
  id: 'observability', i18nKey: 'observability', name: 'Observability', category: 'observability',
  needs: ['agentEvents', 'subAgents', 'agentReports'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => (signals(ctx) >= 3 ? { key: 'full', tone: 'good' } : signals(ctx) >= 1 ? { key: 'partial', tone: 'neutral' } : { key: 'blind', tone: toneIfActive(ctx) }),
  checks: [
    { key: 'turns', value: (ctx) => String((ctx.data.agentEvents ?? []).length) },
    { key: 'sessions', value: (ctx) => String((ctx.data.subAgents ?? []).length) },
    { key: 'reports', value: (ctx) => String((ctx.data.agentReports ?? []).length) },
  ],
  noteKey: () => '.note',
});

export const observabilityManifest = inspector.manifest;
export const observabilityClient = inspector.client;
