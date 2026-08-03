/**
 * §5.11 v3.99 — 에이전트 공급망(Agentic Supply Chain): 이 에이전트가 의존하는 것들.
 *
 * 침해는 에이전트가 **의존하는 것**을 통해 들어온다 — 악성 도구·플러그인, 신뢰할 수 없는 서버, 변조된 스킬 파일.
 * 특히 **도구 설명문 자체가 프롬프트**라는 점이 위험하다. 악의적 도구는 설명란에 지시를 숨겨 에이전트를 조종할 수 있다.
 * 그래서 외부 도구는 의존성이 아니라 **권한 위임**으로 취급해야 한다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import { effectiveTools } from '../lethal-trifecta/trifecta.js';
import type { PluginBubbleContext } from '../types.js';

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
