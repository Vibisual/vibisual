/**
 * §5.11 v3.93 — 허용 목록(Allowlist): 도구 정책이 "이것만 된다"에 가까운가.
 *
 * 차단 목록은 빠뜨린 것이 곧 구멍이고, 허용 목록은 모르는 것을 기본 차단해 시간이 지나도 안전 쪽으로
 * 실패한다. 여기서는 전체 도구 중 몇 개를 실제로 쥐고 있는지, 무엇이 빠져 있는지를 보여준다. 표시 전용.
 */
import { AVAILABLE_AGENT_TOOLS } from '@vibisual/shared';
import { defineInspector } from '../framework/inspector.js';
import { effectiveTools } from '../lethal-trifecta/trifecta.js';

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
