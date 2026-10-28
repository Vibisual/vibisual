/**
 * §5.3 #12-3 자물쇠 집행 시험 — 판정이 엔진마다 그 엔진의 강제 허락 장치로 나가는가. 깨질 자리: 모드 단축(`plan`·`bypassPermissions`)이 건너뜀 ·
 * 코덱스에 `ask`(무시하고 실행 — fail-open) · 훅 도우미가 `ask` 를 몰라 `{continue:true}` · 자물쇠가 있는데 코덱스 턴에 권한 훅이 없음.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { AuditBoundaryConfig, PathLockHit } from '@vibisual/shared';
import { codexPermissionHooksRequired, planCodexPermission } from './codexPermissionPolicy.js';
import { describeLockTargets, lockAskReason, lockDenyReason, unmanagedLockAnswer } from './pathLockGate.js';

const MODES = ['default', 'acceptEdits', 'auto', 'dontAsk', 'plan', 'bypassPermissions'] as const;

const hit = (target: string, extra: Partial<PathLockHit> = {}): PathLockHit => ({
  lockId: `file:${target.toLowerCase()}`,
  kind: 'file',
  target,
  projectName: 'proj',
  access: 'read',
  matched: target,
  ...extra,
});

describe('① 코덱스 판정 — 자물쇠는 모든 모드 단축보다 먼저', () => {
  it.each(MODES.filter((m) => m !== 'dontAsk'))('%s 에서도 잠긴 호출은 카드로 묻는다', (mode) => {
    expect(planCodexPermission({ event: 'PreToolUse', permissionMode: mode, escalate: false, locked: true, consumeApproval: () => false }))
      .toEqual({ kind: 'ask' });
  });

  it('묻지 않는 모드는 물을 수 없으니 거부한다(사유 표식 locked)', () => {
    expect(planCodexPermission({ event: 'PreToolUse', permissionMode: 'dontAsk', escalate: false, locked: true, consumeApproval: () => false }))
      .toEqual({ kind: 'deny', reason: 'locked' });
  });

  it('방금 카드에서 허용한 같은 호출(재시도)은 다시 묻지 않는다', () => {
    expect(planCodexPermission({ event: 'PreToolUse', permissionMode: 'plan', escalate: false, locked: true, consumeApproval: () => true }))
      .toEqual({ kind: 'allow', reason: 'approved' });
  });

  it('자물쇠 표식이 없으면 종전 그대로다', () => {
    expect(planCodexPermission({ event: 'PreToolUse', permissionMode: 'plan', escalate: false, consumeApproval: () => false }))
      .toEqual({ kind: 'allow', reason: 'plan', policy: 'plan' });
  });
});

describe('④ 자물쇠가 있으면 코덱스 권한 훅은 모든 모드에서 필수', () => {
  const off: AuditBoundaryConfig = { escalateRisky: false, kinds: {} };
  it.each(MODES)('%s', (mode) => {
    expect(codexPermissionHooksRequired(mode, off, true)).toBe(true);
  });
  it('자물쇠가 없으면 종전 판정 그대로(읽기 전용 모드는 훅 없이 돈다)', () => {
    expect(codexPermissionHooksRequired('plan', off, false)).toBe(false);
    expect(codexPermissionHooksRequired('bypassPermissions', off)).toBe(false);
  });
});

describe('② 관할 밖 세션의 답 — 엔진마다 그 엔진의 장치로', () => {
  it('자물쇠에 안 닿았으면 답하지 않는다(종전 통과)', () => {
    expect(unmanagedLockAnswer([], {})).toBeNull();
  });

  it('클로드 훅 세션은 ask — 그 CLI 의 승인 창이 뜬다', () => {
    const answer = unmanagedLockAnswer([hit('C:/p/secret.env')], {});
    expect(answer).toMatchObject({ decision: 'ask', reason: 'locked' });
    expect(answer!.message).toContain('"C:/p/secret.env"');
  });

  it('코덱스(앱 소유 훅 · turn_id 가 실린 전역 훅)는 거부 — ask 를 지원하지 않는다', () => {
    expect(unmanagedLockAnswer([hit('C:/p/a')], { engine: 'codex' })).toMatchObject({ decision: 'deny', reason: 'locked' });
    expect(unmanagedLockAnswer([hit('C:/p/a')], { turnId: 'turn-1' })).toMatchObject({ decision: 'deny', reason: 'locked' });
    expect(unmanagedLockAnswer([hit('C:/p/a')], { turnId: '' })).toMatchObject({ decision: 'ask' });
  });

  it('사유 문구는 누가 누른 척하지 않고, 대상을 말한다', () => {
    const hits = [hit('a'), hit('b'), hit('c'), hit('d'), hit('e')];
    expect(describeLockTargets(hits)).toBe('"a", "b", "c" (+2 more)');
    expect(lockAskReason([hit('x')])).toContain('needs the user\'s approval');
    const dontAsk = lockDenyReason([hit('x')], 'dont-ask');
    expect(dontAsk).toContain('dontAsk');
    expect(dontAsk).toContain('No one pressed anything');
    expect(lockDenyReason([hit('x')], 'codex')).toContain('NOT executed');
  });
});

// ─── ③ 훅 도우미의 실제 왕복 ─────────────────────────────────────────────────

const handlerPath = fileURLToPath(new URL('../../../../hooks/handler.mjs', import.meta.url));
const codexHelperPath = fileURLToPath(new URL('../../../../hooks/codex-edges.mjs', import.meta.url));

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function fakeServer(reply: (url: string, body: Record<string, unknown>) => unknown) {
  const received: { url: string; body: Record<string, unknown> }[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(raw || '{}') as Record<string, unknown>; } catch { body = {}; }
    received.push({ url: req.url ?? '', body });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply(req.url ?? '', body) ?? {}));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received };
}

/** 이 테스트가 도는 셸의 VIBISUAL_* 를 걷어 낸 환경 — 진짜 앱으로 새지 않게. */
function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith('VIBISUAL_')) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

function run(script: string, args: string[], input: string, env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env, stdio: 'pipe' });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    child.stdin.on('error', () => undefined);
    child.on('close', () => resolve(stdout));
    child.stdin.end(input);
  });
}

const preToolUse = (extra: Record<string, unknown> = {}) => JSON.stringify({
  session_id: 'sess-1', cwd: '/work', hook_event_name: 'PreToolUse',
  tool_name: 'Read', tool_input: { file_path: '/work/secret.env' }, permission_mode: 'bypassPermissions', ...extra,
});

describe('③ handler.mjs — 서버의 ask 를 클로드 규격으로 돌려준다', () => {
  it('ask → permissionDecision "ask" + 서버가 지은 사유', async () => {
    const { base, received } = await fakeServer((url) => (url === '/api/permission-check'
      ? { ok: true, decision: 'ask', reason: 'locked', message: 'Vibisual lock: "/work/secret.env" is locked by the user' }
      : {}));
    const stdout = await run(handlerPath, ['--server', base, '--token', 'tok'], preToolUse(), cleanEnv());
    const first = JSON.parse(stdout.split('\n')[0]!);
    expect(first.hookSpecificOutput).toEqual({
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: 'Vibisual lock: "/work/secret.env" is locked by the user',
    });
    const check = received.find((r) => r.url === '/api/permission-check')!;
    expect(check.body).not.toHaveProperty('turnId');
  });

  it('코덱스 페이로드(turn_id)는 서버가 엔진을 가를 수 있게 turnId 를 싣는다', async () => {
    const { base, received } = await fakeServer(() => ({ ok: true, decision: 'allow', reason: 'not-managed' }));
    await run(handlerPath, ['--server', base, '--token', 'tok'], preToolUse({ turn_id: 'turn-9' }), cleanEnv());
    expect(received.find((r) => r.url === '/api/permission-check')!.body['turnId']).toBe('turn-9');
  });

  it('locked 거부는 서버 문구를 그대로 쓴다(누가 누른 척하지 않는다)', async () => {
    const { base } = await fakeServer((url) => (url === '/api/permission-check'
      ? { ok: true, decision: 'deny', reason: 'locked', message: 'Vibisual lock: blocked — unlock it in Vibisual' }
      : {}));
    const stdout = await run(handlerPath, ['--server', base, '--token', 'tok'], preToolUse({ turn_id: 'turn-1' }), cleanEnv());
    const first = JSON.parse(stdout.split('\n')[0]!);
    expect(first.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(first.hookSpecificOutput.permissionDecisionReason).toBe('Vibisual lock: blocked — unlock it in Vibisual');
  });
});

describe('③ codex-edges.mjs — 앱 소유 훅의 자물쇠 거부', () => {
  it('locked 거부는 서버 문구를 그대로 싣는다', async () => {
    const { base } = await fakeServer(() => ({ ok: true, decision: 'deny', reason: 'locked', message: 'PERMISSION POLICY: DENY. "x" is locked' }));
    const stdout = await run(codexHelperPath, ['permission', 'PreToolUse'], JSON.stringify({
      session_id: 'thread-1', turn_id: 'turn-1', cwd: '/work', hook_event_name: 'PreToolUse',
      tool_name: 'Bash', tool_input: { command: 'cat x' },
    }), cleanEnv({ VIBISUAL_BASE: base, VIBISUAL_TOKEN: 'tok', VIBISUAL_OWNER_AGENT_ID: 'agent-1', VIBISUAL_SUBAGENT_ID: 'sub-1' }));
    const output = JSON.parse(stdout);
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe('PERMISSION POLICY: DENY. "x" is locked');
  });
});
