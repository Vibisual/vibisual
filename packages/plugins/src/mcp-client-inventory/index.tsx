/** §5.11 — MCP 인벤토리: 이 에이전트에 실린 외부 도구 서버를 센다(신뢰하지 않는 서버를 무는 것이 공급망 위험). 표시 전용. */
import { defineInspector } from '../sdk/index.js';
import { effectiveTools } from '../sdk/index.js';
import type { PluginBubbleContext } from '../sdk/index.js';

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
