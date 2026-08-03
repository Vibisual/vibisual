/**
 * §5.11 v4.00 — 프롬프트 캐싱(Prompt Caching): 앞부분이 매번 같아야 캐시가 먹는다.
 *
 * 매 요청 같은 앞부분(시스템 프롬프트·도구 정의)을 재사용하면 비용과 지연이 크게 준다. 다만 캐시가 먹으려면
 * 프리픽스가 **바이트 단위로 같아야** 하므로, 매 요청 달라지는 값(현재 시각·랜덤 ID·git 상태)을 앞에 두면
 * 캐시가 통째로 깨진다. 규칙은 하나다 — **변하는 것은 뒤로, 안 변하는 것은 앞으로.**
 *
 * 캐시 적중률은 우리가 관측하지 못한다(공급자 응답에만 있다). 그래서 이 카드는 적중률을 지어내지 않고,
 * **프리픽스가 안정적인 구성인지**만 본다 — 고정 규칙이 있고 도구 목록이 흔들리지 않으면 캐시가 살 조건이다.
 */
import { defineInspector } from '../framework/inspector.js';
import { effectiveTools } from '../lethal-trifecta/trifecta.js';
import type { PluginBubbleContext } from '../types.js';

const stableRules = (ctx: PluginBubbleContext): boolean => (ctx.agentConfig?.rules ?? '').trim().length > 0;
const tools = (ctx: PluginBubbleContext): number => effectiveTools(ctx.agentConfig).size;
const sessions = (ctx: PluginBubbleContext): number => (ctx.data.subAgents ?? []).length;

const inspector = defineInspector({
  id: 'prompt-caching',
  i18nKey: 'promptCaching',
  name: 'Prompt Caching',
  category: 'observability',
  needs: ['subAgents'],
  status: (ctx) => {
    if (sessions(ctx) <= 1) return { key: 'single', tone: 'neutral' };
    return stableRules(ctx) ? { key: 'reusable', tone: 'good' } : { key: 'thin', tone: 'neutral' };
  },
  checks: [
    {
      key: 'prefix',
      value: (ctx) => ctx.t(`panel.plugins.promptCaching.${stableRules(ctx) ? 'stable' : 'none'}`),
      tone: (ctx) => (stableRules(ctx) ? 'good' : 'neutral'),
    },
    { key: 'tools', value: (ctx) => String(tools(ctx)) },
    { key: 'sessions', value: (ctx) => String(sessions(ctx)) },
  ],
  noteKey: () => '.note',
});

export const promptCachingManifest = inspector.manifest;
export const promptCachingClient = inspector.client;
