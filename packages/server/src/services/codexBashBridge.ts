import { MAX_BASH_HISTORY } from '@vibisual/shared';
import type { CodexMappedEvent } from './codexStreamMap.js';
import type { LocalHookToolEvent } from './localRunner.js';

/** One bridge per turn: raw commands and verified outcomes enter the existing hook pipeline. */
export function createCodexBashBridge(turnId: string, cwd: string): (event: CodexMappedEvent) => LocalHookToolEvent[] {
  const commands = new Map<string, string>();
  const finished = new Set<string>();
  return (event) => {
    const hook = event.bashHook;
    const id = event.toolUseId;
    if (!hook || !id || finished.has(id)) return [];
    const previous = commands.get(id);
    const command = hook.command ?? previous;
    // UI summaries and reconstructed argv are not executable evidence.
    if (!command?.trim()) return [];
    const base = { toolName: 'Bash', toolInput: { command }, toolUseId: `codex-bash:${turnId}:${id}`, cwd };
    if (hook.phase === 'pre') {
      if (previous !== undefined) return [];
      commands.set(id, command);
      if (commands.size > MAX_BASH_HISTORY) commands.delete(commands.keys().next().value!);
      return [{ ...base, phase: 'pre' }];
    }
    commands.delete(id);
    finished.add(id);
    if (finished.size > MAX_BASH_HISTORY) finished.delete(finished.values().next().value!);
    // Some versions emit completed items only. Preserve their observed raw command too.
    const start: LocalHookToolEvent[] = previous === undefined ? [{ ...base, phase: 'pre' }] : [];
    // A changed command for the same item cannot prove the earlier command succeeded.
    const consistent = previous === undefined || previous === command;
    return [...start, {
      ...base, phase: 'post',
      ...(hook.toolResponse !== undefined ? { toolResponse: hook.toolResponse } : {}),
      ...(consistent && hook.toolIsError !== undefined ? { toolIsError: hook.toolIsError } : {}),
    }];
  };
}
