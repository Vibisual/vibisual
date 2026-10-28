/** §5.11 — 지침 파일(AGENTS.md): 길수록 좋은 게 아니다(조사: 150줄을 넘으면 수익 급감·추론 비용 20% 안팎 증가) — 이 기준으로 상시 규칙을 잰다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

/** 150줄 ≈ 한 줄 60자 기준 9,000자. 문턱은 줄 수가 아니라 분량의 대리값으로 쓴다. */
const THRESHOLD_CHARS = 9000;
const chars = (ctx: PluginBubbleContext): number => (ctx.agentConfig?.rules ?? '').length;

const inspector = defineInspector({
  id: 'agents-md', i18nKey: 'agentsMd', name: 'Agent Instructions', category: 'observability',
  status: (ctx) => {
    if (chars(ctx) === 0) return { key: 'none', tone: 'neutral' };
    return chars(ctx) > THRESHOLD_CHARS ? { key: 'long', tone: 'warn' } : { key: 'short', tone: 'good' };
  },
  checks: [
    { key: 'chars', value: (ctx) => (chars(ctx) > 0 ? String(chars(ctx)) : '—'), tone: (ctx) => (chars(ctx) > THRESHOLD_CHARS ? 'warn' : 'good') },
    { key: 'threshold', value: () => String(THRESHOLD_CHARS) },
  ],
  noteKey: (ctx) => (chars(ctx) > THRESHOLD_CHARS ? '.noteLong' : '.note'),
});

export const agentsMdManifest = inspector.manifest;
export const agentsMdClient = inspector.client;
