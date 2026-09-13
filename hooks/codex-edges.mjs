// Per-turn Codex tool gate and stdio MCP bridge. No user/global config writes.
import { createInterface } from 'node:readline';

const mode = process.argv[2];
if (mode === 'gate') {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    const call = JSON.parse(raw);
    // A restricted Codex agent delegates all executable work. Shell/code tools can
    // implement Read, Grep and Write themselves, so name-only stripping is unsafe.
    const allowed = new Set(['mcp__vibisual_edges__dispatch', 'update_plan', 'request_user_input']);
    if (!allowed.has(call.tool_name)) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Vibisual tool delegation: direct tool execution is disabled for this turn. Use mcp__vibisual_edges__dispatch with a connected edge.' } }));
    } else process.stdout.write('{}');
  } catch {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Vibisual tool delegation: invalid policy input; tool blocked.' } }));
  }
} else if (mode === 'mcp') {
  const edges = JSON.parse(process.env.VIBISUAL_CODEX_EDGE_IDS || '[]');
  const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  const fail = (id, message) => send(id, { isError: true, content: [{ type: 'text', text: message }] });
  const input = createInterface({ input: process.stdin });
  input.on('line', async (line) => {
    let request;
    try { request = JSON.parse(line); } catch { return; }
    if (request.id === undefined) return;
    if (request.method === 'initialize') {
      send(request.id, { protocolVersion: request.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'vibisual_edges', version: '1.0.0' } });
    } else if (request.method === 'tools/list') {
      send(request.id, { tools: [{ name: 'dispatch', description: 'Delegate a task to a connected Vibisual agent. The target may use Claude or Codex. Returns dispatch status or the target result when a return edge is connected.', inputSchema: {
        type: 'object', properties: { edgeId: { type: 'string', enum: edges }, instruction: { type: 'string' } }, required: ['edgeId', 'instruction'], additionalProperties: false,
      } }] });
    } else if (request.method === 'tools/call') {
      const args = request.params?.arguments;
      if (request.params?.name !== 'dispatch' || !edges.includes(args?.edgeId) || typeof args?.instruction !== 'string' || !args.instruction.trim()) {
        fail(request.id, 'Only a connected edge and a non-empty instruction are allowed.');
        return;
      }
      try {
        const url = new URL('/api/task-edges/dispatch', process.env.VIBISUAL_BASE);
        url.searchParams.set('edgeId', args.edgeId);
        const response = await fetch(url, { method: 'POST', headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'x-vibisual-hook-token': process.env.VIBISUAL_TOKEN ?? '',
          'x-vibisual-source-agent': process.env.VIBISUAL_OWNER_AGENT_ID ?? '',
        }, body: args.instruction });
        const text = await response.text();
        send(request.id, { ...(response.ok ? {} : { isError: true }), content: [{ type: 'text', text }] });
      } catch (error) { fail(request.id, `Edge dispatch failed: ${error.message}`); }
    } else if (request.method === 'ping') send(request.id, {});
    else process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }) + '\n');
  });
} else {
  process.stderr.write('Expected gate or mcp mode');
  process.exitCode = 2;
}
