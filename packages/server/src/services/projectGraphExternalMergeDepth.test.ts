import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BubbleData } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { pathKey } from './pathKey.js';

let projectRoot: string;
let projectName: string;
let nextToolId: number;
const SESSION = 'sess-external-merge-depth';
const BASE = '/vibi-merge-tests/user/cache';

beforeEach(() => {
  projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-ext-merge-')));
  projectName = path.basename(projectRoot);
  nextToolId = 0;
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function makeGraph(): ProjectGraph {
  const graph = new ProjectGraph();
  graph.registerProject(projectRoot);
  return graph;
}

// A completed Edit hook is enough to populate external nodes; the fixture never writes outside its temp project.
function edit(graph: ProjectGraph, absolutePath: string, sessionId = SESSION): void {
  graph.processHookEvent({
    session_id: sessionId,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_use_id: `merge-depth-${++nextToolId}`,
    tool_input: { file_path: absolutePath, old_string: 'x', new_string: 'y' },
    cwd: projectRoot,
  });
}

function topExternals(graph: ProjectGraph): BubbleData[] {
  return graph.getSnapshot().topFolders.filter((node) => node.bubbleType === 'external_folder');
}

function topPaths(graph: ProjectGraph): string[] {
  return topExternals(graph).map((node) => node.path).sort();
}

function allExternalFolders(graph: ProjectGraph): BubbleData[] {
  const snapshot = graph.getSnapshot();
  return [...snapshot.topFolders, ...Object.values(snapshot.children).flat()]
    .filter((node) => node.bubbleType === 'external_folder');
}

/** The canvas draws a top-level external folder only when an agent edge reaches it — mirror that filter. */
function linkedTopPaths(graph: ProjectGraph): Record<string, string[]> {
  const snapshot = graph.getSnapshot();
  const agentIds = new Set(snapshot.agents.map((agent) => agent.id));
  const result: Record<string, string[]> = {};
  for (const node of snapshot.topFolders) {
    if (node.bubbleType !== 'external_folder') continue;
    const agents = new Set<string>();
    for (const edge of snapshot.edges) {
      if (edge.target === node.id && agentIds.has(edge.source)) agents.add(edge.source);
      if (edge.source === node.id && agentIds.has(edge.target)) agents.add(edge.target);
    }
    result[node.path] = [...agents].sort();
  }
  return result;
}

function agentIdOf(graph: ProjectGraph, sessionId: string): string {
  const internals = graph as unknown as { agents: Map<string, { id: string }> };
  return internals.agents.get(sessionId)!.id;
}

function externalFileIds(graph: ProjectGraph): Array<[string, string]> {
  return Object.values(graph.toProjectCheckpoint(projectName).graph.nodes)
    .filter((node) => node.bubbleType === 'file' && node.path.includes('__ext__'))
    .map((node): [string, string] => [node.absolutePath ?? node.path, node.id])
    .sort(([left], [right]) => left.localeCompare(right));
}

describe('external folder merge depth', () => {
  it('keeps a lone folder at its original path without creating an ancestor chain', () => {
    const graph = makeGraph();
    edit(graph, `${BASE}/tools/alpha/a.txt`);

    expect(topPaths(graph)).toEqual([`${BASE}/tools/alpha`]);
    expect(allExternalFolders(graph)).toHaveLength(1);
  });

  it.each([
    ['POSIX root', BASE],
    ['Windows drive', 'Z:/vibi-merge-tests/user/cache'],
    ['UNC share', '//vibi-merge-server/share/vibi-merge-tests/user/cache'],
  ])('defaults to two directory levels, excluding the %s', (_name, base) => {
    const graph = makeGraph();
    graph.setExternalTopBudget(40);
    edit(graph, `${base}/tools/alpha/a.txt`);
    edit(graph, `${base}/tools/beta/b.txt`);

    // Even when four levels match, the configured second level is the visible group.
    expect(topPaths(graph)).toEqual([pathKey(base.slice(0, base.lastIndexOf('/')))]);
    const group = topExternals(graph)[0]!;
    expect(group.externalDescendantFolders).toBe(2);
    expect(group.externalDescendantFiles).toBe(2);
    expect(group.externalRollupWriteCount).toBeGreaterThan(0);
    expect((graph.getSnapshot().satellites[group.id] ?? []).map((node) => node.absolutePath).sort())
      .toEqual([`${base}/tools/alpha/a.txt`, `${base}/tools/beta/b.txt`].map(pathKey).sort());
  });

  it('does not merge folders that only share the first two levels or a partial folder name', () => {
    const graph = makeGraph();
    graph.setExternalFolderMergeDepth(3);
    edit(graph, `${BASE}/alpha/a.txt`);
    edit(graph, '/vibi-merge-tests/user/cache-other/beta/b.txt');
    edit(graph, '/vibi-merge-tests/user/direct.txt');

    expect(topPaths(graph)).toEqual([
      '/vibi-merge-tests/user',
      '/vibi-merge-tests/user/cache-other/beta',
      `${BASE}/alpha`,
    ].sort());
  });

  it('keeps different drives and UNC shares separate even when directory names match', () => {
    const graph = makeGraph();
    const bases = [
      'Y:/vibi-merge-tests/user/cache',
      'Z:/vibi-merge-tests/user/cache',
      '//vibi-merge-server/share-a/vibi-merge-tests/user/cache',
      '//vibi-merge-server/share-b/vibi-merge-tests/user/cache',
    ];
    for (const base of bases) {
      edit(graph, `${base}/alpha/a.txt`);
      edit(graph, `${base}/beta/b.txt`);
    }

    // Default depth 2 groups each base at its parent — still one group per drive/share.
    expect(topPaths(graph)).toEqual(bases.map((base) => pathKey(base.slice(0, base.lastIndexOf('/')))).sort());
  });

  it('regroups existing folders immediately when depth changes without changing file identities', () => {
    const graph = makeGraph();
    edit(graph, `${BASE}/alpha/a.txt`);
    edit(graph, `${BASE}/beta/b.txt`);
    edit(graph, '/vibi-merge-tests/user/logs/gamma/c.txt');
    const files = externalFileIds(graph);

    graph.setExternalFolderMergeDepth(2);
    expect(topPaths(graph)).toEqual(['/vibi-merge-tests/user']);

    graph.setExternalFolderMergeDepth(4);
    expect(topPaths(graph)).toEqual([
      `${BASE}/alpha`, `${BASE}/beta`, '/vibi-merge-tests/user/logs/gamma',
    ].sort());

    graph.setExternalFolderMergeDepth(3);
    expect(topPaths(graph)).toEqual([BASE, '/vibi-merge-tests/user/logs/gamma'].sort());
    expect(externalFileIds(graph)).toEqual(files);
  });

  it('uses the activity budget again when merging is disabled and restores one group when enabled', () => {
    const graph = makeGraph();
    graph.setExternalFolderMergeDepth(3);
    graph.setExternalTopBudget(40);
    edit(graph, `${BASE}/alpha/a.txt`);
    edit(graph, `${BASE}/beta/b.txt`);
    expect(topPaths(graph)).toEqual([BASE]);

    graph.setExternalFolderMergeDepth(0);
    expect(topPaths(graph)).toEqual([BASE, `${BASE}/alpha`, `${BASE}/beta`]);

    graph.setExternalFolderMergeDepth(3);
    expect(topPaths(graph)).toEqual([BASE]);
  });

  it('honors an explicitly pinned child and folds it back when unpinned', () => {
    const graph = makeGraph();
    graph.setExternalFolderMergeDepth(3);
    edit(graph, `${BASE}/alpha/a.txt`);
    edit(graph, `${BASE}/beta/b.txt`);
    const beta = allExternalFolders(graph).find((node) => node.path === `${BASE}/beta`)!;
    expect(beta).toBeDefined();

    expect(graph.togglePreservePinned(beta.id)).toBe(true);
    expect(topPaths(graph)).toEqual([BASE, `${BASE}/beta`]);

    expect(graph.togglePreservePinned(beta.id)).toBe(false);
    expect(topPaths(graph)).toEqual([BASE]);
  });

  it('restores merged folders and their actual file paths from a checkpoint', () => {
    const graph = makeGraph();
    graph.setExternalFolderMergeDepth(3);
    edit(graph, `${BASE}/alpha/a.txt`);
    edit(graph, `${BASE}/beta/b.txt`);
    const files = externalFileIds(graph);
    const checkpoint = graph.toProjectCheckpoint(projectName);
    const restored = makeGraph();
    restored.setExternalFolderMergeDepth(3);
    restored.restoreFromCheckpoint(checkpoint);

    expect(topPaths(restored)).toEqual([BASE]);
    expect(externalFileIds(restored)).toEqual(files);
    const group = topExternals(restored)[0]!;
    expect(group.externalDescendantFolders).toBe(2);
    expect((restored.getSnapshot().satellites[group.id] ?? []).map((node) => node.absolutePath).sort())
      .toEqual([`${BASE}/alpha/a.txt`, `${BASE}/beta/b.txt`]);
  });

  it('removes an empty grouping ancestor when only one touched folder remains', () => {
    const graph = makeGraph();
    edit(graph, `${BASE}/alpha/a.txt`);
    edit(graph, `${BASE}/beta/b.txt`);
    const beta = allExternalFolders(graph).find((node) => node.path === `${BASE}/beta`)!;
    graph.removeBubble(beta.id);

    expect(topPaths(graph)).toEqual([`${BASE}/alpha`]);
    expect(allExternalFolders(graph).some((node) => node.path === BASE)).toBe(false);
    const remaining = topExternals(graph)[0]!;
    expect((graph.getSnapshot().satellites[remaining.id] ?? []).map((node) => node.absolutePath))
      .toEqual([`${BASE}/alpha/a.txt`]);
  });

  it('does not change internal folder hierarchy when external merge depth changes', () => {
    const graph = makeGraph();
    for (const relative of ['src/core/a.ts', 'src/view/b.ts', 'docs/c.md']) {
      const absolute = path.join(projectRoot, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, 'x\n');
      edit(graph, absolute);
    }
    const internalHierarchy = () => {
      const snapshot = graph.getSnapshot();
      return {
        roots: snapshot.topFolders.filter((node) => node.bubbleType === 'internal_folder').map((node) => node.id),
        children: Object.fromEntries(
          [...snapshot.topFolders, ...Object.values(snapshot.children).flat()]
            .filter((node) => node.bubbleType === 'internal_folder')
            .map((node) => [node.id, (snapshot.children[node.id] ?? []).map((child) => [child.id, child.path])]),
        ),
      };
    };
    const original = internalHierarchy();
    expect(original.roots.length).toBeGreaterThan(0);

    edit(graph, `${BASE}/alpha/a.txt`);
    edit(graph, `${BASE}/beta/b.txt`);
    for (const depth of [1, 4, 0, 3]) {
      graph.setExternalFolderMergeDepth(depth);
      expect(internalHierarchy()).toEqual(original);
    }
  });

  it('connects new activity to the visible merged ancestor after changing depth', () => {
    const graph = makeGraph();
    edit(graph, `${BASE}/alpha/a.txt`);
    edit(graph, `${BASE}/beta/b.txt`);
    graph.setExternalFolderMergeDepth(2);
    edit(graph, `${BASE}/alpha/a.txt`);

    const snapshot = graph.getSnapshot();
    const group = topExternals(graph)[0]!;
    const agent = snapshot.agents[0]!;
    expect(group.path).toBe('/vibi-merge-tests/user');
    expect(snapshot.edges.some((edge) => edge.source === agent.id && edge.target === group.id)).toBe(true);
  });

  it('moves existing activity to a merged ancestor without a new hook or changing its time', () => {
    const graph = makeGraph();
    graph.setExternalFolderMergeDepth(4);
    edit(graph, `${BASE}/alpha/a.txt`);
    edit(graph, `${BASE}/beta/b.txt`);
    const timestamp = Math.max(...graph.getSnapshot().edges.map((edge) => edge.timestamp));

    for (const depth of [3, 2]) {
      graph.setExternalFolderMergeDepth(depth);
      const snapshot = graph.getSnapshot();
      const group = topExternals(graph)[0]!;
      const agent = snapshot.agents[0]!;
      const edge = snapshot.edges.find((item) => item.source === agent.id && item.target === group.id);
      expect(edge).toMatchObject({ timestamp, isActive: true, label: 'Edit' });
      expect(snapshot.edges.filter((item) => item.source === agent.id)).toHaveLength(1);
    }
  });

  it('applies a depth set from one external bubble to every external folder of that project', () => {
    const graph = makeGraph();
    edit(graph, `${BASE}/alpha/a.txt`);
    edit(graph, `${BASE}/beta/b.txt`);
    edit(graph, '/vibi-merge-tests/user/logs/gamma/c.txt');
    expect(topPaths(graph)).toEqual(['/vibi-merge-tests/user']);
    const alpha = allExternalFolders(graph).find((node) => node.path === `${BASE}/alpha`)!;

    expect(graph.setExternalFolderMergeDepthForNode(alpha.id, 3)).toBe('changed');
    expect(topPaths(graph)).toEqual([BASE, '/vibi-merge-tests/user/logs/gamma']);
    for (const node of allExternalFolders(graph)) {
      expect(node).toMatchObject({ externalMergeDepth: 3, externalMergeDepthCustom: true });
    }
    expect(graph.setExternalFolderMergeDepthForNode(alpha.id, 3)).toBe('unchanged');
    expect(graph.setExternalFolderMergeDepthForNode('no-such-node', 3)).toBe('not-found');
  });

  it('keeps the project depth when the machine default changes', () => {
    const graph = makeGraph();
    edit(graph, `${BASE}/alpha/a.txt`);
    edit(graph, `${BASE}/beta/b.txt`);
    const alpha = allExternalFolders(graph).find((node) => node.path === `${BASE}/alpha`)!;
    graph.setExternalFolderMergeDepthForNode(alpha.id, 3);

    graph.setExternalFolderMergeDepth(0);
    expect(topPaths(graph)).toEqual([BASE]);
    expect(topExternals(graph)[0]).toMatchObject({ externalMergeDepth: 3, externalMergeDepthCustom: true });
  });

  it('persists the project depth in its checkpoint and clears it back to the machine default', () => {
    const graph = makeGraph();
    edit(graph, `${BASE}/alpha/a.txt`);
    edit(graph, `${BASE}/beta/b.txt`);
    const alpha = allExternalFolders(graph).find((node) => node.path === `${BASE}/alpha`)!;
    graph.setExternalFolderMergeDepthForNode(alpha.id, 3);
    const checkpoint = graph.toProjectCheckpoint(projectName);
    expect(checkpoint.externalFolderMergeDepth).toBe(3);

    const restored = makeGraph();
    restored.restoreFromCheckpoint(checkpoint);
    expect(topPaths(restored)).toEqual([BASE]);
    expect(topExternals(restored)[0]).toMatchObject({ externalMergeDepth: 3, externalMergeDepthCustom: true });

    const restoredAlpha = allExternalFolders(restored).find((node) => node.path === `${BASE}/alpha`)!;
    expect(restored.setExternalFolderMergeDepthForNode(restoredAlpha.id, null)).toBe('changed');
    expect(topPaths(restored)).toEqual(['/vibi-merge-tests/user']);
    expect(topExternals(restored)[0]!.externalMergeDepth).toBe(2);
    expect(topExternals(restored)[0]!.externalMergeDepthCustom).toBeUndefined();
    expect(restored.toProjectCheckpoint(projectName).externalFolderMergeDepth).toBeUndefined();
    expect(restored.setExternalFolderMergeDepthForNode(restoredAlpha.id, null)).toBe('unchanged');
  });

  it('keeps every split bubble linked to the agent and links the regrouped bubble again', () => {
    const graph = makeGraph();
    edit(graph, `${BASE}/alpha/a.txt`);
    edit(graph, `${BASE}/beta/b.txt`);
    edit(graph, '/vibi-merge-tests/user/logs/gamma/c.txt');
    const agent = agentIdOf(graph, SESSION);
    expect(linkedTopPaths(graph)).toEqual({ '/vibi-merge-tests/user': [agent] });

    const group = topExternals(graph)[0]!;
    expect(graph.setExternalFolderMergeDepthForNode(group.id, 4)).toBe('changed');
    expect(linkedTopPaths(graph)).toEqual({
      [`${BASE}/alpha`]: [agent],
      [`${BASE}/beta`]: [agent],
      '/vibi-merge-tests/user/logs/gamma': [agent],
    });

    const alpha = topExternals(graph).find((node) => node.path === `${BASE}/alpha`)!;
    expect(graph.setExternalFolderMergeDepthForNode(alpha.id, 2)).toBe('changed');
    expect(linkedTopPaths(graph)).toEqual({ '/vibi-merge-tests/user': [agent] });
  });

  it('links each split bubble only to the agents that touched it', () => {
    const graph = makeGraph();
    edit(graph, `${BASE}/alpha/a.txt`, 'sess-split-a');
    edit(graph, '/vibi-merge-tests/user/logs/gamma/c.txt', 'sess-split-b');
    const a = agentIdOf(graph, 'sess-split-a');
    const b = agentIdOf(graph, 'sess-split-b');
    expect(linkedTopPaths(graph)).toEqual({ '/vibi-merge-tests/user': [a, b].sort() });

    graph.setExternalFolderMergeDepthForNode(topExternals(graph)[0]!.id, 3);
    expect(linkedTopPaths(graph)).toEqual({
      [`${BASE}/alpha`]: [a],
      '/vibi-merge-tests/user/logs/gamma': [b],
    });
  });

  it('keeps an idle folder visible when it splits out of a bubble that is still on screen', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-05T00:00:00Z'));
    const graph = makeGraph();
    edit(graph, `${BASE}/alpha/a.txt`, 'sess-old');
    edit(graph, `${BASE}/beta/b.txt`, 'sess-old');
    graph.setAgentStatus('sess-old', 'completed');

    // Long past the bubble TTL, a different agent keeps the shared group alive through another folder.
    vi.setSystemTime(Date.parse('2026-11-05T00:20:00Z'));
    edit(graph, '/vibi-merge-tests/user/logs/gamma/c.txt', 'sess-new');
    expect(topPaths(graph)).toEqual(['/vibi-merge-tests/user']);

    graph.setExternalFolderMergeDepthForNode(topExternals(graph)[0]!.id, 3);
    expect(Object.keys(linkedTopPaths(graph)).sort()).toEqual([BASE, '/vibi-merge-tests/user/logs/gamma']);
  });

  it('keeps a touched parent and the group above it alive while a deeper folder is active', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-11-05T00:00:00Z'));
    const graph = makeGraph();
    edit(graph, `${BASE}/alpha/a.txt`, 'sess-old');
    edit(graph, `${BASE}/beta/b.txt`, 'sess-old');
    graph.setAgentStatus('sess-old', 'completed');

    vi.setSystemTime(Date.parse('2026-11-05T00:20:00Z'));
    edit(graph, `${BASE}/alpha/deep/d.txt`, 'sess-new');
    vi.setSystemTime(Date.parse('2026-11-05T00:30:00Z'));

    expect(topPaths(graph)).toEqual(['/vibi-merge-tests/user']);
    expect(allExternalFolders(graph).map((node) => node.path)).toContain(`${BASE}/alpha`);
  });
});
