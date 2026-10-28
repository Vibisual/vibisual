/** §5.11 — 스캐폴드(Scaffold): 모델 주변 접착제(프롬프트·제어 흐름·기억)가 얼마나 되는가. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

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
