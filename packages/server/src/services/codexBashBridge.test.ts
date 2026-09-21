import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCodexBashBridge } from './codexBashBridge.js';
import type { CodexMappedEvent } from './codexStreamMap.js';
import { toLocalHookPayload } from './localHookPayload.js';
import { ProjectGraph } from './projectGraph.js';

let root: string;
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-codex-bash-'))); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
const pre = (command: string): CodexMappedEvent => ({
  eventType: 'tool_use', content: 'display summary', toolUseId: 'item-1',
  bashHook: { phase: 'pre', command },
});
const post = (toolIsError?: boolean, command?: string): CodexMappedEvent => ({
  eventType: 'tool_result', content: 'display summary', toolUseId: 'item-1',
  bashHook: { phase: 'post', command, toolIsError, toolResponse: 'error exit 7 is ordinary output' },
});

describe('Codex raw Bash bridge', () => {
  it('preserves started command when completion omits it, and sends success through the graph', () => {
    const graph = new ProjectGraph();
    graph.registerProject(root);
    const bridge = createCodexBashBridge('sub:turn-1', root);
    const command = '  printf "a  b"\nprintf "line 2"  ';
    for (const event of [pre(command), post(false)]) {
      for (const hook of bridge(event)) graph.processHookEvent(toLocalHookPayload('session', hook));
    }
    expect(Object.values(graph.getAutoGoalMaterial().bashHistory).flat()).toEqual([
      expect.objectContaining({ command, status: 'success', output: 'error exit 7 is ordinary output' }),
    ]);
    expect(bridge(post(false))).toEqual([]);
  });

  it('accepts completed-only raw events but never reconstructs a command from display text', () => {
    const bridge = createCodexBashBridge('turn', root);
    expect(bridge(post(false))).toEqual([]);
    const hooks = bridge(post(true, 'exit 7'));
    expect(hooks.map((hook) => hook.phase)).toEqual(['pre', 'post']);
    expect(hooks[1]?.toolIsError).toBe(true);
  });

  it('keeps unknown and mismatched results unconfirmed', () => {
    for (const event of [post(), post(false, 'different-command')]) {
      const graph = new ProjectGraph();
      graph.registerProject(root);
      const bridge = createCodexBashBridge('turn', root);
      for (const mapped of [pre('original-command'), event]) {
        for (const hook of bridge(mapped)) graph.processHookEvent(toLocalHookPayload('session', hook));
      }
      expect(Object.values(graph.getAutoGoalMaterial().bashHistory).flat()[0]?.status).toBe('running');
    }
  });

  it('isolates repeated item ids between turns and ignores repeated starts', () => {
    const a = createCodexBashBridge('sub:turn-1', root);
    const b = createCodexBashBridge('sub:turn-2', root);
    const first = a(pre('echo first'))[0];
    expect(a(pre('echo first'))).toEqual([]);
    expect(b(pre('echo second'))[0]?.toolUseId).not.toBe(first?.toolUseId);
  });
});
