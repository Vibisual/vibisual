/** §5.11 — 허용 목록(Allowlist): 전체 도구 중 실제로 쥔 것과 빠진 것을 보여준다. 표시 전용. */
import { AVAILABLE_AGENT_TOOLS } from '@vibisual/shared';
import { defineInspector } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';

const inspector = defineInspector({
  id: 'allowlist',
  i18nKey: 'allowlist',
  name: 'Allowlist',
  category: 'security',
  status: (ctx) => {
    const granted = effectiveTools(ctx.agentConfig).size;
    const total = AVAILABLE_AGENT_TOOLS.length;
    if (granted <= total / 2) return { key: 'narrow', tone: 'good' };
    if (granted < total) return { key: 'partial', tone: 'warn' };
    return { key: 'all', tone: 'bad' };
  },
  checks: [
    {
      key: 'granted',
      value: (ctx) => `${effectiveTools(ctx.agentConfig).size} / ${AVAILABLE_AGENT_TOOLS.length}`,
    },
    {
      key: 'denied',
      value: (ctx) => String((ctx.agentConfig?.disallowedTools ?? []).length),
      tone: (ctx) => ((ctx.agentConfig?.disallowedTools ?? []).length > 0 ? 'good' : 'neutral'),
    },
    {
      key: 'missing',
      value: (ctx) => {
        const have = effectiveTools(ctx.agentConfig);
        return AVAILABLE_AGENT_TOOLS.filter((t) => !have.has(t)).join(' · ') || '—';
      },
    },
  ],
  noteKey: () => '.note',
});

export const allowlistManifest = inspector.manifest;
export const allowlistClient = inspector.client;
