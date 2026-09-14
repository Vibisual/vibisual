import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { AuditBoundaryConfig } from '@vibisual/shared';
import {
  CodexApprovalMemory,
  codexApprovalKey,
  codexPermissionHooksRequired,
  planCodexPermission,
  type CodexPermissionHookEvent,
} from './codexPermissionPolicy.js';
import { codexEdgeOverrides, codexTurnHooks, type CodexEdgeConfig, type CodexPermissionHookConfig } from './codexEdges.js';
import { buildCodexExecArgs } from './codexRunner.js';

/*
 * §5.25 (H) — 코덱스 버블의 두 권한 계층(권한 모드 · 감사 경계)이 서로 독립으로, 선택한 설정대로
 * 코덱스 실행에 걸리는지 고정한다. 판정표(순수) → 실행 인자 → 훅 도우미의 실제 HTTP 왕복 순서다.
 */

const MODES = ['default', 'acceptEdits', 'auto', 'dontAsk', 'plan', 'bypassPermissions'] as const;
const never = () => { throw new Error('consumeApproval must not be called here'); };

describe('§5.25 (H) planCodexPermission — 감사 경계(PreToolUse)', () => {
  it.each(MODES)('경계가 붙잡지 않은 호출은 %s 에서 묻지 않는다', (mode) => {
    const plan = planCodexPermission({ event: 'PreToolUse', permissionMode: mode, escalate: false, consumeApproval: never });
    if (mode === 'plan') expect(plan).toEqual({ kind: 'allow', reason: 'plan', policy: 'plan' });
    else if (mode === 'bypassPermissions') expect(plan).toEqual({ kind: 'allow', reason: 'bypass', policy: 'bypass' });
    else expect(plan).toEqual({ kind: 'allow', reason: 'sandbox' });
  });

  it.each(['default', 'acceptEdits', 'auto', 'bypassPermissions'])('경계가 붙잡은 호출은 %s 에서도 카드로 묻는다(모드와 독립)', (mode) => {
    expect(planCodexPermission({ event: 'PreToolUse', permissionMode: mode, escalate: true, consumeApproval: () => false }))
      .toEqual({ kind: 'ask' });
  });

  it('dontAsk 는 경계가 붙잡은 호출을 묻지 않고 거부한다 · plan 은 경계가 건드리지 않는다', () => {
    expect(planCodexPermission({ event: 'PreToolUse', permissionMode: 'dontAsk', escalate: true, consumeApproval: () => false }))
      .toEqual({ kind: 'deny', reason: 'dont-ask' });
    expect(planCodexPermission({ event: 'PreToolUse', permissionMode: 'plan', escalate: true, consumeApproval: never }))
      .toEqual({ kind: 'allow', reason: 'plan', policy: 'plan' });
  });

  it('방금 허용된 같은 호출(재시도)은 다시 묻지 않는다', () => {
    expect(planCodexPermission({ event: 'PreToolUse', permissionMode: 'default', escalate: true, consumeApproval: () => true }))
      .toEqual({ kind: 'allow', reason: 'approved' });
  });
});

describe('§5.25 (H) planCodexPermission — 권한 모드(PermissionRequest)', () => {
  it.each([
    ['default', { kind: 'ask' }],
    ['acceptEdits', { kind: 'ask' }],
    [undefined, { kind: 'ask' }],
    ['auto', { kind: 'deny', reason: 'codex-no-prompt' }],
    ['plan', { kind: 'deny', reason: 'codex-no-prompt' }],
    ['dontAsk', { kind: 'deny', reason: 'dont-ask' }],
    ['bypassPermissions', { kind: 'allow', reason: 'bypass', policy: 'bypass' }],
  ] as const)('%s → %j (경계 켜짐/꺼짐과 무관)', (mode, expected) => {
    for (const escalate of [false, true]) {
      expect(planCodexPermission({ event: 'PermissionRequest', permissionMode: mode, escalate, consumeApproval: () => false }))
        .toEqual(expected);
    }
  });

  it('묻지 않는 모드는 승인 기억을 쓰지 않는다 — 승인 모드에서만 앞 카드의 답을 잇는다', () => {
    const consume = vi.fn(() => true);
    for (const mode of ['auto', 'plan', 'dontAsk', 'bypassPermissions']) {
      planCodexPermission({ event: 'PermissionRequest', permissionMode: mode, escalate: true, consumeApproval: consume });
    }
    expect(consume).not.toHaveBeenCalled();
    expect(planCodexPermission({ event: 'PermissionRequest', permissionMode: 'default', escalate: false, consumeApproval: consume }))
      .toEqual({ kind: 'allow', reason: 'approved' });
    expect(consume).toHaveBeenCalledTimes(1);
  });
});

describe('§5.25 (H) codexPermissionHooksRequired', () => {
  const off: AuditBoundaryConfig = { escalateRisky: false, kinds: {} };
  const on: AuditBoundaryConfig = { escalateRisky: true, kinds: { delete: true, network: true, config: true, outside: true } };
  const allKindsOff: AuditBoundaryConfig = { escalateRisky: true, kinds: { delete: false, network: false, config: false, outside: false } };

  it('승인 모드는 경계와 무관하게 훅이 있어야 돈다', () => {
    for (const boundary of [off, on]) {
      expect(codexPermissionHooksRequired('default', boundary)).toBe(true);
      expect(codexPermissionHooksRequired('acceptEdits', boundary)).toBe(true);
    }
  });
  it('묻지 않는 쓰기 모드는 경계가 켜졌을 때만 훅이 필요하다', () => {
    for (const mode of ['auto', 'bypassPermissions']) {
      expect(codexPermissionHooksRequired(mode, on)).toBe(true);
      expect(codexPermissionHooksRequired(mode, off)).toBe(false);
      expect(codexPermissionHooksRequired(mode, allKindsOff)).toBe(false);
    }
  });
  it('읽기 전용 샌드박스 모드는 훅이 없어도 위험 호출이 실행되지 않는다', () => {
    for (const mode of ['plan', 'dontAsk']) expect(codexPermissionHooksRequired(mode, on)).toBe(false);
  });
});

describe('§5.25 (H) codexApprovalKey · CodexApprovalMemory', () => {
  it('재시도와 승인 요청(설명 덧붙음)은 같은 열쇠, 다른 명령은 다른 열쇠', () => {
    const pre = codexApprovalKey('a', 's', 'Bash', { command: 'rm -rf build' });
    expect(codexApprovalKey('a', 's', 'Bash', { command: 'rm -rf build', description: 'May I delete build?' })).toBe(pre);
    expect(codexApprovalKey('a', 's', 'Bash', { command: 'rm -rf dist' })).not.toBe(pre);
    expect(codexApprovalKey('a', 'other-session', 'Bash', { command: 'rm -rf build' })).not.toBe(pre);
    const prefix = 'x'.repeat(400);
    expect(codexApprovalKey('a', 's', 'Bash', { command: `${prefix} a` })).not.toBe(codexApprovalKey('a', 's', 'Bash', { command: `${prefix} b` }));
  });
  it('명령이 없는 도구(MCP)는 설명을 뺀 입력 전체로, 키 순서와 무관하게 잇는다', () => {
    expect(codexApprovalKey('a', 's', 'mcp__x__y', { b: 1, a: 'z' }))
      .toBe(codexApprovalKey('a', 's', 'mcp__x__y', { a: 'z', b: 1, description: 'why' }));
    expect(codexApprovalKey('a', 's', 'mcp__x__y', { a: 'z' })).not.toBe(codexApprovalKey('a', 's', 'mcp__x__y', { a: 'q' }));
  });
  it('허용 한 번은 재시도 한 번 + 승인 요청 한 번만 덮고, 2분이 지나면 사라진다', () => {
    let now = 1_000;
    const memory = new CodexApprovalMemory(120_000, () => now);
    const consume = (event: CodexPermissionHookEvent) => memory.consume('k', event);
    expect(consume('PreToolUse')).toBe(false);
    memory.grant('k');
    expect(consume('PreToolUse')).toBe(true);
    expect(consume('PreToolUse')).toBe(false);
    expect(consume('PermissionRequest')).toBe(true);
    expect(consume('PermissionRequest')).toBe(false);
    memory.grant('k');
    now += 120_001;
    expect(consume('PermissionRequest')).toBe(false);
  });
  it('원장 줄 기억도 같은 창에서만 산다', () => {
    let now = 0;
    const memory = new CodexApprovalMemory(120_000, () => now);
    memory.rememberEntry('k', 'audit-1');
    now += 60_000;
    expect(memory.entryFor('k')).toBe('audit-1');
    now += 60_001;
    expect(memory.entryFor('k')).toBeUndefined();
  });
});

describe('§5.25 (H) 코덱스 실행 인자', () => {
  const permissionHook: CodexPermissionHookConfig = { helperPath: '/app/hooks/codex-edges.mjs', nodeBin: '/usr/bin/node', required: true };
  const edge: CodexEdgeConfig = { helperPath: '/app/hooks/codex-edges.mjs', nodeBin: '/usr/bin/node', edgeIds: ['e1'], restrictedTools: [] };
  const valueOf = (args: string[], prefix: string) => args.filter((arg) => arg.startsWith(prefix));

  it('요청 시 승인 모드는 on-request 를 살리는 검토자 설정과 두 훅을 함께 싣는다', () => {
    for (const permissionMode of ['default', 'acceptEdits']) {
      const args = buildCodexExecArgs({ cwd: '/p', model: 'm', permissionMode, permissionHook, platform: 'linux' });
      expect(args).toContain('workspace-write');
      expect(args).toContain('approval_policy=on-request');
      expect(args).toContain('approvals_reviewer="auto_review"');
      expect(args).toContain('features.hooks=true');
      expect(valueOf(args, 'hooks.PreToolUse=')).toHaveLength(1);
      expect(valueOf(args, 'hooks.PreToolUse=')[0]).toContain('permission PreToolUse');
      expect(valueOf(args, 'hooks.PermissionRequest=')[0]).toContain('permission PermissionRequest');
    }
  });

  it('권한 훅이 없으면 검토자를 바꾸지 않는다 — 모델이 사람 대신 승인하는 일은 없다', () => {
    const args = buildCodexExecArgs({ cwd: '/p', model: 'm', permissionMode: 'default' });
    expect(args).toContain('approval_policy=on-request');
    expect(args.some((arg) => arg.startsWith('approvals_reviewer'))).toBe(false);
    expect(args.some((arg) => arg.startsWith('hooks.'))).toBe(false);
  });

  it.each([
    ['auto', 'workspace-write', 'never'],
    ['bypassPermissions', 'danger-full-access', 'never'],
    ['plan', 'read-only', 'never'],
    ['dontAsk', 'read-only', 'never'],
  ])('%s 는 %s + %s 그대로이고, 경계용 훅만 싣는다', (permissionMode, sandbox, approval) => {
    const args = buildCodexExecArgs({ cwd: '/p', model: 'm', permissionMode, permissionHook, platform: 'linux' });
    expect(args[args.indexOf('-s') + 1]).toBe(sandbox);
    expect(args).toContain(`approval_policy=${approval}`);
    expect(args.some((arg) => arg.startsWith('approvals_reviewer'))).toBe(false);
    expect(valueOf(args, 'hooks.PreToolUse=')[0]).toContain('permission PreToolUse');
  });

  it('위임 강제 턴의 PreToolUse 는 위임 검문만 싣고, 승인 요청 훅은 그대로 둔다', () => {
    const restricted = { ...edge, restrictedTools: ['Bash'] };
    const args = buildCodexExecArgs({ cwd: '/p', model: 'm', permissionMode: 'default', edgeConfig: restricted, permissionHook, platform: 'linux' });
    const pre = valueOf(args, 'hooks.PreToolUse=');
    expect(pre).toHaveLength(1);
    expect(pre[0]).toContain(' gate');
    expect(pre[0]).not.toContain('permission PreToolUse');
    expect(valueOf(args, 'hooks.PermissionRequest=')[0]).toContain('permission PermissionRequest');
  });

  it('신뢰할 훅 목록은 싣는 훅과 정확히 같다', () => {
    const { expected } = codexTurnHooks(undefined, permissionHook, 'linux');
    expect(expected).toEqual([
      { command: '"/usr/bin/node" "/app/hooks/codex-edges.mjs" permission PreToolUse', eventName: 'preToolUse' },
      { command: '"/usr/bin/node" "/app/hooks/codex-edges.mjs" permission PermissionRequest', eventName: 'permissionRequest' },
    ]);
  });

  it.each([
    ['win32', '& "'],
    ['darwin', '"'],
    ['linux', '"'],
  ] as const)('%s 훅 명령은 %s 로 시작한다(Windows 훅은 PowerShell 로 돈다)', (platform, start) => {
    for (const { command } of codexTurnHooks(undefined, permissionHook, platform).expected) {
      expect(command.startsWith(start)).toBe(true);
    }
  });

  it('위임 상태 조회는 승인 모드에서도 매번 묻지 않는다', () => {
    expect(codexEdgeOverrides(edge)).toContain('mcp_servers.vibisual_edges.tools.status.approval_mode="approve"');
  });
});

// ─── 훅 도우미 `codex-edges.mjs permission <event>` 의 실제 HTTP 왕복 ───

const helperPath = fileURLToPath(new URL('../../../../hooks/codex-edges.mjs', import.meta.url));
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

interface Received { url: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }

async function startServer(reply: (body: Record<string, unknown>) => { status?: number; json: unknown }) {
  const received: Received[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}') as Record<string, unknown>;
    received.push({ url: req.url ?? '', headers: req.headers, body });
    const { status = 200, json } = reply(body);
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(json));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received };
}

function runHelper(event: string, input: string, env: Record<string, string | undefined>): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const childEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...process.env, ...env })) if (value !== undefined) childEnv[key] = value;
    const child = spawn(process.execPath, [helperPath, 'permission', event], { env: childEnv, stdio: 'pipe' });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    // 입력을 읽지 않고 끝나는 경로(모르는 이벤트)에서는 쓰기가 EPIPE 로 끝난다.
    child.stdin.on('error', () => undefined);
    child.on('close', (code) => resolve({ code, stdout }));
    child.stdin.end(input);
  });
}

const call = (extra: Record<string, unknown> = {}) => JSON.stringify({
  session_id: 'thread-1', turn_id: 'turn-1', cwd: '/work', hook_event_name: 'PreToolUse',
  tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, ...extra,
});

describe('§5.25 (H) 훅 도우미 → /api/permission-check → 코덱스 답', () => {
  const env = (base: string) => ({ VIBISUAL_BASE: base, VIBISUAL_TOKEN: 'tok', VIBISUAL_OWNER_AGENT_ID: 'agent-1', VIBISUAL_SUBAGENT_ID: 'sub-1' });

  it('PreToolUse: 창구에 코덱스 호출을 그대로 싣고, 허용이면 코덱스 판정에 맡긴다(빈 답)', async () => {
    const { base, received } = await startServer(() => ({ json: { ok: true, decision: 'allow', reason: 'sandbox' } }));
    const result = await runHelper('PreToolUse', call({ tool_use_id: 'exec-1' }), env(base));
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
    expect(received).toHaveLength(1);
    expect(received[0]!.url).toBe('/api/permission-check');
    expect(received[0]!.headers['x-vibisual-hook-token']).toBe('tok');
    expect(received[0]!.body).toEqual({
      engine: 'codex', hookEvent: 'PreToolUse', sessionId: 'thread-1', parentAgentId: 'agent-1', subAgentId: 'sub-1',
      toolName: 'Bash', toolInput: { command: 'rm -rf build' }, toolUseId: 'exec-1', cwd: '/work',
    });
  });

  it('PreToolUse: 카드에서 거부하면 실행 전에 막고 사용자의 선택이라고 말한다', async () => {
    const { base } = await startServer(() => ({ json: { ok: true, decision: 'deny', reason: 'not now' } }));
    const output = JSON.parse((await runHelper('PreToolUse', call(), env(base))).stdout);
    expect(output.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('USER PERMISSION DECISION: DENY');
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('User note: not now.');
  });

  it('PermissionRequest: 카드의 허용·거부가 코덱스 승인 결정으로 간다', async () => {
    let decision: 'allow' | 'deny' = 'allow';
    const { base, received } = await startServer(() => ({ json: { ok: true, decision, reason: decision === 'deny' ? 'timeout' : undefined } }));
    const permissionCall = call({ hook_event_name: 'PermissionRequest', tool_input: { command: 'rm -rf build', description: 'May I?' } });
    expect(JSON.parse((await runHelper('PermissionRequest', permissionCall, env(base))).stdout))
      .toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    expect(received[0]!.body['hookEvent']).toBe('PermissionRequest');
    expect(received[0]!.body).not.toHaveProperty('toolUseId');
    decision = 'deny';
    const denied = JSON.parse((await runHelper('PermissionRequest', permissionCall, env(base))).stdout);
    expect(denied.hookSpecificOutput.decision.behavior).toBe('deny');
    expect(denied.hookSpecificOutput.decision.message).toContain('DENY (auto)');
  });

  it.each([
    ['dont-ask', undefined, 'permission mode "dontAsk"'],
    ['codex-no-prompt', 'auto', 'permission mode "auto", which never asks'],
    ['not-managed', undefined, 'could not find the agent'],
  ])('정책 거부(%s)는 누가 누른 것처럼 말하지 않는다', async (reason, mode, text) => {
    const { base } = await startServer(() => ({ json: { ok: true, decision: 'deny', reason, ...(mode ? { mode } : {}) } }));
    const output = JSON.parse((await runHelper('PermissionRequest', call(), env(base))).stdout);
    expect(output.hookSpecificOutput.decision.message).toContain(text);
    expect(output.hookSpecificOutput.decision.message).not.toContain('pressed "Deny"');
  });

  it.each(['PreToolUse', 'PermissionRequest'] as const)('%s: 창구가 실패하면 조용히 통과시키지 않고 거부한다', async (event) => {
    const denied = (stdout: string) => {
      const output = JSON.parse(stdout).hookSpecificOutput;
      return event === 'PreToolUse' ? output.permissionDecision === 'deny' : output.decision.behavior === 'deny';
    };
    const failing = await startServer(() => ({ status: 500, json: { ok: false, decision: 'deny', reason: 'internal-error' } }));
    expect(denied((await runHelper(event, call(), env(failing.base))).stdout)).toBe(true);
    const garbage = await startServer(() => ({ json: { ok: true, decision: 'maybe' } }));
    expect(denied((await runHelper(event, call(), env(garbage.base))).stdout)).toBe(true);
    // 닫힌 포트 — 서버가 꺼져 있다.
    const closed = await startServer(() => ({ json: {} }));
    const closedBase = closed.base;
    const server = servers.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(denied((await runHelper(event, call(), env(closedBase))).stdout)).toBe(true);
    expect(denied((await runHelper(event, 'not JSON', env(failing.base))).stdout)).toBe(true);
    expect(denied((await runHelper(event, call(), { ...env(failing.base), VIBISUAL_BASE: undefined })).stdout)).toBe(true);
  });

  it('모르는 이벤트는 답을 쓰지 않고 오류로 끝난다', async () => {
    const result = await runHelper('PostToolUse', call(), { VIBISUAL_BASE: 'http://127.0.0.1:9' });
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
  });
});
