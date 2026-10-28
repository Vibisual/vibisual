/**
 * §5.11 — MCP 서버 노출: 바깥에 MCP 도구로 노출하는 것은 SSOT §10 Out of Scope 라 닫혀 있다 — 안 하기로 한 것도 화면에 두고, 열리면 이 카드가 먼저 색을 바꾼다.
 * 무는 쪽(클라이언트)은 MCP 인벤토리 카드가 맡는다. 표시 전용 — 이 카드는 노출을 켜지 않는다.
 */
import { defineInspector } from '../sdk/index.js';

const inspector = defineInspector({
  id: 'mcp-server',
  i18nKey: 'mcpServer',
  name: 'MCP Server',
  category: 'security',
  status: () => ({ key: 'notExposed', tone: 'good' }),
  checks: [
    { key: 'exposed', value: (ctx) => ctx.t('panel.plugins.mcpServer.no'), tone: () => 'good' },
    { key: 'scope', value: (ctx) => ctx.t('panel.plugins.mcpServer.outOfScope') },
    { key: 'client', value: (ctx) => ctx.t('panel.plugins.mcpServer.clientCard') },
  ],
  noteKey: () => '.note',
});

export const mcpServerManifest = inspector.manifest;
export const mcpServerClient = inspector.client;
