/**
 * §5.11 v3.95 — 절차 기억(Procedural Memory): "어떻게 하는가" 가 파일로 있는가.
 *
 * 기억 3층 중 유일하게 **파일로 두는 것이 확실한 정답**인 층이다 — 절차는 검색될 필요 없이 해당 작업일 때
 * 통째로 필요하기 때문이다. 스킬 정의와 에이전트 규칙이 그 물리적 형태이며, 버전 관리가 붙는 것이
 * 벡터 저장소 대비 결정적 이점이다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const skills = (ctx: PluginBubbleContext): string[] => ctx.agentConfig?.skills ?? [];
const hasRules = (ctx: PluginBubbleContext): boolean => (ctx.agentConfig?.rules ?? '').trim().length > 0;

const inspector = defineInspector({
  id: 'procedural-memory', i18nKey: 'proceduralMemory', name: 'Procedural Memory', category: 'workflow',
  status: (ctx) => {
    if (skills(ctx).length === 0 && !hasRules(ctx)) return { key: 'none', tone: 'neutral' };
    return { key: 'filed', tone: 'good' };
  },
  checks: [
    { key: 'skills', value: (ctx) => String(skills(ctx).length), hint: (ctx) => skills(ctx).join(' · ') || undefined },
    {
      key: 'rules',
      value: (ctx) => ctx.t(`panel.plugins.proceduralMemory.${hasRules(ctx) ? 'yes' : 'no'}`),
      tone: (ctx) => (hasRules(ctx) ? 'good' : 'neutral'),
    },
  ],
  noteKey: () => '.note',
});

export const proceduralMemoryManifest = inspector.manifest;
export const proceduralMemoryClient = inspector.client;
