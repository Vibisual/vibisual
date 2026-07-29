/**
 * worktreeLiveness + writeCheckpoint 워크트리 가드 테스트 (v3.71).
 *
 * 회귀 방지 대상: 사용자가 지운 워크트리 폴더를 오토세이브가 `mkdirSync` 로 되살리던 버그.
 * "폴더가 있는가" 가 아니라 "아직 살아있는 git 워크트리인가(`.git` 존재)" 로 판정해야 한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectCheckpoint, ProjectInfo } from '@vibisual/shared';
import {
  isDeadWorktreeProject,
  isLiveWorktreeDir,
  isUnderDeadWorktree,
  invalidateWorktreeLiveness,
  worktreeRootOf,
} from './worktreeLiveness.js';
import { atomicWriteFileSync, writeCheckpoint } from './statePersistence.js';

let tmpRoot: string;

/** `<parent>/.claude/worktrees/<name>` 을 만들고, live 면 `.git` 파일까지 둔다. */
function makeWorktree(parent: string, name: string, live: boolean): string {
  const wt = path.join(parent, '.claude', 'worktrees', name);
  fs.mkdirSync(wt, { recursive: true });
  if (live) fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${parent}/.git/worktrees/${name}\n`, 'utf8');
  return wt;
}

function makeCheckpoint(project: ProjectInfo): ProjectCheckpoint {
  return {
    version: 1,
    seq: 1,
    savedAt: Date.now(),
    project,
    graph: {
      agentCounter: 0,
      agents: {},
      nodes: { [`root:${project.name}`]: { id: 'root-1', label: project.name, bubbleType: 'root', path: project.path, status: 'idle', activity: 0, lastActivity: Date.now(), childCount: 0 } },
      refs: {},
    },
  } as unknown as ProjectCheckpoint;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-wt-'));
  invalidateWorktreeLiveness();
});

afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  invalidateWorktreeLiveness();
});

describe('worktreeRootOf', () => {
  it('워크트리 하위 파일 경로에서 워크트리 루트를 뽑는다', () => {
    expect(worktreeRootOf('C:/p/.claude/worktrees/agent-ae33/.vibisual/save/checkpoint.json'))
      .toBe('C:/p/.claude/worktrees/agent-ae33');
    expect(worktreeRootOf('C:\\p\\.claude\\worktrees\\wt-1'))
      .toBe('C:/p/.claude/worktrees/wt-1');
  });

  it('워크트리 밖 경로는 null', () => {
    expect(worktreeRootOf('C:/p/src/index.ts')).toBeNull();
    expect(worktreeRootOf('')).toBeNull();
  });
});

describe('isLiveWorktreeDir', () => {
  it('.git 이 있으면 살아있다', () => {
    const wt = makeWorktree(tmpRoot, 'alive', true);
    expect(isLiveWorktreeDir(wt)).toBe(true);
  });

  it('.git 이 없는 좀비 폴더는 죽은 것으로 본다', () => {
    const wt = makeWorktree(tmpRoot, 'zombie', false);
    fs.writeFileSync(path.join(wt, 'leftover.bin'), 'locked', 'utf8');
    expect(isLiveWorktreeDir(wt)).toBe(false);
  });
});

describe('isUnderDeadWorktree / isDeadWorktreeProject', () => {
  it('죽은 워크트리 안의 파일 경로를 잡아낸다', () => {
    const wt = makeWorktree(tmpRoot, 'dead', false);
    expect(isUnderDeadWorktree(path.join(wt, 'sub-streams', 'a', 'b.jsonl'))).toBe(true);
  });

  it('일반 프로젝트 경로는 워크트리 판정 대상이 아니다', () => {
    expect(isUnderDeadWorktree(path.join(tmpRoot, 'src', 'a.ts'))).toBe(false);
    expect(isDeadWorktreeProject({ path: tmpRoot })).toBe(false);
  });

  it('parentProjectPath 가 있는 인스턴스는 임의 위치여도 워크트리로 판정한다', () => {
    const wt = path.join(tmpRoot, 'elsewhere-wt');
    fs.mkdirSync(wt, { recursive: true });
    expect(isDeadWorktreeProject({ path: wt, parentProjectPath: tmpRoot })).toBe(true);
    fs.writeFileSync(path.join(wt, '.git'), 'gitdir: x', 'utf8');
    invalidateWorktreeLiveness(wt);
    expect(isDeadWorktreeProject({ path: wt, parentProjectPath: tmpRoot })).toBe(false);
  });
});

describe('atomicWriteFileSync 최종 방어선', () => {
  it('죽은 워크트리 안에 새 디렉토리를 만들지 않고 거부한다', () => {
    const wt = makeWorktree(tmpRoot, 'agent-dead-brain', false);
    const target = path.join(wt, '.vibisual', 'brain', 'project', 'card-1.md');
    expect(() => atomicWriteFileSync(target, 'x')).toThrow(/no longer tracks/);
    expect(fs.existsSync(path.join(wt, '.vibisual'))).toBe(false);
  });

  it('살아있는 워크트리에는 종전대로 디렉토리를 만들고 쓴다', () => {
    const wt = makeWorktree(tmpRoot, 'agent-live-brain', true);
    const target = path.join(wt, '.vibisual', 'brain', 'project', 'card-1.md');
    atomicWriteFileSync(target, 'ok');
    expect(fs.readFileSync(target, 'utf8')).toBe('ok');
  });

  it('워크트리 밖 경로는 영향을 받지 않는다', () => {
    const target = path.join(tmpRoot, 'anywhere', 'deep', 'file.json');
    atomicWriteFileSync(target, '{}');
    expect(fs.existsSync(target)).toBe(true);
  });
});

describe('writeCheckpoint 워크트리 가드', () => {
  it('죽은 워크트리 폴더에는 저장 디렉토리를 만들지 않는다 (부활 차단)', () => {
    const wt = makeWorktree(tmpRoot, 'agent-dead', false);
    const project: ProjectInfo = { name: 'agent-dead', path: wt.replace(/\\/g, '/'), parentProjectPath: tmpRoot.replace(/\\/g, '/'), worktreeName: 'agent-dead' } as ProjectInfo;

    writeCheckpoint(makeCheckpoint(project));

    expect(fs.existsSync(path.join(wt, '.vibisual'))).toBe(false);
  });

  it('살아있는 워크트리에는 종전대로 저장한다', () => {
    const wt = makeWorktree(tmpRoot, 'agent-live', true);
    const project: ProjectInfo = { name: 'agent-live', path: wt.replace(/\\/g, '/'), parentProjectPath: tmpRoot.replace(/\\/g, '/'), worktreeName: 'agent-live' } as ProjectInfo;

    writeCheckpoint(makeCheckpoint(project));

    expect(fs.existsSync(path.join(wt, '.vibisual', 'save', 'checkpoint.json'))).toBe(true);
  });

  it('워크트리가 아닌 일반 프로젝트 저장은 영향을 받지 않는다', () => {
    const proj = path.join(tmpRoot, 'normal-project');
    fs.mkdirSync(proj, { recursive: true });
    const project: ProjectInfo = { name: 'normal-project', path: proj.replace(/\\/g, '/') } as ProjectInfo;

    writeCheckpoint(makeCheckpoint(project));

    expect(fs.existsSync(path.join(proj, '.vibisual', 'save', 'checkpoint.json'))).toBe(true);
  });
});
