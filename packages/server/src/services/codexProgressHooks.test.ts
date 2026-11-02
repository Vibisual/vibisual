import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { codexTurnHooks, type CodexProgressHookConfig } from './codexEdges.js';

const helperPath = fileURLToPath(new URL('../../../../hooks/codex-edges.mjs', import.meta.url));
const progress: CodexProgressHookConfig = { helperPath, nodeBin: process.execPath };
const servers: Server[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function listen(listener: RequestListener): Promise<string> {
  const server = createServer(listener);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function notify(event: string, input: unknown, base: string, env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [helperPath, 'progress', event], {
      env: {
        ...process.env,
        VIBISUAL_BASE: base, VIBISUAL_TOKEN: 'test-token',
        VIBISUAL_OWNER_AGENT_ID: 'parent', VIBISUAL_SUBAGENT_ID: 'sub',
        VIBISUAL_CODEX_COMMAND_ID: 'cmd-current', ...env,
      },
      stdio: 'pipe', windowsHide: true,
    });
    children.push(child);
    let stdout = '', stderr = '';
    const deadline = setTimeout(() => { child.kill(); reject(new Error('progress helper did not exit')); }, 5000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => { clearTimeout(deadline); reject(error); });
    child.once('close', (code) => { clearTimeout(deadline); resolve({ code, stdout, stderr }); });
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}

describe('Codex progress hooks', () => {
  it('merges status hooks into the existing tool gate and retains permission hooks', () => {
    const edge = { ...progress, edgeIds: ['edge'], restrictedTools: ['Read'] };
    const permission = { ...progress, required: true };
    const hooks = codexTurnHooks(edge, permission, 'linux', undefined, progress);
    const pre = hooks.overrides.filter((arg) => arg.startsWith('hooks.PreToolUse='));
    expect(pre).toHaveLength(1);
    expect(pre[0]).toContain('gate');
    expect(pre[0]).toContain('progress');
    expect(pre[0]).not.toContain('permission');
    expect(hooks.overrides.some((arg) => arg.startsWith('hooks.PermissionRequest='))).toBe(true);
    expect(hooks.expected.map((hook) => hook.eventName).sort()).toEqual([
      'permissionRequest', 'postCompact', 'postToolUse', 'preCompact', 'preToolUse', 'preToolUse',
    ]);
    expect(hooks.overrides.join('\n')).not.toContain('PostToolUseFailure');
    expect(hooks.overrides.join('\n')).not.toMatch(/bypass|sandbox|approval_policy/);
  });

  it('adds no hooks when optional progress is absent', () => {
    expect(codexTurnHooks(undefined, undefined)).toEqual({ overrides: [], expected: [] });
    const hooks = codexTurnHooks(undefined, undefined, 'linux', undefined, progress);
    expect(hooks.expected.map((hook) => hook.eventName).sort())
      .toEqual(['postCompact', 'postToolUse', 'preCompact', 'preToolUse']);
  });

  it.each(['PreCompact', 'PostCompact', 'PreToolUse', 'PostToolUse'])(
    'forwards %s ownership metadata without tool contents or server output', async (event) => {
      const received: unknown[] = [];
      const base = await listen(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        received.push({ url: req.url, token: req.headers['x-vibisual-hook-token'], body: JSON.parse(body) });
        // Status telemetry must never forward a server instruction to Codex.
        res.end(JSON.stringify({ continue: false, systemMessage: 'server-only-secret' }));
      });
      const result = await notify(event, {
        hook_event_name: event, session_id: 'thread', tool_name: 'collaborationwait_agent', tool_use_id: 'call-1',
        tool_input: { prompt: 'private-prompt' }, tool_response: 'private-result', cwd: '/private/path',
        transcript_path: '/private/transcript', last_assistant_message: 'private-reply',
      }, base);
      expect(result).toEqual({ code: 0, stdout: '{}', stderr: '' });
      expect(received).toEqual([{
        url: '/api/codex-progress', token: 'test-token', body: {
          parentAgentId: 'parent', subAgentId: 'sub', commandId: 'cmd-current', sessionId: 'thread',
          hookEventName: event, toolName: 'collaborationwait_agent', toolUseId: 'call-1',
        },
      }]);
    },
  );

  it('ignores invalid, mismatched, unsupported, or unowned inputs', async () => {
    let requests = 0;
    const base = await listen((_req, res) => { requests++; res.end('{}'); });
    const input = { hook_event_name: 'PreCompact', session_id: 'thread' };
    for (const [event, body, env] of [
      ['PreCompact', 'not json', {}],
      ['PreCompact', { ...input, hook_event_name: 'PostCompact' }, {}],
      ['PostToolUseFailure', { ...input, hook_event_name: 'PostToolUseFailure' }, {}],
      ['PreCompact', input, { VIBISUAL_CODEX_COMMAND_ID: '' }],
      ['PreCompact', input, { VIBISUAL_SUBAGENT_ID: '' }],
    ] as const) {
      expect(await notify(event, body, base, env)).toEqual({ code: 0, stdout: '{}', stderr: '' });
    }
    expect(requests).toBe(0);
  });

  it('cannot interrupt work when the status endpoint rejects or stalls', async () => {
    let requests = 0;
    const base = await listen((_req, res) => {
      requests++;
      if (requests === 1) { res.writeHead(403); res.end('private error'); }
      // The second request deliberately never gets a response.
    });
    const input = { hook_event_name: 'PreCompact', session_id: 'thread' };
    expect(await notify('PreCompact', input, base)).toEqual({ code: 0, stdout: '{}', stderr: '' });
    const started = Date.now();
    expect(await notify('PreCompact', input, base)).toEqual({ code: 0, stdout: '{}', stderr: '' });
    expect(Date.now() - started).toBeLessThan(4000);
    expect(requests).toBe(2);
  });

  it('does not follow redirects with the hook credential', async () => {
    let followed = 0;
    const destination = await listen((_req, res) => { followed++; res.end('{}'); });
    const base = await listen((_req, res) => { res.writeHead(307, { Location: destination }); res.end(); });
    expect(await notify('PostCompact', { hook_event_name: 'PostCompact', session_id: 'thread' }, base))
      .toEqual({ code: 0, stdout: '{}', stderr: '' });
    expect(followed).toBe(0);
  });
});
