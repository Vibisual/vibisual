/** §5.11 — 프롬프트 인젝션(Prompt Injection): 외부 텍스트가 들어오는 경로를 세어 공격면을 보인다(명령·데이터는 원리적으로 못 가른다). 표시 전용. */
import { defineInspector, ICONS } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

/** 외부에서 온 텍스트가 컨텍스트로 들어오는 통로들. */
const INGRESS = ['WebFetch', 'WebSearch', 'Bash', 'Read'];
const paths = (ctx: PluginBubbleContext): string[] => INGRESS.filter((t) => effectiveTools(ctx.agentConfig).has(t));

const inspector = defineInspector({
  id: 'prompt-injection', i18nKey: 'promptInjection', name: 'Prompt Injection', category: 'security',
  status: (ctx) => {
    const n = paths(ctx).length;
    if (n === 0) return { key: 'sealed', tone: 'good' };
    return n >= 3 ? { key: 'wide', tone: 'warn' } : { key: 'narrow', tone: 'neutral' };
  },
  checks: [
    { key: 'paths', value: (ctx) => String(paths(ctx).length), tone: (ctx) => (paths(ctx).length >= 3 ? 'warn' : 'neutral'), hint: (ctx) => paths(ctx).join(' · ') || undefined },
    { key: 'web', value: (ctx) => ctx.t(`panel.plugins.promptInjection.${paths(ctx).some((t) => t.startsWith('Web')) ? 'yes' : 'no'}`) },
  ],
  noteKey: () => '.note',
  badge: { match: (ctx) => paths(ctx).length >= 3, text: () => '', icon: ICONS.shield },
});

export const promptInjectionManifest = inspector.manifest;
export const promptInjectionClient = inspector.client;
