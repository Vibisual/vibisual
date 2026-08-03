/**
 * §5.11 v3.97 — 관측 가능성(Observability): "왜 그랬지"를 사후에 재구성할 수 있는가.
 *
 * 에이전트는 비결정적이라, 재현이 안 되는 문제를 로그 없이 고치는 것은 불가능하다. 다만 **관측이 앱을
 * 죽일 수 있다** — 도구 이벤트마다 동기 디스크 쓰기·브로드캐스트를 하면 그 자체가 병목이 된다.
 * 샘플링·디바운스·배치가 기본 장치다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import { toneIfActive } from '../framework/activity.js';
import type { PluginBubbleContext } from '../types.js';

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
