import { agentPowershellRequest } from './agentRuleShell.js';

/** The builder uses the same five endpoints and payloads in both shells. */
export function harnessBuilderPowershellBlocks(args: {
  serverBase: string; centerX: number; centerY: number; radius: number; projectName: string | null;
}): string[] {
  const request = (endpoint: string, body: string, extras: Partial<Parameters<typeof agentPowershellRequest>[0]> = {}): string =>
    agentPowershellRequest({ serverBase: args.serverBase, endpoint, body, ...extras });
  return [
    request('/api/create-custom-agent', JSON.stringify({ label: 'Coder', x: Math.round(args.centerX + args.radius), y: Math.round(args.centerY), project: args.projectName }), {
      after: ['"AGENT_ID=$($Response.agent.id) AGENT_PATH=$($Response.agent.path)"'],
    }),
    request('/api/agent-config/$([Uri]::EscapeDataString($AgentId))', JSON.stringify({ model: 'sonnet', effort: 'medium', rules: '# Role: Coder\n받은 명세대로 코드를 작성한다. 완료 후 변경 파일과 요점을 보고.' }), {
      method: 'Put', before: ["$AgentId = '<1)에서 받은 AGENT_ID>'"],
    }),
    request('/api/task-edges', JSON.stringify({ sourceAgentId: '<PM_ID>', targetAgentId: '<CODER_ID>', command: '이 기능을 구현하라', forwardMode: 'manual', kind: 'command' }), {
      after: ['"EDGE_ID=$($Response.data.id)"'],
    }),
    request('/api/task-edges', JSON.stringify({ sourceAgentId: '<REVIEWER_ID>', targetAgentId: '<CODER_ID>', command: '변경을 검증하고 실패하면 REJECT와 수정 요구를 보고하라', forwardMode: 'manual', kind: 'critique', critiqueAuthority: 'force-rework' })),
    request('/api/commands/$([Uri]::EscapeDataString($AgentPath))', '<사용자 원본 요청 전문을 그대로 — JSON escape 불필요, 여러 줄 OK>', {
      contentType: 'text/plain', before: ["$AgentPath = '<1)에서 받은 AGENT_PATH>'"],
    }),
  ];
}
