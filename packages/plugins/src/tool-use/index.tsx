/**
 * §5.11 v3.93 — 도구 사용(Tool Use): 도구 정의가 먹는 컨텍스트 몫.
 *
 * 도구가 수십 개를 넘어가면 정의만으로 수만 토큰이 되고, 모델의 도구 선택 정확도도 같이 떨어진다.
 * 안 쓸 도구를 걷어내는 것만으로 비용과 품질이 동시에 개선되므로, 여기서는 **몇 개를 쥐고 있고
 * 그게 창의 몇 퍼센트인지**를 보여준다. 표시 전용.
 */
import { TOOL_SCHEMA_ESTIMATE, AVAILABLE_AGENT_TOOLS, getModelContextLimit } from '@vibisual/shared';
import { defineInspector } from '../framework/inspector.js';
import { effectiveTools } from '../lethal-trifecta/trifecta.js';
import type { PluginBubbleContext } from '../types.js';

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
