/** §5.11 — 시스템 프롬프트(System Prompt): 규칙문 길이와 매 턴 싣는 양. 표시 전용. */
import { SYSTEM_PROMPT_ESTIMATE } from '@vibisual/shared';
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

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
