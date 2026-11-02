import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCodexTurn, stopCodexTurn, isCodexTurnRunning, type CodexTurnArgs } from './codexRunner.js';
import { prepareCodexHooks } from './codexHookTrust.js';

vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(), spawn: vi.fn(),
}));
vi.mock('./codexCli.js', async (original) => ({
  ...await original<typeof import('./codexCli.js')>(), getCodexBin: () => process.execPath,
}));
vi.mock('./codexHookTrust.js', () => ({ prepareCodexHooks: vi.fn() }));
vi.mock('./processGuard.js', () => ({ processGuard: { guardChild: vi.fn() } }));
vi.mock('./codexConfigService.js', () => ({
  codexWindowsSandboxConfigured: () => true,
  readCodexEffectiveConfigFor: () => ({ layers: [] }),
}));

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
}

const helperPath = fileURLToPath(new URL('../../../../hooks/codex-edges.mjs', import.meta.url));
const progress = { helperPath, nodeBin: process.execPath };
const permission = { ...progress, required: true };
const trust = ['-c', 'hooks.state={}'];
const children: FakeChild[] = [];
let serial = 0;

beforeEach(() => {
  vi.mocked(spawn).mockReset().mockImplementation(() => {
    const child = new FakeChild();
    children.push(child);
    return child as unknown as ChildProcess;
  });
  vi.mocked(prepareCodexHooks).mockReset().mockResolvedValue(trust);
});

afterEach(() => {
  for (const child of children.splice(0)) child.emit('close', 0);
});

function launch(overrides: Partial<CodexTurnArgs> = {}) {
  const onDone = vi.fn();
  const args: CodexTurnArgs = {
    subAgentId: `codex-progress-${++serial}`, commandId: `command-${serial}`,
    ownerAgentId: 'parent', cwd: process.cwd(), model: 'test', prompt: 'test',
    progressHook: progress,
    onEvent: vi.fn(), onThread: vi.fn(), onUsage: vi.fn(), onFileWrites: vi.fn(), onDone,
    ...overrides,
  };
  runCodexTurn(args);
  return { args, onDone };
}

async function spawned() {
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
  const call = vi.mocked(spawn).mock.calls[0]!;
  return { argv: call[1] as readonly string[], env: (call[2] as { env: NodeJS.ProcessEnv }).env };
}

describe('Codex runner lifecycle telemetry', () => {
  it.each([undefined, 'existing-thread'])('passes verified hooks and command ownership to the actual child (resume %s)', async (resumeThreadId) => {
    const { args } = launch({ resumeThreadId, env: { VIBISUAL_SUBAGENT_ID: 'old-sub', VIBISUAL_CODEX_COMMAND_ID: 'old-command' } });
    const { argv, env } = await spawned();
    expect(argv.some((arg) => arg.startsWith('hooks.PreCompact='))).toBe(true);
    expect(argv.some((arg) => arg.startsWith('hooks.PostCompact='))).toBe(true);
    expect(argv.some((arg) => arg.startsWith('hooks.PostToolUse='))).toBe(true);
    expect(argv).toContain('hooks.state={}');
    expect(env.VIBISUAL_SUBAGENT_ID).toBe(args.subAgentId);
    expect(env.VIBISUAL_CODEX_COMMAND_ID).toBe(args.commandId);
    expect(env.VIBISUAL_OWNER_AGENT_ID).toBe('parent');
    expect(prepareCodexHooks).toHaveBeenCalledOnce();
    if (resumeThreadId) expect(argv).toContain(resumeThreadId);
  });

  it('clears inherited command identity when the optional caller did not supply one', async () => {
    launch({ commandId: undefined, env: { VIBISUAL_CODEX_COMMAND_ID: 'previous-command' } });
    expect((await spawned()).env.VIBISUAL_CODEX_COMMAND_ID).toBe('');
  });

  it('omits an unavailable progress helper while retaining the required permission bridge', async () => {
    launch({ progressHook: { ...progress, helperPath: `${helperPath}.does-not-exist` }, permissionHook: permission });
    const { argv } = await spawned();
    expect(prepareCodexHooks).toHaveBeenCalledOnce();
    expect(vi.mocked(prepareCodexHooks).mock.calls[0]![3].map((hook) => hook.eventName))
      .toEqual(['preToolUse', 'permissionRequest']);
    expect(argv.some((arg) => arg.startsWith('hooks.PreCompact='))).toBe(false);
    expect(argv.some((arg) => arg.startsWith('hooks.PermissionRequest='))).toBe(true);
  });

  it('retries core hooks after an optional hook cannot load, without weakening approval', async () => {
    vi.mocked(prepareCodexHooks).mockRejectedValueOnce(new Error('unsupported preCompact')).mockResolvedValueOnce(trust);
    launch({ permissionHook: permission, permissionMode: 'default' });
    const { argv } = await spawned();
    expect(prepareCodexHooks).toHaveBeenCalledTimes(2);
    expect(vi.mocked(prepareCodexHooks).mock.calls[0]![3].map((hook) => hook.eventName)).toContain('preCompact');
    expect(vi.mocked(prepareCodexHooks).mock.calls[1]![3].map((hook) => hook.eventName))
      .toEqual(['preToolUse', 'permissionRequest']);
    expect(argv).toContain('approval_policy=on-request');
    expect(argv).toContain('approvals_reviewer="auto_review"');
    expect(argv.some((arg) => arg.startsWith('hooks.PermissionRequest='))).toBe(true);
    expect(argv.some((arg) => arg.startsWith('hooks.PreCompact='))).toBe(false);
  });

  it.each([
    { permissionHook: permission, expected: 'Codex permission hooks unavailable:' },
    { toolHook: { ...progress, policy: { shell: 'deny' as const } }, expected: 'Codex tool permissions unavailable:' },
    { edgeConfig: { ...progress, edgeIds: ['edge'], restrictedTools: ['Read'] }, expected: 'Codex edge enforcement unavailable:' },
  ])('still refuses execution when the core hook cannot be verified ($expected)', async ({ expected, ...config }) => {
    vi.mocked(prepareCodexHooks).mockRejectedValue(new Error('core hook unavailable'));
    const { args, onDone } = launch(config);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining(expected), '');
    expect(prepareCodexHooks).toHaveBeenCalledTimes(2);
    expect(spawn).not.toHaveBeenCalled();
    expect(isCodexTurnRunning(args.subAgentId)).toBe(false);
  });

  it('can run without telemetry when no core hooks were needed', async () => {
    vi.mocked(prepareCodexHooks).mockRejectedValueOnce(new Error('progress unavailable'));
    launch();
    const { argv } = await spawned();
    expect(prepareCodexHooks).toHaveBeenCalledOnce();
    expect(argv.some((arg) => arg.startsWith('hooks.'))).toBe(false);
  });

  it('does not retry preparation or spawn after the user stops a failed optional preparation', async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(prepareCodexHooks).mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
    const { args, onDone } = launch({ permissionHook: permission });
    expect(isCodexTurnRunning(args.subAgentId)).toBe(true);
    expect(stopCodexTurn(args.subAgentId)).toBe(true);
    reject(new Error('preparation cancelled'));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledExactlyOnceWith(undefined, ''));
    expect(prepareCodexHooks).toHaveBeenCalledOnce();
    expect(spawn).not.toHaveBeenCalled();
    expect(isCodexTurnRunning(args.subAgentId)).toBe(false);
  });

  it('stopping the core retry prevents its late success from launching the task', async () => {
    let resolveRetry!: (trust: string[]) => void;
    vi.mocked(prepareCodexHooks).mockRejectedValueOnce(new Error('optional event unavailable'))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
    const { args, onDone } = launch({ permissionHook: permission });
    await vi.waitFor(() => expect(prepareCodexHooks).toHaveBeenCalledTimes(2));
    expect(stopCodexTurn(args.subAgentId)).toBe(true);
    resolveRetry(trust);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledExactlyOnceWith(undefined, ''));
    expect(spawn).not.toHaveBeenCalled();
    expect(isCodexTurnRunning(args.subAgentId)).toBe(false);
  });
});
