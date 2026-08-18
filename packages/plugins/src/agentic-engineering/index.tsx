/**
 * §5.11 v3.97 — 에이전틱 엔지니어링(Agentic Engineering): 감독과 검증을 갖춘 운용인가.
 *
 * "AI 로 코딩한다"와 "에이전트를 운용한다"의 차이가 여기 있다 — 전문가의 기본 워크플로가 되었지만,
 * **더 많은 감독과 검토를 곁들여서**라는 단서가 붙는다. 이 카드는 그 단서가 실제로 붙어 있는지를 센다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import { toneIfActive } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

function pillars(ctx: PluginBubbleContext): number {
  return [
    (ctx.data.agentReviews ?? []).length > 0,
    (ctx.data.taskEdges ?? []).some((e) => e.kind === 'critique'),
    (ctx.data.agentReports ?? []).some((r) => (r.learned ?? []).length > 0),
    (ctx.agentConfig?.rules ?? '').trim().length > 0,
  ].filter(Boolean).length;
}

const inspector = defineInspector({
  id: 'agentic-engineering', i18nKey: 'agenticEngineering', name: 'Agentic Engineering', category: 'workflow',
  needs: ['agentReviews', 'taskEdges', 'agentReports', 'agentEvents', 'subAgents'],
  match: (ctx) => ctx.bubbleType === 'agent',
  status: (ctx) => {
    const p = pillars(ctx);
    if (p >= 3) return { key: 'engineered', tone: 'good' };
    if (p >= 1) return { key: 'partial', tone: 'neutral' };
    return { key: 'raw', tone: toneIfActive(ctx) };
  },
  checks: [
    { key: 'pillars', value: (ctx) => `${pillars(ctx)} / 4` },
    { key: 'reviews', value: (ctx) => String((ctx.data.agentReviews ?? []).length) },
    { key: 'critique', value: (ctx) => String((ctx.data.taskEdges ?? []).filter((e) => e.kind === 'critique').length) },
  ],
  noteKey: () => '.note',
});

export const agenticEngineeringManifest = inspector.manifest;
export const agenticEngineeringClient = inspector.client;
