import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BubbleData, ProjectCheckpoint, ProjectMetaSnapshot } from '@vibisual/shared';
import { loadCheckpointByMeta, projectDirForInfo, SaveScheduler, writeCheckpoint } from './statePersistence.js';
import { enableAsyncDiskWrites, getDiskWriteQueueStats, shutdownDiskWriteQueue } from './diskWriteQueue.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-recovery-')));
});

afterEach(() => {
  vi.restoreAllMocks();
  const blockedPath = path.join(tmpRoot, '.vibisual', 'save', 'checkpoint.json');
  if (fs.existsSync(blockedPath) && fs.statSync(blockedPath).isDirectory()) fs.rmdirSync(blockedPath);
  shutdownDiskWriteQueue();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function checkpoint(): ProjectCheckpoint {
  const agent: BubbleData = {
    id: 'agent-kept', label: 'Saved conversation', bubbleType: 'agent', path: '',
    status: 'idle', activity: 0, customCreated: true,
  };
  return {
    version: 1, seq: 1, savedAt: 1000,
    project: { name: 'recovery', path: tmpRoot },
    graph: {
      agentCounter: 1, agents: { 'custom-kept': agent },
      nodes: { file: { id: 'file', label: 'Kept file', bubbleType: 'file', path: 'file.ts', status: 'idle', activity: 0 } },
      projects: {}, hierarchy: { topLevelPaths: [], childrenMap: {}, satelliteMap: {} },
      refs: { nodeAgentRefs: {}, sessionCwds: { 'custom-kept': tmpRoot } },
    },
    activity: { bashHistory: {}, runningServers: {}, fileEdits: {} },
    edges: {
      main: { edges: {}, groups: {}, refs: {} },
      inner: { edges: {}, groups: {}, refs: {} },
    },
    completedCommands: {
      'custom-kept': [{ id: 'cmd-1', text: 'Keep my original request', timestamp: 100,
        subAgentId: null, status: 'completed', result: 'Saved answer' }],
    },
  };
}

function metaFor(cp: ProjectCheckpoint): ProjectMetaSnapshot {
  return {
    project: cp.project, createdAt: 1000, lastSavedAt: cp.savedAt, isHydrated: false,
    checkpointPath: path.join(projectDirForInfo(cp.project), 'checkpoint.json'),
  };
}

function failOneRename(target: string): void {
  const rename = fs.renameSync;
  let fail = true;
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (fail && to === target) {
      fail = false;
      throw new Error('Simulated temporary disk failure');
    }
    rename(from, to);
  });
}

describe('checkpoint recovery preserves conversations and explicit deletion', () => {
  it('identity-only recovery still reads the surviving activity and completed conversation', () => {
    const cp = checkpoint();
    writeCheckpoint(cp);
    const meta = metaFor(cp);
    fs.writeFileSync(meta.checkpointPath, '{broken', 'utf8');

    const restored = loadCheckpointByMeta(meta);
    expect(restored?.graph.agents['custom-kept']?.label).toBe('Saved conversation');
    expect(restored?.completedCommands).toEqual(cp.completedCommands);
  });

  it('a checkpoint backup cannot revive an agent deleted in the newer identity', () => {
    const cp = checkpoint();
    writeCheckpoint(cp);
    const meta = metaFor(cp);
    delete cp.graph.agents['custom-kept'];
    delete cp.graph.refs.sessionCwds['custom-kept'];
    cp.deletedCustomAgentIds = ['custom-kept'];
    cp.savedAt = 2000;
    writeCheckpoint(cp);
    fs.writeFileSync(meta.checkpointPath, '{broken', 'utf8');

    const restored = loadCheckpointByMeta(meta);
    expect(restored?.graph.agents['custom-kept']).toBeUndefined();
    expect(restored?.graph.refs.sessionCwds['custom-kept']).toBeUndefined();
    expect(restored?.deletedCustomAgentIds).toEqual(['custom-kept']);
    expect(restored?.graph.nodes.file?.label).toBe('Kept file');
  });

  it('checkpoint tombstones still remove stale agents when identity is unavailable', () => {
    const cp = checkpoint();
    cp.deletedCustomAgentIds = ['custom-kept'];
    writeCheckpoint(cp);
    fs.unlinkSync(path.join(projectDirForInfo(cp.project), 'identity.json'));

    const restored = loadCheckpointByMeta(metaFor(cp));
    expect(restored?.graph.agents['custom-kept']).toBeUndefined();
    expect(restored?.graph.refs.sessionCwds['custom-kept']).toBeUndefined();
  });

  it('identity-only recovery also recovers conversation history from an activity backup', () => {
    const cp = checkpoint();
    writeCheckpoint(cp);
    const meta = metaFor(cp);
    const activityPath = path.join(projectDirForInfo(cp.project), 'activity.json');
    fs.copyFileSync(activityPath, `${activityPath}.bak1`);
    fs.writeFileSync(meta.checkpointPath, '{broken', 'utf8');
    fs.writeFileSync(activityPath, '{broken', 'utf8');

    expect(loadCheckpointByMeta(meta)?.completedCommands).toEqual(cp.completedCommands);
  });
});

describe('SaveScheduler retries failed writes without requiring another edit', () => {
  it('an unchanged autosave retries a snapshot whose worker and synchronous fallback both failed', async () => {
    const cp = checkpoint();
    const scheduler = new SaveScheduler();
    const target = metaFor(cp).checkpointPath;
    fs.mkdirSync(target, { recursive: true });
    const failures = getDiskWriteQueueStats().failed;
    enableAsyncDiskWrites();
    scheduler.forceCheckpoint(cp);
    await vi.waitFor(() => {
      expect(getDiskWriteQueueStats().failed).toBeGreaterThan(failures);
      expect(getDiskWriteQueueStats().pending).toBe(1);
    });

    fs.rmdirSync(target);
    scheduler.forceCheckpoint(cp);
    await vi.waitFor(() => expect(getDiskWriteQueueStats().pending).toBe(0));
    expect(loadCheckpointByMeta(metaFor(cp))?.graph.agents).toEqual(cp.graph.agents);
  });

  it('retries the same checkpoint after a temporary core write failure', () => {
    const cp = checkpoint();
    const scheduler = new SaveScheduler();
    const meta = metaFor(cp);
    failOneRename(meta.checkpointPath);

    scheduler.forceCheckpoint(cp);
    expect(fs.existsSync(meta.checkpointPath)).toBe(false);
    scheduler.forceCheckpoint(cp);

    expect(loadCheckpointByMeta(meta)?.graph.agents).toEqual(cp.graph.agents);
  });

  it('retries the same conversation after activity write failure even if the core succeeded', () => {
    const cp = checkpoint();
    const scheduler = new SaveScheduler();
    const activityPath = path.join(projectDirForInfo(cp.project), 'activity.json');
    failOneRename(activityPath);

    scheduler.forceCheckpoint(cp);
    expect(fs.existsSync(activityPath)).toBe(false);
    scheduler.forceCheckpoint(cp);

    expect(loadCheckpointByMeta(metaFor(cp))?.completedCommands).toEqual(cp.completedCommands);
  });

  it('retries identity after a partial save instead of treating the checkpoint as fully saved', () => {
    const cp = checkpoint();
    const scheduler = new SaveScheduler();
    const identityPath = path.join(projectDirForInfo(cp.project), 'identity.json');
    failOneRename(identityPath);

    scheduler.forceCheckpoint(cp);
    expect(fs.existsSync(identityPath)).toBe(false);
    scheduler.forceCheckpoint(cp);
    expect(fs.existsSync(identityPath)).toBe(true);

    fs.writeFileSync(metaFor(cp).checkpointPath, '{broken', 'utf8');
    expect(loadCheckpointByMeta(metaFor(cp))?.graph.agents).toEqual(cp.graph.agents);
  });

  it('an undo after a partially successful save writes the original content back', () => {
    const cp = checkpoint();
    const scheduler = new SaveScheduler();
    scheduler.forceCheckpoint(cp);
    const changed = structuredClone(cp);
    changed.graph.agents['custom-kept']!.label = 'Partially saved change';
    changed.completedCommands = {};
    failOneRename(path.join(projectDirForInfo(cp.project), 'activity.json'));

    scheduler.forceCheckpoint(changed);
    scheduler.forceCheckpoint(cp);

    const restored = loadCheckpointByMeta(metaFor(cp));
    expect(restored?.graph.agents).toEqual(cp.graph.agents);
    expect(restored?.completedCommands).toEqual(cp.completedCommands);
  });
});
