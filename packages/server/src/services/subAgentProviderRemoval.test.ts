import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, QueuedCommand } from '@vibisual/shared';
import type { LocalTurnArgs } from './localRunner.js';
import type { CodexTurnArgs } from './codexRunner.js';

const local = new Map<string, LocalTurnArgs>();
const codex = new Map<string, CodexTurnArgs>();
const stopLocal = vi.fn((id: string) => local.delete(id));
const stopCodex = vi.fn((id: string) => codex.delete(id));
vi.mock('./localRunner.js', async (original) => ({
  ...await original<typeof import('./localRunner.js')>(),
  runLocalTurn: (args: LocalTurnArgs) => { local.set(args.subAgentId, args); },
  stopLocalTurn: (id: string) => stopLocal(id),
}));
vi.mock('./codexRunner.js', async (original) => ({
  ...await original<typeof import('./codexRunner.js')>(),
  runCodexTurn: (args: CodexTurnArgs) => { codex.set(args.subAgentId, args); },
  stopCodexTurn: (id: string) => stopCodex(id),
}));
const { SubAgentManager } = await import('./subAgentManager.js');

afterEach(() => { local.clear(); codex.clear(); stopLocal.mockClear(); stopCodex.mockClear(); });

function config(kind: 'local-llama' | 'codex-cli'): AgentConfig {
  return { model: 'opus', tools: [], permissionMode: 'bypassPermissions', skills: [], provider: { kind, modelId: 'test-model' } } as AgentConfig;
}
function command(subAgentId: string, id: string): QueuedCommand {
  return { id, subAgentId, text: 'work', timestamp: Date.now(), status: 'queued' };
}

describe.each(['local-llama', 'codex-cli'] as const)('removing a running %s session', (kind) => {
  it('stops only the removed runner and closes its command as a user stop', () => {
    const manager = new SubAgentManager();
    const completed = vi.fn();
    manager.setOnComplete(completed);
    const removed = manager.create('parent-a');
    const sibling = manager.create('parent-a');
    const removedCommand = command(removed.id, 'removed-command');
    const siblingCommand = command(sibling.id, 'sibling-command');
    manager.execute(removedCommand, process.cwd(), '', config(kind));
    manager.execute(siblingCommand, process.cwd(), '', config(kind));
    const turns = kind === 'local-llama' ? local : codex;
    expect(manager.remove(removed.id)).toBe(true);
    expect(turns.has(removed.id)).toBe(false);
    expect(turns.has(sibling.id)).toBe(true);
    expect(removedCommand.status).toBe('completed');
    expect(removedCommand.result).toMatch(/^\[Stopped by user\]/);
    expect(removedCommand.stopReason).toBe('cancelled');
    expect(completed).toHaveBeenCalledOnce();
    expect(siblingCommand.status).toBe('executing');
    expect(manager.isSubProcessingCommand(sibling.id)).toBe(true);
  });

  it('ignores removed-turn output, usage and completion after the same session is restored', () => {
    const manager = new SubAgentManager();
    const stream = vi.fn();
    const changed = vi.fn();
    manager.setOnStreamEvent(stream);
    manager.setOnSubStatusChange(changed);
    const hook = vi.fn();
    manager.setLocalHookEmitter(hook);
    const sub = manager.create('parent-a');
    sub.sessionId = 'same-conversation';
    const settings = config(kind);
    manager.execute(command(sub.id, 'old-command'), process.cwd(), '', settings);
    const oldLocal = local.get(sub.id);
    const oldCodex = codex.get(sub.id);
    manager.remove(sub.id);
    const restored = manager.restoreFromArchive(sub.id, 'parent-a')!;
    const next = command(sub.id, 'new-command');
    manager.execute(next, process.cwd(), '', settings);
    stream.mockClear();
    changed.mockClear();
    if (oldLocal) {
      oldLocal.onEvent('text', 'late old output');
      oldLocal.onUsage?.(42, 7, 4096);
      oldLocal.onToolSupport?.('none');
      oldLocal.onToolEvent?.('tool_result', 'late result', 'Write', 'old-call');
      oldLocal.onHookEvent?.({ phase: 'post', toolName: 'Write', toolInput: { path: 'old.txt' }, toolUseId: 'old-call', cwd: process.cwd() });
      oldLocal.onDone('late old failure');
    }
    if (oldCodex) {
      oldCodex.onEvent({ eventType: 'text', content: 'late old output' });
      oldCodex.onUsage?.({ inputTokens: 42, outputTokens: 7, cachedInputTokens: 0, reasoningOutputTokens: 0 });
      oldCodex.onThread?.('late-old-thread');
      oldCodex.onFileWrites?.(['old.txt']);
      oldCodex.onDone('late old failure', '');
    }
    expect(stream).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(settings.provider?.tokensIn).toBeUndefined();
    expect(settings.provider?.toolSupport).toBeUndefined();
    expect(next.status).toBe('executing');
    expect(restored.status).toBe('active');
    expect(restored.sessionId).toBe('same-conversation');
    expect(manager.isSubProcessingCommand(sub.id)).toBe(true);
  });
});
