/**
 * §5.11 v3.93 — 시스템 프롬프트(System Prompt): 상시로 얹히는 지시층의 크기.
 *
 * 범용 에이전트의 기본 시스템 프롬프트 + 도구 정의는 좁은 작업에 대부분 낭비다. 또 시스템 프롬프트는
 * **올바른 고도**에 써야 한다 — 너무 구체적이면 취약해지고, 너무 추상적이면 지켜지지 않는다.
 * 여기서는 이 에이전트의 규칙문이 얼마나 긴지, 매 턴 얼마를 싣고 있는지를 보여준다. 표시 전용.
 */
import { SYSTEM_PROMPT_ESTIMATE } from '@vibisual/shared';
import { defineInspector } from '../framework/inspector.js';
import type { PluginBubbleContext } from '../types.js';

function rulesChars(ctx: PluginBubbleContext): number {
  return (ctx.agentConfig?.rules ?? '').length;
}

/** 문자수/4 ≈ 토큰. 표준적인 근사이며 정확한 계산이 목적이 아니다. */
function rulesTokens(ctx: PluginBubbleContext): number {
  return Math.round(rulesChars(ctx) / 4);
}

const inspector = defineInspector({
  id: 'system-prompt', i18nKey: 'systemPrompt', name: 'System Prompt', category: 'observability',
  status: (ctx) => {
    const t = rulesTokens(ctx);
    if (t === 0) return { key: 'none', tone: 'neutral' };
    if (t > 2000) return { key: 'long', tone: 'warn' };
    return { key: 'sized', tone: 'good' };
  },
  checks: [
    { key: 'rules', value: (ctx) => (rulesChars(ctx) > 0 ? `${rulesChars(ctx)}` : '—') },
    { key: 'rulesTokens', value: (ctx) => (rulesTokens(ctx) > 0 ? `~${rulesTokens(ctx)}` : '—') },
    { key: 'base', value: () => `~${Math.round(SYSTEM_PROMPT_ESTIMATE / 100) / 10}k` },
    { key: 'skills', value: (ctx) => String((ctx.agentConfig?.skills ?? []).length) },
  ],
  noteKey: (ctx) => (rulesTokens(ctx) > 2000 ? '.noteLong' : '.note'),
});

export const systemPromptManifest = inspector.manifest;
export const systemPromptClient = inspector.client;
