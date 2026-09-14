// Per-turn Codex tool gate and stdio MCP bridge. No user/global config writes.
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

const REQUEST_TIMEOUT_MS = 10000;
// One tool call waits server-side instead of handing an unchanged status back to the model every 45s.
// CALL_WAIT_MS is half of tool_timeout_sec=3600 (codexEdgeOverrides); each lookup stays under the server's
// 120s hold cap and fetch's 300s header wait. VIBISUAL_EDGE_WAIT_TUNING is for tests only: Codex forwards
// just the env_vars listed in codexEdgeOverrides to this process.
const tuning = (() => { try { return JSON.parse(process.env.VIBISUAL_EDGE_WAIT_TUNING || '{}') ?? {}; } catch { return {}; } })();
const tuned = (value, fallback) => (Number.isFinite(value) && value >= 0 ? value : fallback);
const CALL_WAIT_MS = tuned(tuning.callWaitMs, 30 * 60 * 1000);
const LOOKUP_WAIT_MS = tuned(tuning.lookupWaitMs, 60000);
const RETRY_MIN_MS = tuned(tuning.retryMinMs, 1000);
const RETRY_MAX_MS = tuned(tuning.retryMaxMs, 10000);
const STATUS_WAIT_MAX_SECONDS = 1800;
// Same cap as DISPATCH_STATUS_GRANTS_MAX (taskEdgeDispatchJobs.ts).
const STATUS_GRANTS_MAX = 20;
const terminal = (status) => ['completed', 'error', 'cancelled'].includes(status);
const DELEGATION_TOOLS = new Set(['mcp__vibisual_edges__dispatch', 'mcp__vibisual_edges__status', 'update_plan', 'request_user_input']);

const mode = process.argv[2];
if (mode === 'gate') {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    const call = JSON.parse(raw);
    // A restricted Codex agent delegates all executable work. Shell/code tools can
    // implement Read, Grep and Write themselves, so name-only stripping is unsafe.
    if (!DELEGATION_TOOLS.has(call.tool_name)) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Vibisual tool delegation: direct tool execution is disabled for this turn. Use mcp__vibisual_edges__dispatch with a connected edge.' } }));
    } else process.stdout.write('{}');
  } catch {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Vibisual tool delegation: invalid policy input; tool blocked.' } }));
  }
} else if (mode === 'mcp') {
  const edges = JSON.parse(process.env.VIBISUAL_CODEX_EDGE_IDS || '[]');
  const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  const fail = (id, message) => send(id, { isError: true, content: [{ type: 'text', text: message }] });
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'x-vibisual-hook-token': process.env.VIBISUAL_TOKEN ?? '',
    'x-vibisual-source-agent': process.env.VIBISUAL_OWNER_AGENT_ID ?? '',
    // Ties a dispatch result to this turn: the server keeps the turn from finishing as completed until it is received.
    'x-vibisual-source-subagent': process.env.VIBISUAL_SUBAGENT_ID ?? '',
  };
  // A request deadline that also follows the tool call's own cancellation (notifications/cancelled, stdin close).
  const deadlineSignal = (parent, ms) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`request timed out after ${ms}ms`)), ms);
    const follow = () => controller.abort(parent.reason);
    if (parent?.aborted) follow();
    else parent?.addEventListener('abort', follow, { once: true });
    return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', follow); } };
  };
  const read = async (url, options = {}, timeout = REQUEST_TIMEOUT_MS) => {
    const { signal: parent, ...rest } = options;
    const deadline = deadlineSignal(parent, timeout);
    try {
      const response = await fetch(url, { ...rest, headers: { ...headers, ...rest.headers }, redirect: 'error', signal: deadline.signal });
      const text = await response.text();
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}: ${text}`), { httpStatus: response.status });
      return JSON.parse(text);
    } finally {
      deadline.dispose();
    }
  };
  const sleep = (ms, signal) => new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) { resolve(); return; }
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
  const statusUrl = (cmdId, waitMs) => {
    const url = new URL(`/api/task-edges/dispatch/${encodeURIComponent(cmdId)}`, process.env.VIBISUAL_BASE);
    if (waitMs > 0) url.searchParams.set('waitMs', String(waitMs));
    return url;
  };
  // Rejections that asking again cannot change: authentication, ownership, a job missing after an app restart.
  const lookupRejected = (httpStatus) => httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 429;
  // Waits inside this one tool call. The server holds each lookup until the job finishes or the hold expires,
  // so an unchanged status costs a lookup here rather than a model turn. Connection errors, 5xx/429 and servers
  // that answer without holding back off (RETRY_MIN_MS doubling to RETRY_MAX_MS) instead of spinning.
  const collect = async (initial, { waitMs = CALL_WAIT_MS, signal } = {}) => {
    let value = { ...initial };
    // The dispatch acknowledgement's own pending/next describe the moment it was sent; this call decides them again below.
    delete value.pending;
    delete value.next;
    const startedAt = Date.now();
    const deadline = startedAt + waitMs;
    let retryMs = RETRY_MIN_MS;
    let lookups = 0;
    let rejected = false;
    while (!terminal(value.status) && !signal?.aborted) {
      const remaining = deadline - Date.now();
      if (lookups > 0 && remaining <= 0) break;
      const holdMs = Math.max(0, Math.min(LOOKUP_WAIT_MS, remaining));
      lookups++;
      let held = false;
      try {
        const response = await read(statusUrl(value.cmdId, holdMs), { signal }, holdMs + REQUEST_TIMEOUT_MS);
        if (!response.job || response.job.cmdId !== value.cmdId) throw new Error('Invalid dispatch status response');
        value = { ...value, ...response.job };
        delete value.connectionError;
        held = response.timedOut === true;
      } catch (error) {
        if (signal?.aborted) break;
        value.connectionError = error.message;
        // Dispatching a replacement command cannot repair these either.
        if (lookupRejected(error.httpStatus)) { rejected = true; break; }
      }
      if (terminal(value.status)) break;
      if (held) { retryMs = RETRY_MIN_MS; continue; }
      await sleep(Math.min(retryMs, Math.max(0, deadline - Date.now())), signal);
      retryMs = Math.min(RETRY_MAX_MS, Math.max(1, retryMs * 2));
    }
    if (terminal(value.status)) return { ...value, ok: value.status === 'completed' && !value.usageLimit };
    if (rejected) {
      return { ...value, ok: false,
        next: 'The server rejected this status lookup, so calling status again with this cmdId will not change the answer. Do not dispatch the same work again automatically; tell the user the lookup failed (after an app restart, inspect existing work first).' };
    }
    const waitedMs = Date.now() - startedAt;
    // Pending is not success: ok stays false until the task finishes.
    return { ...value, ok: false, pending: true, waitedMs,
      next: `Not finished after waiting ${Math.round(waitedMs / 1000)}s; the task keeps running and its result stays retrievable by cmdId. Call status with this cmdId to keep waiting. Do not dispatch it again, and do not repeat an unchanged progress update to the user.` };
  };
  // A cancelled call gets no response (MCP cancellation); a pending result is not an error.
  const reply = (id, signal, value) => {
    if (signal.aborted) return;
    send(id, { ...(value.connectionError || (value.ok === false && !value.pending) ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(value) }] });
  };
  const callTool = async (request, signal) => {
    const args = request.params?.arguments;
    if (request.params?.name === 'status' && typeof args?.cmdId === 'string' && args.cmdId.trim()) {
      const waitSeconds = args.waitSeconds ?? STATUS_WAIT_MAX_SECONDS;
      if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > STATUS_WAIT_MAX_SECONDS) {
        fail(request.id, `waitSeconds must be an integer from 0 to ${STATUS_WAIT_MAX_SECONDS}.`);
        return;
      }
      reply(request.id, signal, await collect({ cmdId: args.cmdId, status: 'unknown' }, { waitMs: Math.min(CALL_WAIT_MS, waitSeconds * 1000), signal }));
      return;
    }
    if (request.params?.name !== 'dispatch' || !edges.includes(args?.edgeId) || typeof args?.instruction !== 'string' || !args.instruction.trim()) {
      fail(request.id, 'Only a connected edge and a non-empty instruction are allowed.');
      return;
    }
    const requestKey = args.requestKey ?? randomUUID();
    if (typeof requestKey !== 'string' || !requestKey.trim() || requestKey.length > 200) {
      fail(request.id, 'requestKey must be a non-empty string of at most 200 characters.');
      return;
    }
    // Delegated status grants travel as one header; the server checks each cmdId before creating the task.
    const statusCmdIds = args.statusCmdIds ?? [];
    if (!Array.isArray(statusCmdIds) || statusCmdIds.length > STATUS_GRANTS_MAX
      || statusCmdIds.some((id) => typeof id !== 'string' || id.length > 200 || !/^[\x21-\x2b\x2d-\x7e]+$/.test(id))) {
      fail(request.id, `statusCmdIds must be at most ${STATUS_GRANTS_MAX} cmdId strings (visible ASCII without commas, 200 characters each).`);
      return;
    }
    try {
      const url = new URL('/api/task-edges/dispatch', process.env.VIBISUAL_BASE);
      url.searchParams.set('edgeId', args.edgeId);
      url.searchParams.set('wait', 'false');
      // The acknowledgement itself is not cancelled: once sent, the task exists and its cmdId must come back.
      let value = await read(url, { method: 'POST', headers: { 'x-vibisual-request-key': requestKey,
        ...(statusCmdIds.length ? { 'x-vibisual-status-cmd-ids': statusCmdIds.join(',') } : {}) }, body: args.instruction });
      if (value.cmdId && value.waitForResult && !terminal(value.status)) {
        value = await collect(value, { waitMs: value.timeoutMs > 0 ? Math.min(CALL_WAIT_MS, value.timeoutMs) : CALL_WAIT_MS, signal });
      }
      reply(request.id, signal, value);
    } catch (error) {
      if (signal.aborted) return;
      // The server answers 400/401/403/404 before it creates anything (including a refused statusCmdIds grant),
      // so resending the same call cannot succeed.
      if ([400, 401, 403, 404].includes(error.httpStatus)) {
        fail(request.id, JSON.stringify({ error: error.message, requestKey,
          next: 'The server refused this dispatch and no task was created. Sending the same call again will be refused again; fix the request (statusCmdIds may list only jobs you can read yourself) or tell the user.' }));
        return;
      }
      fail(request.id, JSON.stringify({ error: error.message, requestKey,
        next: 'The task may already be running. Recover using the same edgeId, instruction, statusCmdIds and requestKey; never submit a new key. If the server restarted, inspect existing work before retrying.' }));
    }
  };
  const inflight = new Map();
  const input = createInterface({ input: process.stdin });
  // Codex closing the pipe ends every wait; the delegated tasks keep running on the server.
  input.on('close', () => { for (const controller of inflight.values()) controller.abort(); });
  input.on('line', async (line) => {
    let request;
    try { request = JSON.parse(line); } catch { return; }
    if (!request || typeof request !== 'object') return;
    if (request.id === undefined) {
      // Stops only that call's wait. The delegated task is not cancelled and stays retrievable by cmdId.
      if (request.method === 'notifications/cancelled') inflight.get(String(request.params?.requestId))?.abort();
      return;
    }
    if (request.method === 'initialize') {
      send(request.id, { protocolVersion: request.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'vibisual_edges', version: '1.0.0' } });
    } else if (request.method === 'tools/list') {
      // A turn that only received delegated status grants has no edge, so it lists status alone.
      send(request.id, { tools: [...(edges.length ? [{ name: 'dispatch', description: 'Delegate a task to a connected Vibisual agent. The target may use Claude or Codex. With a return edge this call waits for the target result (up to 30 minutes, or the edge timeout) and returns it; if the task is still running it returns pending with its cmdId.', inputSchema: {
        type: 'object', properties: { edgeId: { type: 'string', enum: edges }, instruction: { type: 'string' }, requestKey: { type: 'string', maxLength: 200, description: 'Reuse the original key only when recovering a lost dispatch acknowledgement.' }, statusCmdIds: { type: 'array', maxItems: STATUS_GRANTS_MAX, items: { type: 'string', minLength: 1, maxLength: 200 }, description: 'Optional. cmdIds of jobs you can already read that the target must check. The target may read only these, only while this delegated task runs; without them its status lookups are refused.' } }, required: ['edgeId', 'instruction'], additionalProperties: false,
      } }] : []), { name: 'status', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, description: `Wait for an existing delegated task by cmdId without executing it again. The wait happens inside this call and returns as soon as the task finishes (up to ${STATUS_WAIT_MAX_SECONDS} seconds). Call it again only when the result is still pending.`, inputSchema: {
        type: 'object', properties: { cmdId: { type: 'string', minLength: 1 }, waitSeconds: { type: 'integer', minimum: 0, maximum: STATUS_WAIT_MAX_SECONDS, description: `Optional. 0 returns the current status immediately; the default waits up to ${STATUS_WAIT_MAX_SECONDS} seconds.` } }, required: ['cmdId'], additionalProperties: false,
      } }] });
    } else if (request.method === 'tools/call') {
      const key = String(request.id);
      const controller = new AbortController();
      inflight.set(key, controller);
      try {
        await callTool(request, controller.signal);
      } finally {
        if (inflight.get(key) === controller) inflight.delete(key);
      }
    } else if (request.method === 'ping') send(request.id, {});
    else process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }) + '\n');
  });
} else if (mode === 'tool-permission') {
  const deny = (reason) => process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: `Vibisual tool permission: ${reason}. The tool was not executed.`,
  } }));
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const call = JSON.parse(raw);
    if (typeof call.tool_name !== 'string' || !process.env.VIBISUAL_BASE) throw new Error('invalid hook input or missing server');
    if (process.argv[3] === 'delegation' && !DELEGATION_TOOLS.has(call.tool_name)) {
      throw new Error('mandatory delegation blocks direct execution; use a connected agent');
    }
    const response = await fetch(new URL('/api/codex-tool-check', process.env.VIBISUAL_BASE), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(150000),
      headers: { 'Content-Type': 'application/json', 'x-vibisual-hook-token': process.env.VIBISUAL_TOKEN ?? '' },
      body: JSON.stringify({ parentAgentId: process.env.VIBISUAL_OWNER_AGENT_ID,
        subAgentId: process.env.VIBISUAL_SUBAGENT_ID, sessionId: call.session_id, cwd: call.cwd,
        toolName: call.tool_name, toolInput: call.tool_input ?? {} }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (result.decision === 'allow') process.stdout.write('{}');
    else if (result.decision === 'deny') deny(result.reason === 'user' ? 'the user selected Deny' : `blocked (${result.reason ?? 'policy'})`);
    else throw new Error('invalid permission response');
  } catch (error) { deny(`permission check unavailable (${error.message})`); }
} else if (mode === 'permission') {
  // Per-turn Codex permission bridge (PreToolUse / PermissionRequest) to the Vibisual approval
  // broker and audit ledger. It always decides: Codex treats a silent PermissionRequest hook as
  // "let the auto reviewer model decide", so every failure path denies.
  const PERMISSION_WAIT_MS = 150000;
  const event = process.argv[3];
  const out = (allow, message) => process.stdout.write(JSON.stringify(event === 'PermissionRequest'
    ? { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: allow ? { behavior: 'allow' } : { behavior: 'deny', message } } }
    : allow ? {} : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: message } }));
  const denyText = (data) => data.reason === 'timeout'
    ? 'USER PERMISSION DECISION: DENY (auto). No response within 60s in the Vibisual approval popup, so it was auto-denied (safe default). This tool was blocked and NOT executed. Tell the user verbatim that their permission decision was recorded as "DENY (timed out, no response)", then stop and ask how they want to proceed.'
    : data.reason === 'dont-ask'
    ? 'PERMISSION POLICY: DENY. This agent runs in permission mode "dontAsk" (do not prompt; deny anything not pre-approved), so the tool was blocked WITHOUT asking the user. No one pressed anything. Tell the user which tool was blocked and that the agent\'s permission mode must be changed (or the command pre-approved) to run it. Do not retry the same tool.'
    : data.reason === 'codex-no-prompt'
    ? `PERMISSION POLICY: DENY. This agent runs in permission mode "${data.mode ?? 'unknown'}", which never asks for approval, so the request to run outside the sandbox was blocked WITHOUT asking the user. No one pressed anything. Tell the user which tool was blocked and that the agent's permission mode must be changed to run it. Do not retry the same tool.`
    : data.reason === 'not-managed'
    ? 'PERMISSION POLICY: DENY. Vibisual could not find the agent that owns this Codex turn, so no one could be asked. This tool was blocked and NOT executed. Tell the user the permission check could not reach its agent.'
    : `USER PERMISSION DECISION: DENY. The user pressed "Deny" in the Vibisual approval popup. This tool was blocked and NOT executed.${data.reason ? ` User note: ${data.reason}.` : ''} In your reply, state this explicitly to the user — e.g. 'You selected: Deny — the command was not run.' Do not retry the tool unless the user explicitly asks.`;
  const unavailable = (why) => `PERMISSION CHECK UNAVAILABLE: DENY. The Vibisual permission check could not be completed (${why}), so this tool was blocked and NOT executed (safe default). Tell the user the approval check failed and ask how they want to proceed.`;
  if (event !== 'PreToolUse' && event !== 'PermissionRequest') {
    process.stderr.write('Expected PreToolUse or PermissionRequest event');
    process.exitCode = 2;
  } else {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    let call;
    try { call = JSON.parse(raw); } catch { call = undefined; }
    if (!call || typeof call !== 'object' || typeof call.tool_name !== 'string') out(false, unavailable('invalid hook input'));
    else if (!process.env.VIBISUAL_BASE) out(false, unavailable('server address missing'));
    else {
      try {
        const response = await fetch(new URL('/api/permission-check', process.env.VIBISUAL_BASE), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-vibisual-hook-token': process.env.VIBISUAL_TOKEN ?? '' },
          body: JSON.stringify({
            engine: 'codex',
            hookEvent: event,
            sessionId: call.session_id,
            parentAgentId: process.env.VIBISUAL_OWNER_AGENT_ID,
            subAgentId: process.env.VIBISUAL_SUBAGENT_ID,
            toolName: call.tool_name,
            toolInput: call.tool_input && typeof call.tool_input === 'object' ? call.tool_input : {},
            ...(typeof call.tool_use_id === 'string' ? { toolUseId: call.tool_use_id } : {}),
            cwd: call.cwd,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(PERMISSION_WAIT_MS),
        });
        const data = response.ok ? await response.json().catch(() => null) : null;
        if (!response.ok) out(false, unavailable(`HTTP ${response.status}`));
        else if (data?.decision === 'allow') out(true);
        else if (data?.decision === 'deny') out(false, denyText(data));
        else out(false, unavailable('unknown decision'));
      } catch (error) {
        out(false, unavailable(error?.name === 'TimeoutError' ? 'timed out' : 'server unreachable'));
      }
    }
  }
} else {
  process.stderr.write('Expected gate, mcp or permission mode');
  process.exitCode = 2;
}
