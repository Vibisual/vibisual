import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RETENTION_SETTINGS, normalizeAgentProvider } from '@vibisual/shared';
import type { AgentProvider, ProjectCheckpoint, ProjectMetaSnapshot } from '@vibisual/shared';

// Use only fixture preferences and a temporary project; never load the user's settings or logs.
vi.mock('./userDefaultsService.js', () => ({
  userDefaultsService: { get: () => ({ updatedAt: 1 }), subscribe: () => () => {} },
}));
vi.mock('./appState.js', () => ({ appStateGetRetention: () => ({ ...DEFAULT_RETENTION_SETTINGS }) }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { ProjectGraph } = await import('./projectGraph.js');
const { loadCheckpointByMeta, loadIdentityFromDir, projectDirForInfo, writeCheckpoint } = await import('./statePersistence.js');
const { shutdownDiskWriteQueue } = await import('./diskWriteQueue.js');

const SELECTIONS: AgentProvider[] = [
  { kind: 'codex-cli', modelId: 'gpt-future-fixture', reasoningEffort: 'future-effort', serviceTier: 'future-tier' },
  { kind: 'codex-cli', modelId: 'team/custom-model', reasoningEffort: 'ultra', serviceTier: 'custom-tier' },
  { kind: 'codex-cli', modelId: 'gpt-5.5', reasoningEffort: 'xhigh', serviceTier: 'priority' },
];

let tmpRoot: string;
beforeEach(() => { tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-codex-model-'))); });
afterEach(() => {
  shutdownDiskWriteQueue();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function seed(): { checkpoint: ProjectCheckpoint; agentIds: string[] } {
  const graph = new ProjectGraph();
  const project = graph.registerProject(tmpRoot);
  const agentIds = SELECTIONS.map((selection) => {
    const agent = graph.createCustomAgent('Saved Codex selection', undefined, project.name);
    const provider = normalizeAgentProvider({ ...selection, modelId: ` ${selection.modelId} ` });
    expect(provider).toEqual(selection);
    graph.setAgentConfig(agent.id, { ...graph.getAgentConfig(agent.id)!, provider });
    return agent.id;
  });
  return { checkpoint: graph.toProjectCheckpoint(project.name), agentIds };
}

function diskCopy(checkpoint: ProjectCheckpoint): ProjectCheckpoint {
  return JSON.parse(JSON.stringify(checkpoint)) as ProjectCheckpoint;
}

function metaFor(checkpoint: ProjectCheckpoint): ProjectMetaSnapshot {
  return {
    project: checkpoint.project, createdAt: 1000, lastSavedAt: checkpoint.savedAt, isHydrated: false,
    checkpointPath: path.join(projectDirForInfo(checkpoint.project), 'checkpoint.json'),
  };
}

function expectSelections(graph: InstanceType<typeof ProjectGraph>, agentIds: string[], projectName: string): ProjectCheckpoint {
  const saved = diskCopy(graph.toProjectCheckpoint(projectName));
  for (const [index, id] of agentIds.entries()) {
    const expected = SELECTIONS[index]!;
    expect(graph.getAgentConfig(id)?.provider).toMatchObject(expected);
    expect(graph.getAgentConfigOverrides(id)?.provider).toMatchObject(expected);
    expect(saved.agentConfigs?.[id]?.provider).toMatchObject(expected);
    expect(saved.agentConfigOverrides?.[id]?.provider).toMatchObject(expected);
  }
  return saved;
}

describe('saved Codex selections survive without a current catalog entry', () => {
  it.each(['restore', 'merge'] as const)('%s and re-save preserve current and legacy model settings', (mode) => {
    const { checkpoint, agentIds } = seed();
    for (const legacy of [false, true]) {
      const input = diskCopy(checkpoint);
      if (legacy) delete input.agentConfigOverrides;
      const restored = new ProjectGraph();
      if (mode === 'restore') restored.restoreFromCheckpoint(input);
      else restored.mergeFromCheckpoint(input);
      expectSelections(restored, agentIds, checkpoint.project.name);

      // Saving another setting must not reset a model that disappeared from the catalog.
      for (const id of agentIds) {
        restored.setAgentConfig(id, { ...restored.getAgentConfig(id)!, permissionMode: 'plan' });
      }
      const fresh = new ProjectGraph();
      fresh.restoreFromCheckpoint(expectSelections(restored, agentIds, checkpoint.project.name));
      expectSelections(fresh, agentIds, checkpoint.project.name);
    }
  });

  it.each(['missing-config', 'corrupt-checkpoint'] as const)('%s recovers model settings from identity and persists them again', (damage) => {
    const { checkpoint, agentIds } = seed();
    writeCheckpoint(checkpoint);
    const meta = metaFor(checkpoint);
    const identity = loadIdentityFromDir(path.dirname(meta.checkpointPath));
    for (const [index, id] of agentIds.entries()) {
      expect(identity?.agentConfigs[id]?.provider).toMatchObject(SELECTIONS[index]!);
      expect(identity?.agentConfigOverrides?.[id]?.provider).toMatchObject(SELECTIONS[index]!);
    }

    if (damage === 'corrupt-checkpoint') {
      // The first write has no backup, so recovery must use identity.json alone.
      expect(fs.existsSync(`${meta.checkpointPath}.bak1`)).toBe(false);
      fs.writeFileSync(meta.checkpointPath, '{broken', 'utf8');
    } else {
      const damaged = diskCopy(checkpoint);
      damaged.agentConfigs = {};
      damaged.agentConfigOverrides = {};
      fs.writeFileSync(meta.checkpointPath, JSON.stringify(damaged), 'utf8');
    }
    const loaded = loadCheckpointByMeta(meta);
    expect(loaded).not.toBeNull();
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(loaded!);
    writeCheckpoint(expectSelections(restored, agentIds, checkpoint.project.name));
    const fresh = new ProjectGraph();
    fresh.restoreFromCheckpoint(loadCheckpointByMeta(meta)!);
    expectSelections(fresh, agentIds, checkpoint.project.name);
  });

  it('identity supplementation cannot replace a newer explicit selection', () => {
    const { checkpoint, agentIds } = seed();
    writeCheckpoint(checkpoint);
    const newer = diskCopy(checkpoint);
    const id = agentIds[0]!;
    const provider: AgentProvider = { kind: 'codex-cli', modelId: 'my-new-model', reasoningEffort: 'max', serviceTier: 'ultrafast' };
    newer.agentConfigs![id]!.provider = provider;
    newer.agentConfigOverrides![id]!.provider = provider;
    const meta = metaFor(checkpoint);
    fs.writeFileSync(meta.checkpointPath, JSON.stringify(newer), 'utf8');

    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(loadCheckpointByMeta(meta)!);
    expect(restored.getAgentConfig(id)?.provider).toMatchObject(provider);
    expect(restored.toProjectCheckpoint(checkpoint.project.name).agentConfigOverrides?.[id]?.provider).toMatchObject(provider);
  });
});
