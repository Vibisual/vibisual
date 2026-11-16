import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectCheckpoint, ProjectMetaSnapshot, SessionMemo } from '@vibisual/shared';
import { loadCheckpointByMeta, projectDirForInfo, writeCheckpoint } from './statePersistence.js';
import { flushPendingDiskWritesSync, shutdownDiskWriteQueue } from './diskWriteQueue.js';

let directory: string;
beforeEach(() => { directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-memo-'))); });
afterEach(() => { shutdownDiskWriteQueue(); fs.rmSync(directory, { recursive: true, force: true }); });
const memo: SessionMemo = { id: 'memo', text: 'Persistent', x: -200, y: 40, w: 280, h: 180, color: '#1E293B', createdAt: 1, updatedAt: 1,
  canvas: { agentId: 'gone', subAgentId: 'gone-sub', x: 10, y: 20, folderId: null } };
function checkpoint(savedAt: number, memos: SessionMemo[]): ProjectCheckpoint {
  return {
    version: 1, seq: savedAt, savedAt, project: { name: 'Project', path: directory },
    graph: { agentCounter: 0, agents: {}, nodes: {}, projects: {}, hierarchy: { topLevelPaths: [], childrenMap: {}, satelliteMap: {} }, refs: { nodeAgentRefs: {}, sessionCwds: {} } },
    activity: { bashHistory: {}, runningServers: {}, fileEdits: {} },
    edges: { main: { edges: {}, groups: {}, refs: {} }, inner: { edges: {}, groups: {}, refs: {} } },
    canvasMemos: { Project: memos },
  };
}
function meta(cp: ProjectCheckpoint): ProjectMetaSnapshot {
  return { project: cp.project, createdAt: 1, lastSavedAt: cp.savedAt, isHydrated: false,
    checkpointPath: path.join(projectDirForInfo(cp.project), 'checkpoint.json') };
}
describe('canvas memo identity recovery', () => {
  it('recovers an orphan memo from identity when the graph checkpoint is damaged', () => {
    const cp = checkpoint(1, [memo]); expect(writeCheckpoint(cp)).toBe(true); flushPendingDiskWritesSync();
    const info = meta(cp);
    const identity = JSON.parse(fs.readFileSync(path.join(path.dirname(info.checkpointPath), 'identity.json'), 'utf8'));
    expect(identity.canvasMemos.Project).toEqual([memo]);
    fs.writeFileSync(info.checkpointPath, '{broken', 'utf8');
    expect(loadCheckpointByMeta(info)?.canvasMemos?.Project).toEqual([memo]);
  });
  it('does not resurrect permanently deleted canvas memos from an older checkpoint', () => {
    const old = checkpoint(1, [memo]);
    const source = { ...memo }; delete source.canvas;
    old.agentMemos = { gone: [source] };
    writeCheckpoint(old); flushPendingDiskWritesSync();
    const deleted = checkpoint(2, []); deleted.deletedCanvasMemoIds = ['memo'];
    writeCheckpoint(deleted); flushPendingDiskWritesSync();
    const info = meta(deleted);
    fs.writeFileSync(info.checkpointPath, JSON.stringify(old), 'utf8');
    const restored = loadCheckpointByMeta(info);
    expect(restored?.canvasMemos?.Project).toEqual([]);
    expect(restored?.agentMemos?.gone).toEqual([]);
  });
  it('retains newer checkpoint changes when identity is older', () => {
    const old = checkpoint(1, [memo]); writeCheckpoint(old); flushPendingDiskWritesSync();
    const info = meta(old);
    fs.writeFileSync(info.checkpointPath, JSON.stringify(checkpoint(2, [])), 'utf8');
    expect(loadCheckpointByMeta(info)?.canvasMemos?.Project).toEqual([]);
  });
});
