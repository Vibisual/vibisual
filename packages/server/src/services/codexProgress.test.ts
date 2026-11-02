import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, QueuedCommand } from '@vibisual/shared';
import type { CodexTurnArgs } from './codexRunner.js';
import { readCodexProgressNotice, type CodexProgressNotice } from './codexProgress.js';

let turn: CodexTurnArgs;
vi.mock('./codexRunner.js', async (original) => ({
  ...await original<typeof import('./codexRunner.js')>(),
  runCodexTurn: (args: CodexTurnArgs) => { turn = args; },
}));
const { subAgentManager } = await import('./subAgentManager.js');
const config: AgentConfig = {
  model: 'opus', tools: [], skills: [], permissionMode: 'bypassPermissions',
  provider: { kind: 'codex-cli', modelId: 'test-model' },
};
const owned: string[] = [];
let seq = 0;
function open() {
  const sub = subAgentManager.create('agent-progress-test', 'Progress');
  owned.push(sub.id);
  const command = (): QueuedCommand => ({ id: `progress-command-${++seq}`, text: 'Continue',
    timestamp: Date.now(), status: 'queued', subAgentId: sub.id });
  const cmd = command();
  subAgentManager.execute(cmd, process.cwd(), '', config, undefined, {
    codexPermissionHook: { nodeBin: 'node', helperPath: '/app/codex-edges.mjs', required: false },
  });
  turn.onThread('root-thread');
  const notice = (hookEventName: CodexProgressNotice['hookEventName'], fields: Partial<CodexProgressNotice> = {}): CodexProgressNotice => ({
    parentAgentId: sub.parentAgentId, subAgentId: sub.id, commandId: cmd.id,
    sessionId: 'root-thread', hookEventName, ...fields,
  });
  const send = (event: CodexProgressNotice['hookEventName'], fields: Partial<CodexProgressNotice> = {}) =>
    subAgentManager.noteCodexProgress(notice(event, fields));
  const wait = (event: 'PreToolUse' | 'PostToolUse', id = 'wait-1') =>
    send(event, { toolName: 'collaborationwait_agent', toolUseId: id });
  return { sub, cmd, command, notice, send, wait };
}

beforeEach(() => { subAgentManager.setOnSubStatusChange(() => {}); });
afterEach(() => {
  while (owned.length) subAgentManager.remove(owned.pop()!);
  vi.restoreAllMocks();
});

describe('Codex live progress belongs to the active root command', () => {
  it('replays the 181-second compaction gap without ending the command or resetting its start', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { sub, cmd, send } = open();
    expect(turn.commandId).toBe(cmd.id);
    expect(turn.progressHook?.helperPath).toBe('/app/codex-edges.mjs');
    expect(send('PreCompact')).toBe(true);
    expect(sub.compactingSince).toBe(1_000_000);
    clock.mockReturnValue(1_181_216);
    send('PreCompact');
    expect(sub.compactingSince).toBe(1_000_000);
    expect(cmd.status).toBe('executing');
    send('PostCompact');
    expect(sub.compactingSince).toBeUndefined();
    expect(cmd.status).toBe('executing');
    turn.onDone(undefined, 'Done');
    expect(cmd.status).toBe('completed');
  });

  it('pairs concurrent waits, tolerates duplicate starts and ignores unrelated completions', () => {
    const { sub, wait } = open();
    wait('PreToolUse');
    const since = sub.waitingForAgentsSince;
    wait('PreToolUse');
    wait('PreToolUse', 'wait-2');
    wait('PostToolUse', 'unknown-wait');
    wait('PostToolUse');
    expect(sub.waitingForAgentsSince).toBe(since);
    wait('PostToolUse', 'wait-2');
    expect(sub.waitingForAgentsSince).toBeUndefined();
  });

  it('rejects a child thread, another owner, an old command and an unknown sub before mutation', () => {
    const { sub, send } = open();
    for (const fields of [{ sessionId: 'child-thread' }, { parentAgentId: 'other' },
      { commandId: 'old-command' }, { subAgentId: 'missing' }]) {
      expect(send('PreCompact', fields)).toBe(false);
    }
    expect(sub.compactingSince).toBeUndefined();
    expect(sub.waitingForAgentsSince).toBeUndefined();
  });

  it('clears both markers on failure and refuses late signals after a new command starts', () => {
    const { sub, send, wait, command } = open();
    wait('PreToolUse'); send('PreCompact');
    const oldTurn = turn;
    oldTurn.onDone('stream disconnected', '');
    expect(sub.status).toBe('error');
    expect(sub.compactingSince).toBeUndefined();
    expect(sub.waitingForAgentsSince).toBeUndefined();
    expect(send('PreCompact')).toBe(false);
    const next = command();
    subAgentManager.execute(next, process.cwd(), '', config);
    expect(send('PreCompact')).toBe(false);
    expect(subAgentManager.noteCodexProgress({ parentAgentId: sub.parentAgentId,
      subAgentId: sub.id, commandId: next.id, sessionId: 'root-thread', hookEventName: 'PreCompact' })).toBe(true);
    oldTurn.onDone(undefined, 'late completion');
    expect(sub.compactingSince).toBeDefined();
    expect(next.status).toBe('executing');
    turn.onDone(undefined, 'Done');
    expect(sub.compactingSince).toBeUndefined();
  });

  it('uses a new root tool call to repair a lost end notification, not buffered stdout', () => {
    const { sub, send, wait } = open();
    send('PreCompact');
    wait('PreToolUse');
    expect(sub.compactingSince).toBeUndefined();
    expect(sub.waitingForAgentsSince).toBeDefined();
    turn.onEvent({ eventType: 'text', content: 'Earlier buffered commentary' });
    expect(sub.waitingForAgentsSince).toBeDefined();
    send('PreCompact');
    turn.onEvent({ eventType: 'thinking', content: 'Earlier buffered reasoning' });
    send('PostToolUse', { toolName: 'exec_command', toolUseId: 'old-shell' });
    expect(sub.compactingSince).toBeDefined();
    send('PreToolUse', { toolName: 'exec_command', toolUseId: 'shell-1' });
    expect(sub.compactingSince).toBeUndefined();
    expect(sub.waitingForAgentsSince).toBeUndefined();
  });

  it('discards runtime progress when a saved session is restored', () => {
    const { sub, wait, send } = open();
    wait('PreToolUse'); send('PreCompact');
    const saved = { ...sub };
    turn.onDone(undefined, 'Done');
    subAgentManager.remove(sub.id);
    subAgentManager.mergeSnapshot({ [saved.parentAgentId]: [saved] }, 0);
    const restored = subAgentManager.getSub(sub.id)!;
    expect(restored.status).toBe('idle');
    expect(restored.compactingSince).toBeUndefined();
    expect(restored.waitingForAgentsSince).toBeUndefined();
  });

  it('validates identity and projects the payload to metadata only', () => {
    const { notice } = open();
    const valid = notice('PreCompact');
    expect(readCodexProgressNotice({ ...valid, toolInput: { secret: 'never retained' } })).toEqual(valid);
    for (const value of [null, [], {}, { ...valid, commandId: '' },
      { ...valid, sessionId: 'x'.repeat(257) }, { ...valid, hookEventName: 'Stop' },
      { ...valid, hookEventName: 'PreToolUse' }]) {
      expect(readCodexProgressNotice(value)).toBeNull();
    }
  });
});
