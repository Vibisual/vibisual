import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { appNodeRuntimeIn } from './appNodeRuntime.js';
import { claudeHookInvocation } from './claudeHookRuntime.js';
import { buildVibisualBlocks } from './hookInstaller.js';

const { runtime } = vi.hoisted(() => ({ runtime: vi.fn() }));
vi.mock('./appNodeRuntime.js', async (original) => ({
  ...await original<typeof import('./appNodeRuntime.js')>(), getAppNodeRuntime: runtime,
}));
vi.mock('./binLocator.js', () => ({ resolveBinary: () => null }));

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Claude hooks on a fresh machine without system Node', () => {
  it.each(['win32', 'darwin', 'linux'] as const)('%s retains an installed Node without shell wrapping', (platform) => {
    expect(claudeHookInvocation({ nodeBin: '/fixture/node' }, ['helper.mjs', '--token', 'fixture'], platform))
      .toEqual({ command: '/fixture/node', args: ['helper.mjs', '--token', 'fixture'] });
  });

  it.each(['PreToolUse', 'UserPromptSubmit', 'Stop', 'SessionStart'] as const)(
    '%s receives the app runtime in both hook transports', (event) => {
      runtime.mockReturnValue(appNodeRuntimeIn(null, '/fixture/Vibisual', true));
      const before = process.env['ELECTRON_RUN_AS_NODE'];
      for (const transport of ['command', 'http'] as const) {
        const entry = buildVibisualBlocks(event, 50000, '/fixture/handler.mjs', 'fixture-token', transport)[0]!.hooks[0]!;
        if (entry.type === 'http') continue;
        expect(entry.command).not.toBe('node');
        expect(JSON.stringify(entry)).toContain(process.platform === 'win32' ? 'EncodedCommand' : 'ELECTRON_RUN_AS_NODE=1');
      }
      expect(process.env['ELECTRON_RUN_AS_NODE']).toBe(before);
    },
  );

  it.each(['darwin', 'linux'] as const)('%s passes literal paths through env exec arguments', (platform) => {
    const args = ['/app space/$folder`/handler.mjs', '--server', 'http://127.0.0.1:50000'];
    expect(claudeHookInvocation(appNodeRuntimeIn(null, '/app space/Vibisual', true), args, platform))
      .toEqual({ command: '/usr/bin/env', args: ['ELECTRON_RUN_AS_NODE=1', '/app space/Vibisual', ...args] });
  });

  it('the runtime wrapper preserves UTF-8 stdin, literal arguments, stdout and the helper exit code', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibi hook $literal`' "));
    dirs.push(dir);
    const helper = path.join(dir, 'probe.cjs');
    fs.writeFileSync(helper, `let input=''; process.stdin.on('data',c=>input+=c); process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({input,args:process.argv.slice(2),mode:process.env.ELECTRON_RUN_AS_NODE}));process.exitCode=17;});`);
    const invocation = claudeHookInvocation(appNodeRuntimeIn(null, process.execPath, true),
      [helper, '$literal`with\'quote', '한글 경로'], process.platform, process.env['SystemRoot']);
    const child = spawnSync(invocation.command, invocation.args, {
      input: '{"prompt":"한글 € approval"}', encoding: 'utf8', windowsHide: true, timeout: 10_000,
    });
    expect(child.error).toBeUndefined();
    expect(child.stderr).toBe('');
    expect(child.status).toBe(17);
    expect(JSON.parse(child.stdout)).toEqual({ input: '{"prompt":"한글 € approval"}',
      args: ['$literal`with\'quote', '한글 경로'], mode: '1' });
  });

  it('the real handler clears Electron mode before any resumed CLI or status-line child can inherit it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-hook-mode-'));
    dirs.push(dir);
    const helper = path.join(dir, 'probe.mjs');
    const handler = fileURLToPath(new URL('../../../../hooks/handler.mjs', import.meta.url));
    fs.writeFileSync(helper, `process.env.VIBISUAL_USAGE_PROBE='1'; await import(${JSON.stringify(pathToFileURL(handler).href)}); process.stdout.write(JSON.stringify({mode:process.env.ELECTRON_RUN_AS_NODE ?? null}));`);
    const invocation = claudeHookInvocation(appNodeRuntimeIn(null, process.execPath, true), [helper],
      process.platform, process.env['SystemRoot']);
    const child = spawnSync(invocation.command, invocation.args, { encoding: 'utf8', timeout: 10_000, windowsHide: true });
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({ mode: null });
  });

  it('all three synchronous hooks reach a loopback fixture through the real handler without external Node discovery', async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        seen.push(req.url ?? '');
        res.setHeader('Content-Type', 'application/json');
        if (req.headers['x-vibisual-hook-token'] !== 'fixture-token') { res.writeHead(401); res.end('{}'); return; }
        if (req.url === '/api/permission-check') res.end(JSON.stringify({ decision: 'allow', reason: 'not-managed' }));
        else if (req.url?.endsWith('/pop')) res.end(JSON.stringify({ command: null }));
        else res.end(JSON.stringify({ hookSpecificOutput: { additionalContext: 'fixture 규칙' } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture port missing');
    runtime.mockReturnValue(appNodeRuntimeIn(null, process.execPath, true));
    const handler = fileURLToPath(new URL('../../../../hooks/handler.mjs', import.meta.url));
    try {
      for (const event of ['PreToolUse', 'UserPromptSubmit', 'Stop'] as const) {
        const entry = buildVibisualBlocks(event, address.port, handler, 'fixture-token', 'http')[0]!.hooks[0]!;
        if (entry.type !== 'command') throw new Error('synchronous hook missing');
        const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
          const child = spawn(entry.command, entry.args, { windowsHide: true,
            env: { ...process.env, VIBISUAL_USAGE_PROBE: '', VIBISUAL_OWNER_AGENT_ID: '', VIBISUAL_OWNER_TERM_ID: '' },
            stdio: ['pipe', 'pipe', 'pipe'], timeout: 10_000 });
          let stdout = ''; let stderr = '';
          child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
          child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
          child.on('error', reject);
          child.on('close', (status) => resolve({ status, stdout, stderr }));
          child.stdin.end(JSON.stringify({ hook_event_name: event, session_id: 'fixture-session', tool_name: 'Read', tool_input: {} }));
        });
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ continue: true });
        if (event === 'UserPromptSubmit') expect(result.stdout).toContain('fixture 규칙');
      }
      expect(seen).toContain('/api/permission-check');
      expect(seen).toContain('/api/commands/fixture-session/pop');
      expect(seen.filter(url => url === '/api/hook-event')).toHaveLength(3);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
