/** §5.11 — 도구 사용(Tool Use): 쥔 도구 수와 그 정의가 창에서 먹는 몫. 표시 전용. */
import { TOOL_SCHEMA_ESTIMATE, AVAILABLE_AGENT_TOOLS, getModelContextLimit } from '@vibisual/shared';
import { defineInspector } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

/** 도구 하나당 스키마 토큰 근사 — shared 의 전체 추정치를 도구 수로 나눠 쓴다. */
const PER_TOOL = Math.round(TOOL_SCHEMA_ESTIMATE / AVAILABLE_AGENT_TOOLS.length);

function tokens(ctx: PluginBubbleContext): number {
  return effectiveTools(ctx.agentConfig).size * PER_TOOL;
}

function ratio(ctx: PluginBubbleContext): number {
  const limit = getModelContextLimit(ctx.agentConfig?.model);
  return limit > 0 ? tokens(ctx) / limit : 0;
}

const inspector = defineInspector({
  id: 'tool-use', i18nKey: 'toolUse', name: 'Tool Use', category: 'observability',
  status: (ctx) => {
    const n = effectiveTools(ctx.agentConfig).size;
    if (n >= AVAILABLE_AGENT_TOOLS.length) return { key: 'all', tone: 'warn' };
    if (n <= 4) return { key: 'lean', tone: 'good' };
    return { key: 'moderate', tone: 'neutral' };
  },
  checks: [
    { key: 'count', value: (ctx) => `${effectiveTools(ctx.agentConfig).size} / ${AVAILABLE_AGENT_TOOLS.length}` },
    { key: 'tokens', value: (ctx) => `~${Math.round(tokens(ctx) / 100) / 10}k` },
    { key: 'share', value: (ctx) => `${(ratio(ctx) * 100).toFixed(1)}%` },
  ],
  noteKey: () => '.note',
});

export const toolUseManifest = inspector.manifest;
export const toolUseClient = inspector.client;
