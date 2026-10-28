/** §5.11 — 에이전트 공급망(Agentic Supply Chain): 이 에이전트가 의존하는 도구·서버·스킬. 도구 설명문 자체가 프롬프트라 외부 도구는 권한 위임으로 본다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const skills = (ctx: PluginBubbleContext): string[] => ctx.agentConfig?.skills ?? [];
/** Vibisual 이 직접 아는 내장 도구가 아닌 것 = 바깥에서 온 것으로 본다. */
const external = (ctx: PluginBubbleContext): string[] =>
  [...effectiveTools(ctx.agentConfig)].filter((t) => t.includes('__') || t.startsWith('mcp'));

const inspector = defineInspector({
  id: 'agentic-supply-chain', i18nKey: 'agenticSupplyChain', name: 'Agentic Supply Chain', category: 'security',
  status: (ctx) => {
    if (external(ctx).length > 0) return { key: 'external', tone: 'warn' };
    return skills(ctx).length > 0 ? { key: 'skills', tone: 'neutral' } : { key: 'builtin', tone: 'good' };
  },
  checks: [
    { key: 'external', value: (ctx) => String(external(ctx).length), tone: (ctx) => (external(ctx).length > 0 ? 'warn' : 'good'), hint: (ctx) => external(ctx).join(' · ') || undefined },
    { key: 'skills', value: (ctx) => String(skills(ctx).length), hint: (ctx) => skills(ctx).join(' · ') || undefined },
    { key: 'builtin', value: (ctx) => String(effectiveTools(ctx.agentConfig).size - external(ctx).length) },
  ],
  noteKey: () => '.note',
});

export const agenticSupplyChainManifest = inspector.manifest;
export const agenticSupplyChainClient = inspector.client;
