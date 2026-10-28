/** §5.3 #12-3 자물쇠 영속 왕복 시험(사라지면 AI 가 그대로 연다): 디스크 포맷 · 복원·병합 · 여러 프로젝트 스냅샷 합치기 · 깨진 체크포인트의 identity 복구. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphSnapshot, ProjectCheckpoint, ProjectMetaSnapshot } from '@vibisual/shared';
import { DEFAULT_RETENTION_SETTINGS, PATH_LOCK_MAX_PER_PROJECT, pathLockId } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { mergeSnapshots } from './projectGraphManager.js';
import { loadCheckpointByMeta, projectDirForInfo, writeCheckpoint } from './statePersistence.js';
import { shutdownDiskWriteQueue } from './diskWriteQueue.js';
import { HOST_PLATFORM } from './pathKey.js';

// 보관 상한을 그 기계의 실제 app-state.json 에서 읽지 않게(감사 원장 시험과 같은 차단).
vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateGetRetention: () => ({ ...DEFAULT_RETENTION_SETTINGS }) };
});

const PROJECT_CWD = '/tmp/lock-project';
const FILE = `${PROJECT_CWD}/secret.env`;
const FOLDER = `${PROJECT_CWD}/private`;

function makeGraph(): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  const info = graph.registerProject(PROJECT_CWD);
  return { graph, projectName: info.name };
}

describe('① ② ProjectGraph — 걸고·풀고·저장하고·되살린다', () => {
  it('건 자물쇠는 스냅샷(프로젝트 이름 키)과 디스크 포맷에 실린다', () => {
    const { graph, projectName } = makeGraph();
    const result = graph.updatePathLocks(projectName, [
      { kind: 'file', target: FILE, label: 'secret.env' },
      { kind: 'folder', target: FOLDER },
    ], []);
    expect(result.changed).toBe(true);
    expect(result.rejected).toBe(0);
    expect(graph.getSnapshot().pathLocks?.[projectName]?.map((l) => l.target)).toEqual([FILE, FOLDER]);
    expect(graph.toProjectCheckpoint(projectName).pathLocks?.map((l) => l.target)).toEqual([FILE, FOLDER]);
  });

  it('껐다 켜도 그대로 — 복원은 id 를 이 플랫폼 규칙으로 다시 짓는다', () => {
    const { graph, projectName } = makeGraph();
    graph.updatePathLocks(projectName, [{ kind: 'file', target: FILE }], []);
    const cp = graph.toProjectCheckpoint(projectName);
    const fresh = new ProjectGraph();
    fresh.registerProject(PROJECT_CWD);
    fresh.restoreFromCheckpoint(cp);
    const locks = fresh.getPathLocks(projectName);
    expect(locks).toHaveLength(1);
    expect(locks[0]!.id).toBe(pathLockId('file', FILE, HOST_PLATFORM));
  });

  it('같은 대상은 한 번만 잠기고, 다 풀면 디스크 포맷에서 빠진다', () => {
    const { graph, projectName } = makeGraph();
    graph.updatePathLocks(projectName, [{ kind: 'file', target: FILE }], []);
    expect(graph.updatePathLocks(projectName, [{ kind: 'file', target: FILE }], []).changed).toBe(false);
    const id = graph.getPathLocks(projectName)[0]!.id;
    expect(graph.updatePathLocks(projectName, [], [id]).changed).toBe(true);
    expect(graph.getPathLocks(projectName)).toEqual([]);
    expect(graph.toProjectCheckpoint(projectName).pathLocks).toBeUndefined();
    expect(graph.getSnapshot().pathLocks?.[projectName]).toBeUndefined();
  });

  it('상대경로는 받지 않고, 상한을 넘는 새 자물쇠는 걸지 않는다(오래된 것을 말없이 풀지 않는다)', () => {
    const { graph, projectName } = makeGraph();
    expect(graph.updatePathLocks(projectName, [{ kind: 'file', target: 'relative.txt' }], []).rejected).toBe(1);
    const many = Array.from({ length: PATH_LOCK_MAX_PER_PROJECT + 3 }, (_, i) => ({ kind: 'file' as const, target: `${PROJECT_CWD}/f${i}.txt` }));
    const result = graph.updatePathLocks(projectName, many, []);
    expect(result.locks).toHaveLength(PATH_LOCK_MAX_PER_PROJECT);
    expect(result.rejected).toBe(3);
    expect(result.locks[0]!.target).toBe(`${PROJECT_CWD}/f0.txt`);
  });

  it('병합은 합집합 — 어긋나도 잠긴 쪽으로 남는다', () => {
    const { graph, projectName } = makeGraph();
    graph.updatePathLocks(projectName, [{ kind: 'file', target: FILE }], []);
    const cp: ProjectCheckpoint = {
      ...graph.toProjectCheckpoint(projectName),
      pathLocks: [{ id: 'stale-id', kind: 'folder', target: FOLDER, lockedAt: 7 }],
    };
    graph.mergeFromCheckpoint(cp);
    expect(graph.getPathLocks(projectName).map((l) => l.target).sort()).toEqual([FOLDER, FILE].sort());
  });
});

describe('③ 여러 프로젝트를 연 스냅샷 합치기', () => {
  it('자물쇠는 프로젝트 이름 키로 합쳐진다', () => {
    const a = new ProjectGraph();
    const b = new ProjectGraph();
    const nameA = a.registerProject('/tmp/lock-a').name;
    const nameB = b.registerProject('/tmp/lock-b').name;
    a.updatePathLocks(nameA, [{ kind: 'file', target: '/tmp/lock-a/x' }], []);
    b.updatePathLocks(nameB, [{ kind: 'host', target: 'example.com' }], []);
    const merged: GraphSnapshot = mergeSnapshots(a.getSnapshot(), b.getSnapshot());
    expect(Object.keys(merged.pathLocks ?? {}).sort()).toEqual([nameA, nameB].sort());
    expect(merged.pathLocks?.[nameB]?.[0]?.target).toBe('example.com');
  });
});

describe('④ 디스크 — 체크포인트가 깨져도 identity 가 자물쇠를 세운다', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-lock-')));
  });

  afterEach(() => {
    shutdownDiskWriteQueue();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function checkpoint(withLocks: boolean): ProjectCheckpoint {
    return {
      version: 1, seq: 1, savedAt: 1000,
      project: { name: 'lock-disk', path: tmpRoot },
      graph: {
        agentCounter: 0, agents: {},
        nodes: { file: { id: 'file', label: 'a', bubbleType: 'file', path: 'a.ts', status: 'idle', activity: 0 } },
        projects: {}, hierarchy: { topLevelPaths: [], childrenMap: {}, satelliteMap: {} },
        refs: { nodeAgentRefs: {}, sessionCwds: {} },
      },
      activity: { bashHistory: {}, runningServers: {}, fileEdits: {} },
      edges: { main: { edges: {}, groups: {}, refs: {} }, inner: { edges: {}, groups: {}, refs: {} } },
      ...(withLocks ? { pathLocks: [{ id: 'x', kind: 'file' as const, target: `${tmpRoot}/secret.env`, lockedAt: 5 }] } : {}),
    };
  }

  function metaFor(cp: ProjectCheckpoint): ProjectMetaSnapshot {
    return {
      project: cp.project, createdAt: 1000, lastSavedAt: cp.savedAt, isHydrated: false,
      checkpointPath: path.join(projectDirForInfo(cp.project), 'checkpoint.json'),
    };
  }

  it('identity.json 에 함께 저장되고, 체크포인트가 죽어도 그 골격이 자물쇠를 든다', () => {
    const cp = checkpoint(true);
    writeCheckpoint(cp);
    const meta = metaFor(cp);
    const identity = JSON.parse(fs.readFileSync(path.join(path.dirname(meta.checkpointPath), 'identity.json'), 'utf8'));
    expect(identity.pathLocks?.[0]?.target).toBe(`${tmpRoot}/secret.env`);
    fs.writeFileSync(meta.checkpointPath, '{broken', 'utf8');
    for (let i = 1; i <= 3; i++) fs.rmSync(`${meta.checkpointPath}.bak${i}`, { force: true });
    const restored = loadCheckpointByMeta(meta);
    expect(restored?.pathLocks?.map((l) => l.target)).toEqual([`${tmpRoot}/secret.env`]);
  });

  it('체크포인트에서 빠졌어도 identity 보충이 되살린다(합집합)', () => {
    const cp = checkpoint(true);
    writeCheckpoint(cp);
    const meta = metaFor(cp);
    const onDisk = JSON.parse(fs.readFileSync(meta.checkpointPath, 'utf8')) as ProjectCheckpoint;
    delete onDisk.pathLocks;
    fs.writeFileSync(meta.checkpointPath, JSON.stringify(onDisk), 'utf8');
    const restored = loadCheckpointByMeta(meta);
    expect(restored?.pathLocks?.map((l) => l.target)).toEqual([`${tmpRoot}/secret.env`]);
  });

  it('자물쇠가 없는 프로젝트의 identity 는 그 칸을 만들지 않는다', () => {
    const cp = checkpoint(false);
    writeCheckpoint(cp);
    const meta = metaFor(cp);
    const identity = JSON.parse(fs.readFileSync(path.join(path.dirname(meta.checkpointPath), 'identity.json'), 'utf8'));
    expect(identity).not.toHaveProperty('pathLocks');
  });
});
