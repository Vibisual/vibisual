import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BASH_HISTORY, mineAutoGoalCandidates, type HookEventPayload } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { toLocalHookPayload } from './localHookPayload.js';
import { runLocalTool } from './localTools.js';

let root: string;
let graph: ProjectGraph;
let at: number;
let sequence: number;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-bash-capture-')));
  graph = new ProjectGraph();
  graph.registerProject(root);
  at = Date.now();
  sequence = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => at);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function start(command: string): HookEventPayload {
  at += 1;
  const payload: HookEventPayload = {
    session_id: 'capture-session', hook_event_name: 'PreToolUse', cwd: root,
    tool_name: 'Bash', tool_input: { command }, tool_use_id: `capture-${++sequence}`,
  };
  graph.processHookEvent(payload);
  return payload;
}

function complete(command: string, tool_response: Record<string, unknown>, failure = false): void {
  const payload = start(command);
  graph.processHookEvent({ ...payload, hook_event_name: failure ? 'PostToolUseFailure' : 'PostToolUse', tool_response });
}

function entries() {
  return Object.values(graph.getAutoGoalMaterial().bashHistory).flat();
}

describe('Bash outcomes reach procedure mining through ProjectGraph', () => {
  it.each(['live', 'restoreFromCheckpoint', 'mergeFromCheckpoint'] as const)(
    'matches repeated engine tool ids only inside their own session (%s)', (mode) => {
      const a: HookEventPayload = {
        session_id: 'collision-A', hook_event_name: 'PreToolUse', tool_name: 'Bash',
        tool_input: { command: 'echo A-success' }, tool_use_id: 'call_1', cwd: root,
      };
      const b: HookEventPayload = {
        ...a, session_id: 'collision-B', tool_input: { command: 'exit 7' },
      };
      graph.processHookEvent(a);
      graph.processHookEvent(b);
      if (mode !== 'live') {
        const saved = JSON.parse(JSON.stringify(graph.toCheckpoint()));
        graph = new ProjectGraph();
        graph[mode](saved);
      }
      graph.processHookEvent({ ...b, hook_event_name: 'PostToolUseFailure', tool_response: { is_error: true } });
      graph.processHookEvent({ ...a, hook_event_name: 'PostToolUse', tool_response: { is_error: false } });
      expect(entries().find((entry) => entry.command === 'echo A-success')?.status).toBe('success');
      expect(entries().find((entry) => entry.command === 'exit 7')?.status).toBe('error');
      expect(mineAutoGoalCandidates(graph.getAutoGoalMaterial()).observed).toBe(1);
    },
  );

  it('pruning one session does not discard another session\'s matching tool id', () => {
    const base: HookEventPayload = {
      session_id: 'prune-A', hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command: 'echo old-A' }, tool_use_id: 'call_1', cwd: root,
    };
    const b = { ...base, session_id: 'prune-B', tool_input: { command: 'echo B' } };
    graph.processHookEvent(base);
    graph.processHookEvent(b);
    for (let index = 0; index < MAX_BASH_HISTORY; index += 1) {
      graph.processHookEvent({ ...base, tool_use_id: `new-${index}`, tool_input: { command: `echo ${index}` } });
    }
    graph.processHookEvent({ ...b, hook_event_name: 'PostToolUse', tool_response: { is_error: false } });
    expect(entries().find((entry) => entry.command === 'echo old-A')).toBeUndefined();
    expect(entries().find((entry) => entry.command === 'echo B')?.status).toBe('success');
  });

  it('keeps pending, failed and background attempts separate from confirmed foreground completion', () => {
    start('echo pending');
    complete('echo failed', {}, true);
    complete('echo background', { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'background' });
    complete('echo unknown', { content: [{ type: 'text', text: 'success' }] });
    const command = '  printf "a  b"\nprintf "error exit 7"  ';
    complete(command, { stdout: 'error exit 7', stderr: '', interrupted: false });
    const material = entries();
    expect(material.find((e) => e.command === 'echo pending')?.status).toBe('running');
    expect(material.find((e) => e.command === 'echo failed')?.status).toBe('error');
    expect(material.find((e) => e.command === 'echo background')?.status).toBe('running');
    expect(material.find((e) => e.command === 'echo unknown')?.status).toBe('running');
    expect(material.find((e) => e.command === command)).toMatchObject({ command, status: 'success' });
    expect(material).toHaveLength(5);
    expect(mineAutoGoalCandidates(graph.getAutoGoalMaterial()).observed).toBe(1);
  });

  it('does not bridge failure or pending gaps into repeated successful procedures', () => {
    for (let run = 0; run < 3; run += 1) {
      complete('echo first', { exit_code: 0 });
      if (run === 1) start('echo still-running');
      else complete('echo failed', { exit_code: 7 });
      complete('echo second', { exit_code: 0 });
      at += 20 * 60_000;
    }
    expect(mineAutoGoalCandidates(graph.getAutoGoalMaterial()).candidates).toEqual([]);

    for (let run = 0; run < 3; run += 1) {
      complete('echo first', { exit_code: 0 });
      complete('echo second', { exit_code: 0 });
      at += 20 * 60_000;
    }
    expect(mineAutoGoalCandidates(graph.getAutoGoalMaterial()).candidates).toEqual([
      expect.objectContaining({ steps: ['echo first', 'echo second'], runs: 3 }),
    ]);
  });

  it('uses actual local shell outcomes rather than words in their output', async () => {
    const commands = ['echo error exit 7', process.platform === 'win32' ? 'exit /b 7' : 'exit 7'];
    for (const [index, command] of commands.entries()) {
      const base = { toolName: 'Bash', toolInput: { command }, toolUseId: `local-${index}`, cwd: root };
      graph.processHookEvent(toLocalHookPayload('capture-local', { phase: 'pre', ...base }));
      const outcome = await runLocalTool('Bash', base.toolInput, root);
      expect(outcome.isError).toBe(index === 1);
      graph.processHookEvent(toLocalHookPayload('capture-local', {
        phase: 'post', ...base, toolResponse: outcome.content, toolIsError: outcome.isError,
      }));
    }
    expect(entries().find((e) => e.id === 'local-0')?.status).toBe('success');
    expect(entries().find((e) => e.id === 'local-1')?.status).toBe('error');
    expect(mineAutoGoalCandidates(graph.getAutoGoalMaterial()).observed).toBe(1);
  });
});
