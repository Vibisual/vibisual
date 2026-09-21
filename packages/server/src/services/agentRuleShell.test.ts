import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { agentRuleShell, agentPowershellRequest, buildAgentCardCommonRules, buildAgentReportRules, buildAgentQuestionRules, buildAgentReviewRules, buildAgentSelfCompactRule, buildHarnessBuilderRules, buildOrchestraConductorRules } from '@vibisual/shared';

const exec = promisify(execFile);
const baseArgs = { serverBase: 'http://127.0.0.1:1', serverToken: 'DO-NOT-EMBED', agentId: 'agent-test', subAgentId: 'sub-test' };
const blocks = (rules: string): string[] => [...rules.matchAll(/```powershell\n([\s\S]*?)```/g)].map((m) => m[1]!);
const builder = (shell: 'powershell' | 'posix'): string => buildHarnessBuilderRules({ ...baseArgs, shell, centerX: 10, centerY: 20, projectName: '한글 "프로젝트"\n둘째 줄' });

describe('agent rule shell selection', () => {
  it.each(['win32', 'darwin', 'linux'])('selects executable syntax for both engines on %s', (platform) => {
    for (const engine of ['claude', 'codex'] as const) {
      const shell = agentRuleShell(engine, platform);
      expect(shell).toBe(engine === 'codex' && platform === 'win32' ? 'powershell' : 'posix');
      const rules = [buildAgentCardCommonRules({ ...baseArgs, shell }), buildAgentSelfCompactRule('a', 's', shell), builder(shell)];
      for (const text of rules) {
        expect(text).not.toContain(baseArgs.serverToken);
        expect(text).toContain(shell === 'powershell' ? '```powershell' : '```bash');
        if (shell === 'powershell') expect(text).not.toMatch(/```bash|<<'JSON'|\$\{VIBISUAL_BASE:-/);
      }
    }
  });

  it('includes all five builder calls and literal project JSON', () => {
    expect(blocks(builder('powershell'))).toHaveLength(5);
    expect(builder('posix')).toContain(JSON.stringify('한글 "프로젝트"\n둘째 줄'));
  });

  it('keeps each card endpoint and auth hint in the same shell as the common rule', () => {
    for (const build of [buildAgentReportRules, buildAgentQuestionRules, buildAgentReviewRules]) {
      const text = build({ ...baseArgs, shell: 'powershell' });
      expect(text).toContain('POST $B/api/agent-');
      expect(text).not.toMatch(/-H |\$VIBISUAL_TOKEN|\$VIBISUAL_BASE/);
    }
  });
});

describe.skipIf(process.platform !== 'win32')('generated rules execute on Windows PowerShell', () => {
  let server: Server;
  let url: string;
  const received: { method?: string; path?: string; body: string; contentType?: string; sourceAgent?: string | string[]; sourceSub?: string | string[] }[] = [];
  let orchestraPolls = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (req.headers['x-vibisual-hook-token'] !== 'test-auth') {
          res.writeHead(401).end(JSON.stringify({ error: '인증 누락' })); return;
        }
        if (req.url === '/api/reject') { res.writeHead(409).end(JSON.stringify({ error: '충돌', ids: ['a'] })); return; }
        received.push({ method: req.method, path: req.url, body: Buffer.concat(chunks).toString('utf8'), contentType: req.headers['content-type'], sourceAgent: req.headers['x-vibisual-source-agent'], sourceSub: req.headers['x-vibisual-source-subagent'] });
        if (req.url === '/api/orchestra/runs/orchestra-shell/plan') {
          orchestraPolls = 0;
          res.end(JSON.stringify({ ok: true, dispatchEdgeId: 'entry-edge', run: { runId: 'orchestra-shell' } })); return;
        }
        if (req.url?.startsWith('/api/task-edges/dispatch?')) {
          res.end(JSON.stringify({ ok: false, pending: true, dispatched: true, status: 'queued', cmdId: 'entry-command' })); return;
        }
        if (req.url?.startsWith('/api/task-edges/dispatch/entry-command?')) {
          const pending = orchestraPolls++ === 0;
          res.end(JSON.stringify({ ok: true, ...(pending ? { pending: true, timedOut: true } : {}), job: { cmdId: 'entry-command', status: pending ? 'executing' : 'completed', ...(pending ? {} : { result: '한글 구현·검증 완료' }) } })); return;
        }
        res.end(JSON.stringify({ ok: true, agent: { id: 'created-id', path: 'created-path' }, data: { id: 'edge-id' } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing port');
    url = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

  const run = async (code: string, token = 'test-auth', alias = ''): Promise<string> => {
    const result = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 15_000, encoding: 'utf8',
      env: { ...process.env, VIBISUAL_BASE: url, VIBISUAL_TOKEN: token, VIBISUAL_HOOK_AUTH: alias, VIBISUAL_SUBAGENT_ID: '' },
    });
    return result.stdout;
  };

  it('sends card and compact IDs, Korean JSON, and survives TOKEN-name exclusion', async () => {
    const card = blocks(buildAgentCardCommonRules({ ...baseArgs, shell: 'powershell' }))[0]!;
    await run(card.replace('<엔드포인트>', 'agent-review'), '', 'test-auth');
    expect(JSON.parse(received.at(-1)!.body)).toEqual({ agentId: 'agent-test', subAgentId: 'sub-test' });
    const compact = blocks(buildAgentSelfCompactRule('a', 's', 'powershell'))[0]!;
    await run(compact);
    expect(received.at(-1)?.path).toBe('/api/agent-compact');
    expect(JSON.parse(received.at(-1)!.body).reason).toBe('왜 지금인지 한 줄');
    expect(received.at(-1)?.contentType).toContain('charset=utf-8');
  });

  it('executes all five builder calls in independent shells', async () => {
    const commands = blocks(builder('powershell'));
    const first = await run(commands[0]!);
    expect(first).toContain('AGENT_ID=created-id AGENT_PATH=created-path');
    expect(JSON.parse(received.at(-1)!.body).project).toBe('한글 "프로젝트"\n둘째 줄');
    await run(commands[1]!.replace('<1)에서 받은 AGENT_ID>', 'created-id'));
    expect(received.at(-1)?.method).toBe('PUT');
    expect(received.at(-1)?.path).toBe('/api/agent-config/created-id');
    expect(JSON.parse(received.at(-1)!.body).rules).toContain('받은 명세대로');
    expect(await run(commands[2]!)).toContain('EDGE_ID=edge-id');
    await run(commands[3]!);
    expect(JSON.parse(received.at(-1)!.body).critiqueAuthority).toBe('force-rework');
    await run(commands[4]!.replace('<1)에서 받은 AGENT_PATH>', 'created-path').replace('<사용자 원본 요청 전문을 그대로 — JSON escape 불필요, 여러 줄 OK>', '한글 요청\n$그대로 "따옴표"'));
    expect(received.at(-1)?.path).toBe('/api/commands/created-path');
    expect(received.at(-1)?.body).toBe('한글 요청\n$그대로 "따옴표"');
  });

  it('keeps missing-auth 401 and HTTP error bodies visible', async () => {
    const code = blocks(agentPowershellRequest({ serverBase: url, endpoint: '/api/reject', body: '{}' }))[0]!;
    await expect(run(code, '', '')).rejects.toThrow(/HTTP 401/);
    await expect(run(code)).rejects.toThrow(/HTTP 409[\s\S]*ids/);
  });

  it.each(['powershell', 'bash'] as const)('orchestra %s registers before dispatch and recovers the same job after pending', async (shell) => {
    const gitBash = 'C:/Program Files/Git/bin/bash.exe';
    if (shell === 'bash' && !existsSync(gitBash)) return;
    const rules = buildOrchestraConductorRules({
      serverBase: url, runId: 'orchestra-shell', projectName: '한글 프로젝트', conductorAgentId: 'conductor-shell', conductorSubAgentId: 'conductor-session',
      centerX: 0, centerY: 0, settings: {}, existingMembers: [], existingEdges: [], conductorEngine: shell === 'powershell' ? 'codex' : 'claude', platform: 'win32',
    });
    const commands = [...rules.matchAll(new RegExp('```' + shell + '\\n([\\s\\S]*?)```', 'g'))].map((m) => m[1]!);
    const execute = shell === 'powershell' ? (code: string) => run(code, '', 'test-auth') : async (code: string): Promise<string> => (await exec(gitBash, ['--noprofile', '--norc', '-c', code], {
      windowsHide: true, encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, VIBISUAL_BASE: url, VIBISUAL_TOKEN: '', VIBISUAL_HOOK_AUTH: 'test-auth', VIBISUAL_SUBAGENT_ID: '' },
    })).stdout;
    const start = received.length;
    expect(await execute(commands[3]!.replace('<ENTRY_ID>', 'entry-agent'))).toContain('DISPATCH_EDGE_ID=entry-edge');
    const dispatched = JSON.parse(await execute(commands[4]!.replace('<DISPATCH_EDGE_ID>', 'entry-edge').replace('<사용자 원문 요청 전문 — escape 불필요, 여러 줄 OK>', '한글 요청\n$그대로 "따옴표"')));
    expect(dispatched).toMatchObject({ cmdId: 'entry-command', pending: true, status: 'queued' });
    const collect = commands[5]!.replace('<CMD_ID>', dispatched.cmdId);
    expect(JSON.parse(await execute(collect))).toMatchObject({ pending: true, timedOut: true, job: { status: 'executing' } });
    expect(JSON.parse(await execute(collect))).toMatchObject({ job: { status: 'completed', result: '한글 구현·검증 완료' } });
    const requests = received.slice(start);
    expect(requests.map((r) => r.method)).toEqual(['POST', 'POST', 'GET', 'GET']);
    expect(requests[0]?.path).toBe('/api/orchestra/runs/orchestra-shell/plan');
    const dispatchUrl = new URL(requests[1]!.path!, url);
    expect(Object.fromEntries(dispatchUrl.searchParams)).toEqual({ edgeId: 'entry-edge', agentId: 'conductor-shell', wait: 'false', requestKey: 'orchestra-shell:entry' });
    expect(requests[1]?.body).toContain('한글 요청\n$그대로 "따옴표"');
    expect(requests[1]?.body).toContain('모든 작업·검증·재작업의 끝난 결과를 회수한 뒤');
    expect(requests[2]?.path).toBe('/api/task-edges/dispatch/entry-command?agentId=conductor-shell&waitMs=60000');
    expect(requests[3]?.path).toBe(requests[2]?.path);
    for (const request of requests) expect(request).toMatchObject({ sourceAgent: 'conductor-shell', sourceSub: 'conductor-session' });
  });

  it.skipIf(!existsSync('C:/Program Files/Git/bin/bash.exe'))('Bash builder preserves Korean JSON and returns IDs between independent invocations', async () => {
    const rules = buildHarnessBuilderRules({ ...baseArgs, serverBase: url, centerX: 0, centerY: 0, projectName: '한글 "프로젝트"\n둘째 줄' });
    const commands = [...rules.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]!);
    const bash = async (command: string): Promise<string> => (await exec('C:/Program Files/Git/bin/bash.exe', ['--noprofile', '--norc', '-c', command], {
      windowsHide: true, encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, VIBISUAL_BASE: url, VIBISUAL_TOKEN: '', VIBISUAL_HOOK_AUTH: 'test-auth' },
    })).stdout;
    expect(await bash(commands[0]!)).toContain('AGENT_ID=created-id AGENT_PATH=created-path');
    expect(JSON.parse(received.at(-1)!.body).project).toBe('한글 "프로젝트"\n둘째 줄');
    await bash(commands[1]!.replace('<1)에서 받은 AGENT_ID>', 'created-id'));
    expect(received.at(-1)?.path).toBe('/api/agent-config/created-id');
    expect(await bash(commands[2]!)).toContain('EDGE_ID=edge-id');
    await bash(commands[3]!);
    expect(JSON.parse(received.at(-1)!.body).kind).toBe('critique');
    await bash(commands[4]!.replace('<ENTRY_AGENT_PATH>', 'created-path'));
    expect(received.at(-1)?.path).toBe('/api/commands/created-path');
  });
});
