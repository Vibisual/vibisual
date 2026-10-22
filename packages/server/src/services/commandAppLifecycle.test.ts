import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BUBBLE_TTL, type BubbleData, type HookEventPayload } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

const T0 = Date.parse('2026-10-20T00:00:00Z');
const SESSION = 'command-app-lifecycle-session';
const COMMANDS = [
  ['Git', 'git status'],
  ['Node.js', 'node --version'],
  ['pnpm', 'pnpm --version'],
  ['custom-editor', '"C:/Applications/custom-editor.exe" --work'],
] as const;

let root: string;
let graph: ProjectGraph;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-command-app-lifecycle-')));
  graph = new ProjectGraph();
  graph.registerProject(root);
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

function event(
  id: string,
  command: string,
  phase: 'PreToolUse' | 'PostToolUse' = 'PreToolUse',
  session = SESSION,
): void {
  const payload: HookEventPayload = {
    session_id: session,
    tool_name: 'Bash',
    tool_use_id: id,
    hook_event_name: phase,
    cwd: root,
    tool_input: { command },
    ...(phase === 'PostToolUse' ? { tool_response: { stdout: 'finished', exit_code: 0 } } : {}),
  };
  graph.processHookEvent(payload);
}

function completeCommand(id: string, command: string, session = SESSION): void {
  event(id, command, 'PreToolUse', session);
  event(id, command, 'PostToolUse', session);
}

function apps(target = graph): BubbleData[] {
  return target.getSnapshot().topFolders.filter((node) => node.commandApp);
}

function appEdges(nodeId: string, target = graph) {
  const snapshot = target.getSnapshot();
  return [...snapshot.edges, ...Object.values(snapshot.innerEdges).flat()]
    .filter((edge) => edge.source === nodeId || edge.target === nodeId);
}

function history(target = graph) {
  return Object.values(target.getSnapshot().bashHistory).flat();
}

describe('command app bubbles share the file/folder acknowledgment lifecycle', () => {
  it.each(COMMANDS)('removes %s and its activity edges on acknowledgment', (name, command) => {
    completeCommand('first', command);
    const app = apps()[0]!;
    expect(app.commandApp?.name).toBe(name);
    expect(appEdges(app.id).length).toBeGreaterThan(0);

    graph.setAgentStatus(SESSION, 'completed');
    expect(graph.markAgentIdle(SESSION, true)).toContain(app.id);

    expect(apps()).toEqual([]);
    expect(appEdges(app.id)).toEqual([]);
    expect(Object.values(graph.toProjectCheckpoint(path.basename(root)).graph.nodes)
      .some((node) => node.id === app.id)).toBe(false);
  });

  it('keeps a shared app while another owner is active and removes it after the last acknowledgment', () => {
    completeCommand('a', 'git status', 'owner-a');
    event('b', 'git status', 'PreToolUse', 'owner-b');
    const app = apps()[0]!;
    const ownerA = graph.getAgentBySession('owner-a')!.id;
    const ownerB = graph.getAgentBySession('owner-b')!.id;

    graph.setAgentStatus('owner-a', 'completed');
    expect(graph.markAgentIdle('owner-a', true)).not.toContain(app.id);
    expect(apps().map((node) => node.id)).toContain(app.id);
    expect(appEdges(app.id).some((edge) => edge.source === ownerA || edge.target === ownerA)).toBe(false);
    expect(appEdges(app.id).some((edge) => edge.source === ownerB || edge.target === ownerB)).toBe(true);

    event('b', 'git status', 'PostToolUse', 'owner-b');
    graph.setAgentStatus('owner-b', 'completed');
    expect(graph.markAgentIdle('owner-b', true)).toContain(app.id);
    expect(apps()).toEqual([]);
    expect(appEdges(app.id)).toEqual([]);
  });

  it.each(['preservePinned', 'pinned'] as const)('preserves a %s app while clearing its acknowledged edges', (pin) => {
    completeCommand('pin', 'pnpm --version');
    const app = apps()[0]!;
    if (pin === 'preservePinned') {
      expect(graph.togglePreservePinned(app.id)).toBe(true);
    } else {
      const nodes = (graph as unknown as { nodes: Map<string, BubbleData> }).nodes;
      nodes.get(app.path)!.pinned = true;
    }
    graph.setAgentStatus(SESSION, 'completed');

    expect(graph.markAgentIdle(SESSION, true)).not.toContain(app.id);
    expect(apps().find((node) => node.id === app.id)?.status).toBe('idle');
    expect(appEdges(app.id)).toEqual([]);
    vi.setSystemTime(T0 + BUBBLE_TTL * 3);
    expect(apps().map((node) => node.id)).toContain(app.id);
  });

  it('preserves command history and recreates the same app on its next use', () => {
    completeCommand('first', 'git status');
    const originalId = apps()[0]!.id;
    const originalHistory = history();
    graph.setAgentStatus(SESSION, 'completed');
    graph.markAgentIdle(SESSION, true);

    expect(apps()).toEqual([]);
    expect(history()).toEqual(originalHistory);

    event('second', 'git status');
    expect(apps().map((node) => node.id)).toEqual([originalId]);
    expect(history()).toHaveLength(2);
    expect(history().find((entry) => entry.id === 'first')).toMatchObject({
      status: 'success', output: 'finished', appNodeIds: [originalId],
    });
    expect(appEdges(originalId).length).toBeGreaterThan(0);
  });

  it.each(['restoreFromCheckpoint', 'mergeFromCheckpoint'] as const)(
    'retains ownership for acknowledgment after %s',
    (load) => {
      for (const [name, command] of COMMANDS) completeCommand(name, command);
      graph.setAgentStatus(SESSION, 'completed');
      const expectedIds = apps().map((node) => node.id);
      const cp = graph.toProjectCheckpoint(path.basename(root));
      const loaded = new ProjectGraph();
      loaded[load](structuredClone(cp));

      expect(apps(loaded).map((node) => node.id).sort()).toEqual([...expectedIds].sort());
      expect(loaded.markAgentIdle(SESSION, true).sort()).toEqual([...expectedIds].sort());
      expect(apps(loaded)).toEqual([]);
      for (const id of expectedIds) expect(appEdges(id, loaded)).toEqual([]);
      expect(history(loaded)).toHaveLength(COMMANDS.length);
    },
  );
});

describe('command app bubbles share the file/folder idle lifetime', () => {
  it.each(['completed', 'idle'] as const)('expires after the five-minute grace period following %s', (finish) => {
    completeCommand('first', 'node --version');
    const appId = apps()[0]!.id;
    if (finish === 'completed') graph.setAgentStatus(SESSION, 'completed');
    else graph.markAgentIdle(SESSION);

    vi.setSystemTime(T0 + BUBBLE_TTL - 1000);
    expect(apps().map((node) => node.id)).toContain(appId);
    vi.setSystemTime(T0 + BUBBLE_TTL + 1000);
    expect(apps()).toEqual([]);
    expect(history()).toHaveLength(1);
  });

  it('keeps the app while its owner is working, including after the command itself finishes', () => {
    event('first', 'node --version');
    const appId = apps()[0]!.id;
    vi.setSystemTime(T0 + BUBBLE_TTL * 2);
    expect(apps().map((node) => node.id)).toContain(appId);

    event('first', 'node --version', 'PostToolUse');
    vi.setSystemTime(T0 + BUBBLE_TTL * 4);
    expect(graph.getAgentBySession(SESSION)?.status).toBe('active');
    expect(apps().map((node) => node.id)).toContain(appId);

    graph.setAgentStatus(SESSION, 'completed');
    vi.setSystemTime(T0 + BUBBLE_TTL * 5 - 1000);
    expect(apps().map((node) => node.id)).toContain(appId);
    vi.setSystemTime(T0 + BUBBLE_TTL * 5 + 1000);
    expect(apps()).toEqual([]);
  });

  it('does not restart an idle app lifetime when an unrelated agent finishes', () => {
    completeCommand('first', 'node --version');
    const appId = apps()[0]!.id;
    graph.setAgentStatus(SESSION, 'completed');
    vi.setSystemTime(T0 + BUBBLE_TTL - 60_000);
    completeCommand('unrelated', 'echo finished', 'unrelated-owner');
    graph.setAgentStatus('unrelated-owner', 'completed');

    vi.setSystemTime(T0 + BUBBLE_TTL + 1000);
    expect(apps().map((node) => node.id)).not.toContain(appId);
  });

  it.each(['completed', 'idle'] as const)('does not restart the grace period on repeated %s signals', (repeat) => {
    completeCommand('first', 'git status');
    const appId = apps()[0]!.id;
    graph.setAgentStatus(SESSION, 'completed');
    vi.setSystemTime(T0 + BUBBLE_TTL - 60_000);
    if (repeat === 'completed') graph.setAgentStatus(SESSION, 'completed');
    else {
      graph.markAgentIdle(SESSION);
      graph.markAgentIdle(SESSION);
    }

    vi.setSystemTime(T0 + BUBBLE_TTL + 1000);
    expect(apps().map((node) => node.id)).not.toContain(appId);
  });

  it('keeps the ordinary Bash satellite after app acknowledgment and TTL expiration', () => {
    completeCommand('first', 'pnpm --version');
    const agentId = graph.getAgentBySession(SESSION)!.id;
    const bash = graph.getSnapshot().satellites[agentId]?.find((node) => node.bubbleType === 'bash');
    expect(bash).toBeDefined();
    expect(bash?.commandApp).toBeUndefined();

    graph.setAgentStatus(SESSION, 'completed');
    graph.markAgentIdle(SESSION, true);
    vi.setSystemTime(T0 + BUBBLE_TTL * 3);

    expect(apps()).toEqual([]);
    expect(graph.getSnapshot().satellites[agentId]?.some((node) => node.id === bash!.id)).toBe(true);
    expect(history()).toHaveLength(1);
  });

  it.each(['restoreFromCheckpoint', 'mergeFromCheckpoint'] as const)(
    'expires old command apps with empty ownership after %s',
    (load) => {
      completeCommand('first', 'git status');
      graph.setAgentStatus(SESSION, 'completed');
      const cp = graph.toProjectCheckpoint(path.basename(root));
      for (const [key, node] of Object.entries(cp.graph.nodes)) {
        if (node.commandApp) cp.graph.refs.nodeAgentRefs[key] = [];
      }
      const loaded = new ProjectGraph();
      loaded[load](structuredClone(cp));

      expect(apps(loaded)).toHaveLength(1);
      vi.setSystemTime(T0 + BUBBLE_TTL + 1000);
      expect(apps(loaded)).toEqual([]);
      expect(history(loaded)).toHaveLength(1);
    },
  );
});
