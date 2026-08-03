/**
 * §5.11 v4.00 — MCP 인벤토리: 어떤 외부 도구 서버를 물고 있는가.
 *
 * 설치 한 줄로 임의 코드와 도구 정의를 들이는 구조가 일반화되면서, 물린 서버의 목록 자체가 점검 대상이 됐다.
 * **신뢰하지 않는 서버를 무는 것**이 곧 공급망 위험이므로, 이 카드는 지금 이 에이전트에 실린 외부 도구를 센다. 표시 전용.
 */
import { defineInspector } from '../framework/inspector.js';
import { effectiveTools } from '../lethal-trifecta/trifecta.js';
import type { PluginBubbleContext } from '../types.js';

const external = (ctx: PluginBubbleContext): string[] =>
  [...effectiveTools(ctx.agentConfig)].filter((t) => t.startsWith('mcp') || t.includes('__'));

const inspector = defineInspector({
  id: 'mcp-client-inventory', i18nKey: 'mcpClientInventory', name: 'MCP Inventory', category: 'security',
  status: (ctx) => (external(ctx).length === 0 ? { key: 'none', tone: 'good' } : { key: 'attached', tone: 'warn' }),
  checks: [
    { key: 'servers', value: (ctx) => String(external(ctx).length), tone: (ctx) => (external(ctx).length > 0 ? 'warn' : 'good'), hint: (ctx) => external(ctx).join(' · ') || undefined },
    { key: 'builtin', value: (ctx) => String(effectiveTools(ctx.agentConfig).size - external(ctx).length) },
  ],
  noteKey: () => '.note',
});

export const mcpClientInventoryManifest = inspector.manifest;
export const mcpClientInventoryClient = inspector.client;
