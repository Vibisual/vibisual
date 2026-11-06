// stream-json message builders. Shapes follow the Agent SDK message types (SDKSystemMessage init, SDKAssistantMessage,
// SDKUserMessage, SDKResultMessage) on code.claude.com/docs/en/agent-sdk/typescript — required fields only, plus the
// optional ones the app reads. Keep this file the single place that knows the wire shape.
import { randomUUID } from 'node:crypto';

/**
 * @param {{ sessionId: string, cwd: string, model: string, version: string, permissionMode: string,
 *   tools: string[], plugins: { name: string, path: string }[] }} s
 */
export function systemInit(s) {
  return {
    type: 'system',
    subtype: 'init',
    uuid: randomUUID(),
    session_id: s.sessionId,
    apiKeySource: 'none',
    claude_code_version: s.version,
    cwd: s.cwd,
    tools: s.tools,
    mcp_servers: [],
    model: s.model,
    permissionMode: s.permissionMode,
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: s.plugins,
    capabilities: [],
  };
}

/** @param {string} sessionId @param {string} model @param {object[]} content */
export function assistant(sessionId, model, content) {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    session_id: sessionId,
    parent_tool_use_id: null,
    message: {
      id: `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      type: 'message',
      role: 'assistant',
      model,
      content,
      stop_reason: null,
      stop_sequence: null,
      usage: usage(),
    },
  };
}

/** @param {string} text */
export const textBlock = (text) => ({ type: 'text', text });

/** @param {string} id @param {string} name @param {object} input */
export const toolUseBlock = (id, name, input) => ({ type: 'tool_use', id, name, input });

/** @param {string} sessionId @param {string} toolUseId @param {string} text @param {boolean} isError */
export function toolResult(sessionId, toolUseId, text, isError) {
  return {
    type: 'user',
    uuid: randomUUID(),
    session_id: sessionId,
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: text, is_error: isError }] },
  };
}

/** Echo of a stream-json input message (`--replay-user-messages`). @param {string} sessionId @param {string} text */
export function userReplay(sessionId, text) {
  return {
    type: 'user',
    uuid: randomUUID(),
    session_id: sessionId,
    parent_tool_use_id: null,
    isReplay: true,
    message: { role: 'user', content: [{ type: 'text', text }] },
  };
}

/**
 * @param {{ sessionId: string, model: string, result: string, isError: boolean, numTurns: number, startedAt: number,
 *   denials: { tool_name: string, tool_use_id: string, tool_input: object }[] }} r
 */
export function result(r) {
  const duration = Math.max(1, Date.now() - r.startedAt);
  const base = {
    type: 'result',
    uuid: randomUUID(),
    session_id: r.sessionId,
    duration_ms: duration,
    duration_api_ms: duration,
    is_error: r.isError,
    num_turns: r.numTurns,
    stop_reason: r.isError ? null : 'end_turn',
    total_cost_usd: 0,
    usage: usage(),
    modelUsage: { [r.model]: { inputTokens: 12, outputTokens: 8, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0, contextWindow: 200000, maxOutputTokens: 32000 } },
    permission_denials: r.denials,
  };
  return r.isError
    ? { ...base, subtype: 'error_during_execution', errors: [r.result] }
    : { ...base, subtype: 'success', result: r.result };
}

function usage() {
  return {
    input_tokens: 12,
    output_tokens: 8,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier: 'standard',
  };
}
