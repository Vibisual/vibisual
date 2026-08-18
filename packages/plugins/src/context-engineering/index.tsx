/**
 * §5.11 v3.96 — 컨텍스트 엔지니어링(Context Engineering): 매 추론에 무엇이 실리는가.
 *
 * 질문이 "프롬프트를 어떻게 쓰나"에서 **"무엇을 보여줄까"**로 바뀌었다. 패턴은 다섯으로 정리된다 —
 * 점진적 공개 · 압축 · 라우팅 · 검색 · 도구 관리. 이 카드는 그중 이 에이전트에 실제로 적용된 것이
 * 몇 개인지 세어 준다. 표시 전용.
 */
import { defineInspector } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';
import { AVAILABLE_AGENT_TOOLS } from '@vibisual/shared';
import type { PluginBubbleContext } from '../sdk/index.js';

/** 다섯 패턴 중 관측 가능한 것들: 색인 주입 · 도구 관리 · 검색 사용 · 사고 조절. */
function applied(ctx: PluginBubbleContext): number {
  const injections = ctx.data.brainInjections ?? [];
  return [
    injections.length > 0,
    effectiveTools(ctx.agentConfig).size < AVAILABLE_AGENT_TOOLS.length,
    injections.some((e) => e.trigger === 'search'),
    (ctx.agentConfig?.effort ?? 'default') !== 'default',
  ].filter(Boolean).length;
}

const inspector = defineInspector({
  id: 'context-engineering', i18nKey: 'contextEngineering', name: 'Context Engineering', category: 'observability',
  needs: ['brainInjections'],
  status: (ctx) => (applied(ctx) >= 3 ? { key: 'designed', tone: 'good' } : applied(ctx) >= 1 ? { key: 'partial', tone: 'neutral' } : { key: 'default', tone: 'warn' }),
  checks: [
    { key: 'applied', value: (ctx) => `${applied(ctx)} / 4` },
    { key: 'tools', value: (ctx) => `${effectiveTools(ctx.agentConfig).size} / ${AVAILABLE_AGENT_TOOLS.length}` },
    { key: 'memory', value: (ctx) => String((ctx.data.brainInjections ?? []).length) },
  ],
  noteKey: () => '.note',
});

export const contextEngineeringManifest = inspector.manifest;
export const contextEngineeringClient = inspector.client;
