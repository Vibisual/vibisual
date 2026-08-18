/**
 * §5.11 v4.01 — MCP 서버 노출(MCP Server): 우리가 바깥에 열려 있는가.
 *
 * MCP 는 AI 앱이 데이터·도구에 붙는 표준 규약이고, 서버 쪽은 도구·자원·프롬프트를 노출한다.
 * **Vibisual 자체를 외부가 물 수 있는 MCP 도구로 노출하는 것은 SSOT §10 Out of Scope** 이므로 열려 있지 않다.
 *
 * 이 카드는 그 상태를 명시적으로 보여준다 — "안 하기로 한 것"도 화면에 있어야 나중에 오해가 없고,
 * 어느 날 열렸을 때 이 카드가 먼저 색을 바꾼다. 우리가 **무는 쪽**(클라이언트)은 MCP 인벤토리 카드가 맡는다.
 * 표시 전용이며, 이 카드는 노출을 켜지 않는다.
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
