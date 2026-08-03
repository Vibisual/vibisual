/**
 * §5.11 v3.99 — 프롬프트 인젝션(Prompt Injection): 이 에이전트가 읽는 외부 텍스트는 어디서 오는가.
 *
 * 원인이 구조적이다 — 모델은 명령과 데이터를 같은 토큰 스트림으로 받으므로 둘을 원리적으로 구분할 수 없다.
 * "해결됐다"는 주장은 신뢰하지 않는 것이 기본이고, 대신 **어떤 경로로 외부 텍스트가 들어오는지**를 세어
 * 공격면을 눈에 보이게 한다. 표시 전용.
 */
import { defineInspector, ICONS } from '../framework/inspector.js';
import { effectiveTools } from '../lethal-trifecta/trifecta.js';
import type { PluginBubbleContext } from '../types.js';

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
