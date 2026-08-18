/**
 * §5.11 v4.00 — 지침 파일(AGENTS.md): 길수록 좋은 게 아니다.
 *
 * 저장소 루트의 단일 지침 파일이 사실상 표준이 됐지만, 조사에서 **150줄을 넘으면 수익이 급감하고 추론 비용만
 * 20% 안팎 늘었다.** 정답 형태는 "짧은 지침 + 상세는 링크"이며, 상세 문서를 통째로 붙여넣는 것은
 * 컨텍스트 부패를 스스로 만드는 짓이다. 이 카드는 이 에이전트의 상시 규칙을 그 기준으로 잰다. 표시 전용.
 */
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
