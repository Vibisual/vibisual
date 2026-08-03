/**
 * §5.11 v3.99 — 도구 검색(Tool Search): 도구를 다 싣는가, 찾아 부르는가.
 *
 * 도구를 전부 컨텍스트에 싣지 않고 필요할 때 검색해 그것만 로드하는 방식이다. 도구를 100번 부르면 중간 결과
 * 100개가 전부 컨텍스트에 쌓이지만, 코드로 돌리면 최종 결과만 돌아온다. **"도구를 줄여라"의 진화형이
 * "도구를 검색하게 하라"**이며, 카탈로그가 커질수록 이득이 커진다. 표시 전용.
 */
import { AVAILABLE_AGENT_TOOLS, TOOL_SCHEMA_ESTIMATE } from '@vibisual/shared';
import { defineInspector } from '../framework/inspector.js';
import { effectiveTools } from '../lethal-trifecta/trifecta.js';
import type { PluginBubbleContext } from '../types.js';

const loaded = (ctx: PluginBubbleContext): number => effectiveTools(ctx.agentConfig).size;
const share = (ctx: PluginBubbleContext): number => loaded(ctx) / AVAILABLE_AGENT_TOOLS.length;

const inspector = defineInspector({
  id: 'tool-search', i18nKey: 'toolSearch', name: 'Tool Search', category: 'observability',
  status: (ctx) => (share(ctx) >= 1 ? { key: 'all', tone: 'warn' } : share(ctx) <= 0.5 ? { key: 'lean', tone: 'good' } : { key: 'most', tone: 'neutral' }),
  checks: [
    { key: 'loaded', value: (ctx) => `${loaded(ctx)} / ${AVAILABLE_AGENT_TOOLS.length}` },
    { key: 'cost', value: () => `~${Math.round(TOOL_SCHEMA_ESTIMATE / 100) / 10}k` },
  ],
  noteKey: () => '.note',
});

export const toolSearchManifest = inspector.manifest;
export const toolSearchClient = inspector.client;
