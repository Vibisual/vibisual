/**
 * §5.11 v3.96 — 스캐폴드(Scaffold): 모델 주변에 짜 놓은 접착제가 얼마나 되는가.
 *
 * 하네스가 운영·인프라 뉘앙스라면 스캐폴드는 프롬프트·제어 흐름·기억 접착제 쪽이다. 장기 실행 에이전트의
 * 성능 향상분은 더 똑똑한 모델이 아니라 **더 나은 스캐폴딩**에서 나온다는 것이 공통 결론이다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

const rulesLen = (ctx: PluginBubbleContext): number => (ctx.agentConfig?.rules ?? '').trim().length;
const skills = (ctx: PluginBubbleContext): number => (ctx.agentConfig?.skills ?? []).length;

const inspector = defineInspector({
  id: 'scaffold', i18nKey: 'scaffold', name: 'Scaffold', category: 'observability',
  status: (ctx) => {
    if (rulesLen(ctx) === 0 && skills(ctx) === 0) return { key: 'none', tone: 'warn' };
    return rulesLen(ctx) > 0 && skills(ctx) > 0 ? { key: 'full', tone: 'good' } : { key: 'partial', tone: 'neutral' };
  },
  checks: [
    { key: 'rules', value: (ctx) => (rulesLen(ctx) > 0 ? String(rulesLen(ctx)) : '—') },
    { key: 'skills', value: (ctx) => String(skills(ctx)), hint: (ctx) => (ctx.agentConfig?.skills ?? []).join(' · ') || undefined },
    { key: 'maxTurns', value: (ctx) => (ctx.agentConfig?.maxTurns && ctx.agentConfig.maxTurns > 0 ? String(ctx.agentConfig.maxTurns) : '—') },
  ],
  noteKey: () => '.note',
});

export const scaffoldManifest = inspector.manifest;
export const scaffoldClient = inspector.client;
