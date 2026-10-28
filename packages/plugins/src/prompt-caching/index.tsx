/**
 * §5.11 — 프롬프트 캐싱(Prompt Caching): 프리픽스가 바이트 단위로 같아야 캐시가 먹는다(변하는 것은 뒤로).
 * 적중률은 관측할 수 없어(공급자 응답에만 있다) 지어내지 않고, 프리픽스가 안정적인 구성인지만 본다.
 */
import { defineInspector } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

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
