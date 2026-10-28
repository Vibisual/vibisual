/** §5.11 — 파일시스템 검색(Agentic File Search): 색인보다 grep 이 먼저다(색인은 낡는다) — 이 에이전트가 그 도구를 쥐었는지 본다. 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

const SEARCH = ['Grep', 'Glob'];
const have = (ctx: PluginBubbleContext): string[] => SEARCH.filter((t) => effectiveTools(ctx.agentConfig).has(t));

const inspector = defineInspector({
  id: 'agentic-file-search', i18nKey: 'agenticFileSearch', name: 'Agentic File Search', category: 'observability',
  status: (ctx) => {
    if (have(ctx).length === SEARCH.length) return { key: 'full', tone: 'good' };
    return have(ctx).length > 0 ? { key: 'partial', tone: 'neutral' } : { key: 'none', tone: 'warn' };
  },
  checks: [
    { key: 'tools', value: (ctx) => (have(ctx).length > 0 ? have(ctx).join(' · ') : '—'), tone: (ctx) => (have(ctx).length > 0 ? 'good' : 'warn') },
    {
      key: 'read',
      value: (ctx) => ctx.t(`panel.plugins.agenticFileSearch.${effectiveTools(ctx.agentConfig).has('Read') ? 'yes' : 'no'}`),
    },
  ],
  noteKey: () => '.note',
});

export const agenticFileSearchManifest = inspector.manifest;
export const agenticFileSearchClient = inspector.client;
