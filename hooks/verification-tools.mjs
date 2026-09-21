// App-owned verification MCP bridge. Uses the same JSON-lines protocol as codex-edges.mjs.
// The server owns the target, authorization, action execution, evidence and verdict.
import { createInterface } from 'node:readline';

const REQUEST_TIMEOUT_MS = 300000;
const MAX_INFLIGHT = 16;
const idSchema = { type: 'string', minLength: 1, maxLength: 200 };
const selector = { type: 'string', minLength: 1, maxLength: 2000 };
const fraction = { type: 'number', minimum: 0, maximum: 1 };
const object = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const actionSchema = { oneOf: [
  object({ kind: { enum: ['click', 'double-click'] }, selector, x: fraction, y: fraction }, ['kind']),
  object({ kind: { const: 'fill' }, selector, text: { type: 'string' } }, ['kind', 'text']),
  object({ kind: { const: 'press' }, key: { type: 'string', minLength: 1 } }, ['kind', 'key']),
  object({ kind: { const: 'scroll' }, deltaX: { type: 'number' }, deltaY: { type: 'number' } }, ['kind', 'deltaX', 'deltaY']),
  object({ kind: { const: 'wait' }, ms: { type: 'integer', minimum: 0 } }, ['kind', 'ms']),
  object({ kind: { const: 'navigate' }, url: { type: 'string', minLength: 1 } }, ['kind', 'url']),
] };
const checkSchema = { oneOf: [
  object({ kind: { const: 'visible' }, selector }, ['kind', 'selector']),
  object({ kind: { enum: ['text', 'value'] }, selector, expected: { type: 'string' } }, ['kind', 'expected']),
  object({ kind: { const: 'url' }, expected: { type: 'string' } }, ['kind', 'expected']),
  object({ kind: { const: 'screenshot' }, referenceFrame: { type: 'integer', minimum: 0 }, region: object({ x: fraction, y: fraction, width: fraction, height: fraction }, ['x', 'y', 'width', 'height']) }, ['kind', 'referenceFrame']),
] };
const common = { runId: idSchema };
const stepIndex = { type: 'integer', minimum: 0, description: 'Zero-based index of the selected demonstration step.' };
const definitions = [
  { name: 'observe', description: 'Observe the target bound to this verification run. Returns the current screenshot and available elements. Inspect this evidence before choosing an action.', inputSchema: object(common, ['runId']), annotations: { readOnlyHint: true } },
  { name: 'act', description: 'Execute one action on the target bound to this verification run, returning actual evidence. Use selectors from observe, or normalized screenshot coordinates. Supply stepIndex to execute its stored action; action may specify an explicit action. Do not retry after an ambiguous timeout: observe first.', inputSchema: object({ ...common, stepIndex, action: actionSchema }, ['runId']) },
  { name: 'check', description: 'Check the actual current state against an expectation and record evidence. Supply stepIndex for its stored check, or an explicit check. Screenshot checks compare a reference frame from the selected demonstration.', inputSchema: object({ ...common, stepIndex, check: checkSchema }, ['runId']), annotations: { readOnlyHint: true } },
  { name: 'replay', description: 'Execute all stored actions and checks in the selected demonstration in order. Read the result and evidence. Do not retry after an ambiguous timeout: observe first.', inputSchema: object(common, ['runId']) },
  { name: 'finalize', description: 'Request the final verdict after inspecting actual evidence. The server validates its execution and check ledger; an unsupported pass becomes held or fail. Describe failures and anything that could not be checked honestly.', inputSchema: object({ ...common, verdict: { enum: ['pass', 'fail', 'held'] }, reason: { type: 'string' } }, ['runId', 'verdict']) },
];
const tools = new Map(definitions.map((definition) => [definition.name, definition]));
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const errorResult = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });
const rpcError = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
const inflight = new Map();

function connection() {
  const base = new URL(process.env.VIBISUAL_BASE ?? '');
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password) {
    throw new Error('Verification requires the app-owned loopback connection.');
  }
  const token = process.env.VIBISUAL_TOKEN || process.env.VIBISUAL_HOOK_AUTH;
  const owner = process.env.VIBISUAL_OWNER_AGENT_ID || process.env.VIBISUAL_PARENT_AGENT_ID;
  const sub = process.env.VIBISUAL_SUBAGENT_ID;
  if (!token || !owner || !sub) throw new Error('Verification connection credentials or session identity are missing.');
  return { base, headers: { 'Content-Type': 'application/json; charset=utf-8',
    'x-vibisual-hook-token': token, 'x-vibisual-source-agent': owner, 'x-vibisual-source-subagent': sub } };
}

async function callTool(request, signal) {
  const definition = tools.get(request.params?.name);
  const args = request.params?.arguments;
  if (!definition || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Unknown tool or invalid arguments.');
  const { properties, required } = definition.inputSchema;
  if (required.some((key) => args[key] === undefined) || Object.keys(args).some((key) => !(key in properties))) throw new Error('Missing or unsupported tool arguments.');
  if (typeof args.runId !== 'string' || !args.runId.trim() || args.runId.length > 200) throw new Error('runId must identify the current verification run.');
  if (args.stepIndex !== undefined && (!Number.isInteger(args.stepIndex) || args.stepIndex < 0)) throw new Error('stepIndex must be a non-negative integer.');
  if (definition.name === 'finalize' && !['pass', 'fail', 'held'].includes(args.verdict)) throw new Error('Invalid verification verdict.');
  const { base, headers } = connection();
  const response = await fetch(new URL(`/api/verification-tools/${definition.name}`, base), {
    method: 'POST', headers, body: JSON.stringify(args), signal, redirect: 'error',
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Verification HTTP ${response.status}: ${raw.slice(0, 2000)}`);
  const value = JSON.parse(raw);
  if (!value || !Array.isArray(value.content) || value.content.some((item) => !item ||
      (item.type !== 'text' || typeof item.text !== 'string') &&
      (item.type !== 'image' || typeof item.data !== 'string' || typeof item.mimeType !== 'string'))) {
    throw new Error('The verification server returned invalid evidence.');
  }
  // Forward MCP image content itself, not JSON containing a base64 string that models cannot see.
  return { content: value.content, ...(value.isError === true ? { isError: true } : {}) };
}

const input = createInterface({ input: process.stdin });
input.on('close', () => { for (const controller of inflight.values()) controller.abort(); });
input.on('line', async (line) => {
  let request;
  try { request = JSON.parse(line); } catch { rpcError(null, -32700, 'Parse error'); return; }
  if (!request || typeof request !== 'object') return;
  if (request.id === undefined) {
    if (request.method === 'notifications/cancelled') inflight.get(String(request.params?.requestId))?.abort();
    return;
  }
  if (request.method === 'initialize') {
    send(request.id, { protocolVersion: request.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'vibisual_verify', version: '1.0.0' } });
  } else if (request.method === 'tools/list') send(request.id, { tools: definitions });
  else if (request.method === 'ping') send(request.id, {});
  else if (request.method === 'tools/call') {
    const key = String(request.id);
    if (inflight.has(key) || inflight.size >= MAX_INFLIGHT) { rpcError(request.id, -32600, 'Too many calls or duplicate request id'); return; }
    const controller = new AbortController();
    inflight.set(key, controller);
    const timer = setTimeout(() => controller.abort(new Error('Verification timed out. An action may already have executed; observe before deciding whether to retry.')), REQUEST_TIMEOUT_MS);
    try {
      const result = await callTool(request, controller.signal);
      if (!controller.signal.aborted) send(request.id, result);
    } catch (error) {
      // Cancellation has no response; a deadline does, so the engine does not wait forever.
      if (!controller.signal.aborted || controller.signal.reason?.message?.startsWith('Verification timed out.')) {
        send(request.id, errorResult(error instanceof Error ? error.message : String(error)));
      }
    } finally {
      clearTimeout(timer);
      inflight.delete(key);
    }
  } else rpcError(request.id, -32601, 'Method not found');
});
