/** §5.11 — 도구 검색(Tool Search): 도구를 다 싣는가, 찾아 부르는가. 표시 전용. */
import { AVAILABLE_AGENT_TOOLS, TOOL_SCHEMA_ESTIMATE } from '@vibisual/shared';
import { defineInspector } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

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
