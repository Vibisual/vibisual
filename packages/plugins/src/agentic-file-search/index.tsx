/**
 * §5.11 v3.98 — 파일시스템 검색(Agentic File Search): grep 이 먼저다.
 *
 * 코드베이스에서는 색인을 세우는 것보다 **파일시스템을 직접 훑는 편**이 대개 낫다 — 색인은 낡고,
 * grep 은 항상 현재 상태를 본다. 이 카드는 이 에이전트가 그 도구를 쥐고 있는지 본다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import { effectiveTools } from '../lethal-trifecta/trifecta.js';
import type { PluginBubbleContext } from '../types.js';

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
