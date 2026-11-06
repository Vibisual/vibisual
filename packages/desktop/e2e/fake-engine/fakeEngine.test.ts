import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { installFakeEngines, shimsFor } from './install.mjs';
import { parseArgs, helpText } from './official-cli.mjs';
import { ifMatches, interpolateHeader, matcherMatches } from './hooks.mjs';
import { parseOverrides, parseTomlValue } from './toml-inline.mjs';

const FAKE = path.join(__dirname, 'fake-claude.mjs');
const scratch: string[] = [];
function temp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-fake-engine-'));
  scratch.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

interface Run { code: number | null; stdout: string; stderr: string }

function runFake(args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; stdin?: string }): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [FAKE, ...args], { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(o.stdin ?? '');
  });
}

function fixture() {
  const root = temp();
  const cwd = path.join(root, 'project');
  const state = path.join(root, 'state');
  const config = path.join(root, 'claude-config');
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(config, { recursive: true });
  const scenario = path.join(root, 'scenario.json');
  fs.writeFileSync(scenario, JSON.stringify({
    stepDelayMs: 0,
    turns: [{
      match: 'make-file',
      steps: [
        { text: 'Writing.' },
        { tool: 'Write', input: { file_path: 'out.txt', content: 'hi\n' } },
        { text: 'Written.' },
      ],
      result: 'Written.',
    }],
  }));
  const env = {
    ...process.env,
    VIBISUAL_FAKE_ENGINE_STATE: state,
    VIBISUAL_FAKE_ENGINE_SCENARIO: scenario,
    CLAUDE_CONFIG_DIR: config,
  };
  return { root, cwd, state, config, env };
}

const lines = (s: string) => s.split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('official CLI contract', () => {
  it('parses the spawn shape the app uses and leaves the prompt alone', () => {
    const r = parseArgs(['--resume', 'abc', '--print', '--model', 'opus', '--allowedTools', 'Read', 'Edit', '--input-format', 'stream-json', '-p', 'hello']);
    expect(r.unknown).toEqual([]);
    expect(r.flags['--resume']).toBe('abc');
    expect(r.flags['--allowedTools']).toEqual(['Read', 'Edit']);
    expect(r.positionals).toEqual(['hello']);
  });
  it('reports options the official table does not list', () => {
    expect(parseArgs(['--print', '--not-a-flag']).unknown).toEqual(['--not-a-flag']);
  });
  it('lists every flag in --help so the app capability probe sees the same table', () => {
    const help = helpText();
    for (const flag of ['--include-partial-messages', '--replay-user-messages', '--plugin-dir', '--append-system-prompt-file']) {
      expect(help).toContain(flag);
    }
  });
});

describe('hook semantics', () => {
  it('matches like the documented matcher', () => {
    expect(matcherMatches(undefined, 'Write')).toBe(true);
    expect(matcherMatches('*', 'Write')).toBe(true);
    expect(matcherMatches('Edit|Write', 'Write')).toBe(true);
    expect(matcherMatches('Edit|Write', 'Read')).toBe(false);
    expect(matcherMatches('mcp__.*', 'mcp__x__y')).toBe(true);
    expect(ifMatches('Bash(git *)', 'Bash')).toBe(true);
    expect(ifMatches('Edit|Write', 'Read')).toBe(false);
  });
  it('interpolates only allowed variables into headers', () => {
    const env = { A: '1', B: '2' };
    expect(interpolateHeader('$A-${B}', ['A'], env)).toBe('1-');
  });
});

describe('launchers', () => {
  it.each(['win32', 'darwin', 'linux'] as const)('writes the %s launcher form', (platform) => {
    const shims = shimsFor({ engine: 'claude', node: '/n/node', script: '/s/fake-claude.mjs', stateDir: '/st', scenarioFile: '/sc.json', platform });
    expect(shims).toHaveLength(1);
    const [name, body] = shims[0];
    if (platform === 'win32') {
      expect(name).toBe('claude.cmd');
      expect(body).toContain('%*');
      expect(body).toContain('\r\n');
    } else {
      expect(name).toBe('claude');
      expect(body.startsWith('#!/bin/sh\n')).toBe(true);
      expect(body).toContain('"$@"');
    }
  });
  it('answers --version through the installed launcher on this OS', () => {
    const root = temp();
    const { files } = installFakeEngines({ binDir: path.join(root, 'bin'), stateDir: path.join(root, 'state'), scenarioFile: '' });
    const launcher = files.find((f) => path.basename(f).startsWith('claude'))!;
    // A test harness may use the shell for a .cmd; the app must not need to (see claudeEngineSpawn).
    const r = spawnSync(launcher, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+ \(Claude Code\)$/);
  });
});

describe('print mode', () => {
  it('plays a turn as stream-json with replay receipts, partials and a success result', async () => {
    const f = fixture();
    const uuid = '11111111-2222-4333-8444-555555555555';
    const input = `${JSON.stringify({ type: 'user', uuid, message: { role: 'user', content: [{ type: 'text', text: 'please make-file' }] } })}\n`;
    const r = await runFake(['--print', '--include-partial-messages', '--replay-user-messages', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], { cwd: f.cwd, env: f.env, stdin: input });
    expect(r.code, r.stderr).toBe(0);
    const msgs = lines(r.stdout);
    expect(msgs[0]).toMatchObject({ type: 'system', subtype: 'init', cwd: f.cwd });
    const sessionId = msgs[0].session_id;
    expect(msgs.every((m) => m.session_id === sessionId)).toBe(true);
    expect(msgs.find((m) => m.type === 'user' && m.isReplay)).toMatchObject({ uuid });
    expect(msgs.some((m) => m.type === 'stream_event' && m.event.type === 'content_block_delta')).toBe(true);
    const toolUse = msgs.find((m) => m.type === 'assistant' && m.message.content[0].type === 'tool_use');
    expect(toolUse.message.content[0]).toMatchObject({ name: 'Write', input: { file_path: path.join(f.cwd, 'out.txt') } });
    const last = msgs[msgs.length - 1];
    expect(last).toMatchObject({ type: 'result', subtype: 'success', is_error: false, result: 'Written.', user_message_uuid: uuid });
    expect(fs.readFileSync(path.join(f.cwd, 'out.txt'), 'utf8')).toBe('hi\n');
    const slug = f.cwd.replace(/[^a-zA-Z0-9]/g, '-');
    expect(fs.existsSync(path.join(f.config, 'projects', slug, `${sessionId}.jsonl`))).toBe(true);
    const calls = lines(fs.readFileSync(path.join(f.state, 'claude-calls.jsonl'), 'utf8'));
    expect(calls[0]).toMatchObject({ kind: 'invoke', unknownFlags: [] });
  });

  it('rejects an option the official CLI does not have', async () => {
    const f = fixture();
    const r = await runFake(['--print', '--bogus'], { cwd: f.cwd, env: f.env });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("error: unknown option '--bogus'");
  });

  it('reports auth status as documented JSON', async () => {
    const f = fixture();
    const r = await runFake(['auth', 'status'], { cwd: f.cwd, env: f.env });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ loggedIn: true, authMethod: 'claude.ai', configDirectory: f.config });
  });

  it('runs settings.json hooks: http with allowed env headers, command in exec form, deny honoured', async () => {
    const f = fixture();
    const received: { headers: http.IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (d) => { data += d; });
      req.on('end', () => {
        received.push({ headers: req.headers, body: JSON.parse(data) });
        res.end('');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    const denyScript = path.join(f.root, 'deny.mjs');
    fs.writeFileSync(denyScript, [
      "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{",
      "const p=JSON.parse(d);",
      "if(p.tool_name==='Write')process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'e2e says no'}}));",
      '});',
    ].join(''));
    fs.writeFileSync(path.join(f.config, 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: process.execPath, args: [denyScript], timeout: 30 }] }],
        PostToolUse: [{ hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/api/hook-event`, headers: { 'x-owner': '$VIBISUAL_OWNER_AGENT_ID', 'x-leak': '$HOME' }, allowedEnvVars: ['VIBISUAL_OWNER_AGENT_ID'] }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/api/hook-event` }] }],
      },
    }));
    const env = { ...f.env, VIBISUAL_OWNER_AGENT_ID: 'agent-e2e' };
    const r = await runFake(['-p', 'make-file', '--output-format', 'stream-json', '--verbose'], { cwd: f.cwd, env });
    server.close();
    expect(r.code, r.stderr).toBe(0);
    const msgs = lines(r.stdout);
    const denied = msgs.find((m) => m.type === 'user' && m.message.content[0].type === 'tool_result');
    expect(denied.message.content[0]).toMatchObject({ is_error: true });
    expect(msgs[msgs.length - 1].permission_denials).toHaveLength(1);
    expect(fs.existsSync(path.join(f.cwd, 'out.txt'))).toBe(false);
    const submit = received.find((x) => x.body.hook_event_name === 'UserPromptSubmit');
    expect(submit?.body).toMatchObject({ prompt: 'make-file', cwd: f.cwd, permission_mode: 'default' });
    expect(typeof submit?.body.session_id).toBe('string');
    expect(typeof submit?.body.transcript_path).toBe('string');
    // The denied Write never ran, so it never produced a PostToolUse.
    expect(received.some((x) => x.body.hook_event_name === 'PostToolUse')).toBe(false);
  });

  it('sends PostToolUse with the documented fields when the tool runs', async () => {
    const f = fixture();
    const received: { headers: http.IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (d) => { data += d; });
      req.on('end', () => {
        received.push({ headers: req.headers, body: JSON.parse(data) });
        res.end('');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    const hook = { type: 'http', url: `http://127.0.0.1:${port}/x`, headers: { 'x-owner': '$VIBISUAL_OWNER_AGENT_ID', 'x-leak': '$HOME' }, allowedEnvVars: ['VIBISUAL_OWNER_AGENT_ID'] };
    fs.writeFileSync(path.join(f.config, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Write', hooks: [hook] }], PostToolUse: [{ hooks: [hook] }] } }));
    const r = await runFake(['-p', 'make-file', '--output-format', 'json'], { cwd: f.cwd, env: { ...f.env, VIBISUAL_OWNER_AGENT_ID: 'agent-e2e' } });
    server.close();
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ type: 'result', subtype: 'success' });
    const pre = received.find((x) => x.body.hook_event_name === 'PreToolUse');
    const post = received.find((x) => x.body.hook_event_name === 'PostToolUse');
    expect(pre?.body).toMatchObject({ tool_name: 'Write', tool_input: { file_path: path.join(f.cwd, 'out.txt') } });
    expect(post?.body).toMatchObject({ tool_name: 'Write', tool_use_id: pre?.body.tool_use_id });
    expect(post?.headers['x-owner']).toBe('agent-e2e');
    expect(post?.headers['x-leak']).toBe('');
  });
});

describe('codex app-server', () => {
  const CODEX = path.join(__dirname, 'fake-codex.mjs');

  it('answers the version and login probes the app parses', () => {
    const f = fixture();
    const v = spawnSync(process.execPath, [CODEX, '--version'], { encoding: 'utf8', env: f.env });
    expect(v.stdout.trim()).toMatch(/^codex-cli \d+\.\d+\.\d+$/);
    const l = spawnSync(process.execPath, [CODEX, 'login', 'status'], { encoding: 'utf8', env: f.env });
    expect(l.status).toBe(0);
    expect(l.stdout.toLowerCase()).toContain('logged in using chatgpt');
  });

  it('plays a turn over JSON-RPC: handshake, thread, items, usage, completion', async () => {
    const f = fixture();
    fs.writeFileSync(f.env.VIBISUAL_FAKE_ENGINE_SCENARIO!, JSON.stringify({
      codex: { stepDelayMs: 0, turns: [{ match: 'note', steps: [{ text: 'Adding.' }, { fileChange: { path: 'n.txt', content: 'x' } }] }] },
    }));
    const child = spawn(process.execPath, [CODEX, 'app-server', '-c', 'model="x"'], { cwd: f.cwd, env: f.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const messages: any[] = [];
    let buf = '';
    const waiters: { test: (m: any) => boolean; resolve: (m: any) => void }[] = [];
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const m = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        messages.push(m);
        for (const w of [...waiters]) if (w.test(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
      }
    });
    const wait = (test: (m: any) => boolean) => new Promise<any>((resolve) => {
      const hit = messages.find(test);
      if (hit) resolve(hit); else waiters.push({ test, resolve });
    });
    const call = (id: number, method: string, params: object) => {
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      return wait((m) => m.id === id);
    };
    expect((await call(1, 'initialize', { clientInfo: { name: 't', version: '1' } })).result.userAgent).toContain('codex');
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
    expect((await call(2, 'config/read', { cwd: f.cwd })).result.config).toBeTypeOf('object');
    const models = (await call(3, 'model/list', { limit: 20 })).result;
    expect(models.data[0]).toMatchObject({ model: expect.any(String), isDefault: true });
    expect(models.nextCursor).toBeNull();
    const thread = (await call(4, 'thread/start', { cwd: f.cwd })).result.thread;
    const turn = (await call(5, 'turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'add the note' }] })).result.turn;
    expect(turn.status).toBe('inProgress');
    const done = await wait((m) => m.method === 'turn/completed');
    expect(done.params.turn).toMatchObject({ id: turn.id, status: 'completed' });
    expect(messages.some((m) => m.method === 'item/completed' && m.params.item.type === 'agentMessage' && m.params.item.text === 'Adding.')).toBe(true);
    expect(messages.some((m) => m.method === 'item/completed' && m.params.item.type === 'fileChange' && m.params.item.status === 'completed')).toBe(true);
    expect(messages.some((m) => m.method === 'thread/tokenUsage/updated')).toBe(true);
    expect(messages.every((m) => !('jsonrpc' in m))).toBe(true);
    expect(fs.readFileSync(path.join(f.cwd, 'n.txt'), 'utf8')).toBe('x');
    expect((await call(6, 'no/such', {})).error.code).toBe(-32601);
    // Windows keeps the cwd locked until the process is gone.
    const closed = new Promise((r) => child.on('close', r));
    child.stdin.end();
    await closed;
  }, 15_000);
});

describe('codex -c overrides and hook trust', () => {
  const CODEX = path.join(__dirname, 'fake-codex.mjs');

  it('reads the TOML inline values the app passes with -c', () => {
    const cmd = '& "C:\Program Files\nodejs\node.exe" "C:\app\codex-edges.mjs" permission PreToolUse';
    const override = `[{hooks=[{type="command",command=${JSON.stringify(cmd)},timeout=180}]}]`;
    expect(parseTomlValue(override)).toEqual([{ hooks: [{ type: 'command', command: cmd, timeout: 180 }] }]);
    expect(parseTomlValue('{"session_flags:preToolUse:0:0"={trusted_hash="abc"}}')).toEqual({ 'session_flags:preToolUse:0:0': { trusted_hash: 'abc' } });
    expect(parseTomlValue('["a","b"]')).toEqual(['a', 'b']);
    expect(parseTomlValue('true')).toBe(true);
    expect(parseTomlValue('not toml at all')).toBe('not toml at all');
    expect(parseOverrides(['app-server', '-c', 'features.hooks=true', '-c', 'mcp_servers.x.args=["m"]'])).toEqual({ features: { hooks: true }, mcp_servers: { x: { args: ['m'] } } });
  });

  async function listOnce(cwd: string, env: NodeJS.ProcessEnv, overrides: string[]): Promise<any[]> {
    const child = spawn(process.execPath, [CODEX, 'app-server', ...overrides], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    const result = await new Promise<any[]>((resolve) => {
      child.stdout.on('data', (d) => {
        buf += d;
        for (const line of buf.split('\n').slice(0, -1)) {
          const m = JSON.parse(line);
          if (m.id === 1) {
            child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
            child.stdin.write(`${JSON.stringify({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } })}\n`);
          } else if (m.id === 2) resolve(m.result.data.flatMap((e: any) => e.hooks));
        }
        buf = buf.slice(buf.lastIndexOf('\n') + 1);
      });
      child.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: {} })}\n`);
    });
    const closed = new Promise((r) => child.on('close', r));
    child.stdin.end();
    await closed;
    return result;
  }

  it('lists app hooks untrusted, then trusted once hooks.state pins the same hash (the app checks twice)', async () => {
    const f = fixture();
    const hook = ['-c', 'features.hooks=true', '-c', `hooks.PreToolUse=[{hooks=[{type="command",command=${JSON.stringify('node gate.mjs')},timeout=10}]}]`];
    const first = await listOnce(f.cwd, f.env, hook);
    expect(first).toEqual([expect.objectContaining({ eventName: 'preToolUse', command: 'node gate.mjs', enabled: true, trustStatus: 'untrusted' })]);
    const trust = ['-c', `hooks.state={${JSON.stringify(first[0].key)}={trusted_hash=${JSON.stringify(first[0].currentHash)}}}`];
    const second = await listOnce(f.cwd, f.env, [...hook, ...trust]);
    expect(second[0]).toMatchObject({ key: first[0].key, currentHash: first[0].currentHash, trustStatus: 'trusted' });
    const off = await listOnce(f.cwd, f.env, hook.slice(2));
    expect(off[0].enabled).toBe(false);
  }, 15_000);
});
