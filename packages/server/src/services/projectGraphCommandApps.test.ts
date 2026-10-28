import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COMMAND_ACTIVITY_LIMITS, MAX_BASH_HISTORY } from '@vibisual/shared';
import type { HookEventPayload } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { bashEntryBytes } from './commandActivityRetention.js';

let root: string;
let graph: ProjectGraph;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-command-apps-')));
  graph = new ProjectGraph();
  graph.registerProject(root);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function event(id: string, command: string, phase: 'PreToolUse' | 'PostToolUse' = 'PreToolUse', session = 'command-app-session', output = ''): void {
  const payload: HookEventPayload = {
    session_id: session, tool_name: 'Bash', tool_use_id: id, hook_event_name: phase,
    cwd: root, tool_input: { command },
    ...(phase === 'PostToolUse' ? { tool_response: { stdout: output, exit_code: 0 } } : {}),
  };
  graph.processHookEvent(payload);
}
const entries = () => Object.values(graph.getSnapshot().bashHistory).flat();
const appNodes = () => graph.getSnapshot().topFolders.filter((node) => node.commandApp);

describe('command apps use existing graph and command history', () => {
  it('connects a target app to its agent and the same bounded history entry', () => {
    event('run', 'blender --background scene.blend');
    const node = appNodes()[0]!;
    expect(node.commandApp?.name).toBe('Blender');
    expect(node.commandApp?.detection).toBe('command');
    expect(entries()).toHaveLength(1);
    expect(entries()[0]?.appNodeIds).toEqual([node.id]);
    expect(graph.getSnapshot().edges.some((edge) => edge.target === node.id)).toBe(true);
    const before = entries()[0];
    event('run', 'blender --background scene.blend', 'PostToolUse', undefined, 'rendered');
    expect(entries()[0]).not.toBe(before);
    expect(entries()[0]).toMatchObject({ status: 'success', output: 'rendered', endedAt: expect.any(Number) });
    expect(before?.status).toBe('running');
    expect(appNodes()).toHaveLength(1);
    expect(appNodes()[0]?.status).toBe('idle');
  });

  it('does not multiply duplicate hooks and keeps same tool IDs from two sessions separate', () => {
    event('same', 'blender -b', 'PreToolUse', 'a');
    event('same', 'blender -b', 'PreToolUse', 'a');
    event('same', 'blender -b', 'PreToolUse', 'b');
    event('same', 'blender -b', 'PostToolUse', 'a', 'A');
    event('same', 'blender -b', 'PostToolUse', 'a', 'A');
    expect(entries()).toHaveLength(2);
    expect(entries().filter((entry) => entry.status === 'running')).toHaveLength(1);
    expect(appNodes()[0]?.status).toBe('active');
    event('same', 'blender -b', 'PostToolUse', 'b', 'B');
    expect(entries().map((entry) => entry.output).sort()).toEqual(['A', 'B']);
    expect(appNodes()[0]?.status).toBe('idle');
  });

  it('keeps unknown commands and post-only outcomes without inventing a start time', () => {
    event('unknown', 'some_future_tool --work');
    event('post-only', 'blender -b', 'PostToolUse');
    expect(entries()).toHaveLength(2);
    expect(entries().find((entry) => entry.id === 'unknown')?.appNodeIds).toBeUndefined();
    expect(entries().find((entry) => entry.id === 'post-only')).toMatchObject({ status: 'success' });
    expect(entries().find((entry) => entry.id === 'post-only')?.startedAt).toBeUndefined();
  });

  it('keeps external working-directory calls in the owning session project', () => {
    event('seed', 'echo initialize');
    const cwd = path.resolve(root, '..', 'external-engine-working-directory');
    graph.processHookEvent({
      session_id: 'command-app-session', tool_name: 'Bash', tool_use_id: 'external',
      hook_event_name: 'PreToolUse', cwd, tool_input: { command: 'blender -b' },
    });
    expect(appNodes()).toHaveLength(1);
    expect(entries().find((entry) => entry.id === 'external')).toMatchObject({ cwd, appNodeIds: [appNodes()[0]!.id] });
    expect(Object.values(graph.toProjectCheckpoint(path.basename(root)).graph.nodes).some((node) => node.commandApp)).toBe(true);
  });

  it('round-trips app nodes, memberships and outcomes through project restore and merge', () => {
    event('run', 'blender -b');
    event('run', 'blender -b', 'PostToolUse');
    const originalId = appNodes()[0]!.id;
    const cp = graph.toProjectCheckpoint(path.basename(root));
    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(cp);
    expect(fresh.getSnapshot().topFolders.find((node) => node.commandApp)?.id).toBe(originalId);
    expect(Object.values(fresh.getSnapshot().bashHistory).flat()[0]?.appNodeIds).toEqual([originalId]);
    const merged = new ProjectGraph();
    merged.mergeFromCheckpoint(cp);
    expect(merged.getSnapshot().topFolders.find((node) => node.commandApp)?.id).toBe(originalId);
    expect(Object.values(merged.getSnapshot().bashHistory).flat()[0]?.status).toBe('success');
  });

  it('bounds terminal text and old history after checkpoint load', () => {
    event('large', `echo ${'c'.repeat(100_000)}`);
    event('large', '', 'PostToolUse', undefined, 'o'.repeat(100_000));
    const row = entries()[0]!;
    expect(row.command).toHaveLength(COMMAND_ACTIVITY_LIMITS.commandChars);
    expect(row.output).toHaveLength(COMMAND_ACTIVITY_LIMITS.outputChars);
    expect(row.commandTruncated).toBe(true);
    expect(row.outputTruncated).toBe(true);
    const cp = graph.toProjectCheckpoint(path.basename(root));
    cp.activity.bashHistory['command-app-session'] = Array.from({ length: 100 }, (_, i) => ({
      id: `legacy-${i}`, command: 'x'.repeat(100_000), output: 'y'.repeat(100_000), timestamp: i,
    }));
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(cp);
    const rows = Object.values(restored.getSnapshot().bashHistory).flat();
    expect(rows.length).toBeLessThanOrEqual(MAX_BASH_HISTORY);
    expect(rows.reduce((sum, entry) => sum + bashEntryBytes(entry), 0)).toBeLessThanOrEqual(COMMAND_ACTIVITY_LIMITS.historyBytes);
    expect(rows.every((entry) => entry.commandTruncated && entry.outputTruncated)).toBe(true);
  });

  it('reuses seats and caps generated app nodes rather than accumulating one per command', () => {
    for (let i = 0; i < COMMAND_ACTIVITY_LIMITS.appsPerProject + 5; i++) {
      const command = `"C:/Applications/tool-${i}.exe" --work`;
      event(`run-${i}`, command);
      event(`run-${i}`, command, 'PostToolUse');
    }
    expect(appNodes()).toHaveLength(COMMAND_ACTIVITY_LIMITS.appsPerProject);
    expect(entries()).toHaveLength(COMMAND_ACTIVITY_LIMITS.appsPerProject + 5);
    const cp = graph.toProjectCheckpoint(path.basename(root));
    expect(Object.keys(cp.graph.refs.nodeProjectRoots ?? {}).filter((key) => key.startsWith('__special__commandapp__')))
      .toHaveLength(COMMAND_ACTIVITY_LIMITS.appsPerProject);
    const ids = new Set(appNodes().map((node) => node.id));
    expect(graph.getSnapshot().edges.filter((edge) => edge.target.startsWith('command-app-')).every((edge) => ids.has(edge.target))).toBe(true);
  });

  it('resolves relative Bash reads against the tool cwd', () => {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'only-here.ts'), 'export const value = 1;');
    event('read', 'cat src/only-here.ts');
    const cp = graph.toProjectCheckpoint(path.basename(root));
    expect(Object.values(cp.graph.nodes).some((node) => node.bubbleType === 'file' && node.label === 'only-here.ts' && node.lastTool === 'Read')).toBe(true);
  });

  it('clears active app decoration when its pending record is evicted', () => {
    event('old', 'blender -b');
    for (let i = 0; i < MAX_BASH_HISTORY; i++) event(`next-${i}`, `echo ${i}`);
    expect(entries().some((entry) => entry.id === 'old')).toBe(false);
    expect(appNodes()[0]?.status).toBe('idle');
  });

  it('does not revive stale running state from a saved checkpoint', () => {
    event('old', 'blender -b');
    const cp = graph.toProjectCheckpoint(path.basename(root));
    graph = new ProjectGraph();
    graph.restoreFromCheckpoint(cp);
    expect(entries()[0]?.status).toBeUndefined();
    event('new', 'blender -b');
    event('new', 'blender -b', 'PostToolUse');
    expect(appNodes()[0]?.status).toBe('idle');
  });

  it('caps restored and merged app nodes while preserving pinned nodes', () => {
    event('base', 'blender -b');
    event('base', 'blender -b', 'PostToolUse');
    const cp = graph.toProjectCheckpoint(path.basename(root));
    const original = Object.values(cp.graph.nodes).find((node) => node.commandApp)!;
    for (let i = 0; i < 35; i++) {
      const key = `__special__commandapp__restored-${i}`;
      cp.graph.nodes[key] = { ...original, id: `saved-${i}`, path: key, status: 'idle',
        lastActivity: i, ...(i === 0 ? { preservePinned: true, label: 'Pinned application' } : {}) };
      cp.graph.hierarchy.topLevelPaths.push(key);
      cp.graph.refs.nodeProjectRoots![key] = path.basename(root);
    }
    for (const load of ['restoreFromCheckpoint', 'mergeFromCheckpoint'] as const) {
      const fresh = new ProjectGraph();
      fresh[load](structuredClone(cp));
      const nodes = fresh.getSnapshot().topFolders.filter((node) => node.commandApp);
      expect(nodes).toHaveLength(COMMAND_ACTIVITY_LIMITS.appsPerProject);
      expect(nodes.some((node) => node.label === 'Pinned application')).toBe(true);
    }
  });

  it('keeps completed records isolated when projects run the same app', () => {
    event('first', 'blender -b');
    const firstId = appNodes()[0]!.id;
    const otherRoot = path.join(root, 'other-project');
    fs.mkdirSync(otherRoot);
    graph.registerProject(otherRoot);
    graph.processHookEvent({ session_id: 'other-project-session', tool_use_id: 'second', tool_name: 'Bash',
      hook_event_name: 'PreToolUse', cwd: otherRoot, tool_input: { command: 'blender -b' } });
    const second = entries().find((entry) => entry.id === 'second')!;
    expect(second.appNodeIds).toHaveLength(1);
    expect(second.appNodeIds).not.toContain(firstId);
  });
});

// §5.1 명령 앱 · §7.3 — 명령 목록은 파일 버블과 같은 `마지막 20개만 유지` 체크박스다.
//   보이는 수만 정한다 — 이력은 세션 기록의 참조라 버블 하나가 자를 수 없다.
describe('command app history checkbox follows the file bubble rule', () => {
  it('toggles only the node flag, never trims the shared records, and rides the checkpoint', () => {
    for (let i = 0; i < 30; i += 1) event(`run-${i}`, 'blender -b');
    const node = appNodes()[0]!;
    const before = entries().length;
    expect(graph.setCommandHistoryUnlimited(node.id, true)).toBe(true);
    expect(appNodes()[0]?.unlimitedCommandHistory).toBe(true);
    expect(entries()).toHaveLength(before);
    const saved = Object.values(graph.toProjectCheckpoint(path.basename(root)).graph.nodes).find((n) => n.commandApp);
    expect(saved?.unlimitedCommandHistory).toBe(true);
    expect(graph.setCommandHistoryUnlimited(node.id, false)).toBe(true);
    expect(appNodes()[0]?.unlimitedCommandHistory).toBeUndefined();
    expect(entries()).toHaveLength(before);
  });

  it('answers false for anything that is not a Bash node', () => {
    expect(graph.setCommandHistoryUnlimited('no-such-node', true)).toBe(false);
  });
});
