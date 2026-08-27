/**
 * §5.7 #26 — **만들어지는 중인 워크트리는 아무도 발견하지 않는다** 회귀 테스트.
 *
 * 배경: 살아있음 판정(`<wt>/.git` 존재)은 체크아웃이 끝나기 한참 전에 이미 true 가 된다 —
 * git 은 관리 디렉토리를 먼저 연결하고 파일을 나중에 푼다. 그래서 `git worktree add` 가 도는
 * 동안 10초 세션 스윕(`scanAllProjects` → `discoverWorktrees`)이 반쯤 만들어진 폴더를 주워
 * **좌표가 정해지기 전에** 워크트리 버블을 만들어 버렸다. 클라이언트는 좌표 없는 버블을 방사형
 * 레이아웃 자리에 앉히고 그 위치를 캐시하므로, 생성이 끝난 뒤 서버가 실어 보내는 **진짜 좌표는
 * 영영 무시**된다 — 사용자가 우클릭한 자리가 아닌 곳에 새 워크트리가 서던 원인이다.
 *
 * 계약: 생성 유예가 걸린 동안에는 버블이 생기지 않고, 유예가 풀리면 곧바로 발견된다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraph } from './projectGraph.js';
import {
  beginWorktreeCreation,
  endWorktreeCreation,
  isWorktreeUnderConstruction,
  invalidateWorktreeLiveness,
} from './worktreeLiveness.js';

let parentRoot: string;
let parentName: string;
let wtDir: string;

const WT_NAME = 'wt-20260827-101112';

/** `git worktree add` 가 막 `.git` 을 붙인 상태 — 파일은 아직 다 안 풀렸다. */
function makeHalfBuiltWorktree(): string {
  const wt = path.join(parentRoot, '.claude', 'worktrees', WT_NAME);
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${parentRoot}/.git/worktrees/${WT_NAME}\n`, 'utf8');
  return wt;
}

function worktreeLabels(graph: ProjectGraph): string[] {
  return Object.values(graph.toProjectCheckpoint(parentName).graph.nodes)
    .filter((n) => n.bubbleType === 'worktree')
    .map((n) => n.label);
}

beforeEach(() => {
  parentRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-wtcreate-')));
  parentName = path.basename(parentRoot);
  wtDir = makeHalfBuiltWorktree();
  invalidateWorktreeLiveness();
});

afterEach(() => {
  endWorktreeCreation(wtDir);
  try { fs.rmSync(parentRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  invalidateWorktreeLiveness();
});

describe('생성 유예 표시', () => {
  it('시작하면 켜지고 끝내면 꺼진다', () => {
    expect(isWorktreeUnderConstruction(wtDir)).toBe(false);
    beginWorktreeCreation(wtDir);
    expect(isWorktreeUnderConstruction(wtDir)).toBe(true);
    endWorktreeCreation(wtDir);
    expect(isWorktreeUnderConstruction(wtDir)).toBe(false);
  });

  it('경로 표기(역슬래시·끝 슬래시)가 달라도 같은 폴더로 본다', () => {
    beginWorktreeCreation(wtDir.replace(/\//g, '\\'));
    expect(isWorktreeUnderConstruction(`${wtDir.replace(/\\/g, '/')}/`)).toBe(true);
  });

  it('다른 워크트리에는 번지지 않는다', () => {
    beginWorktreeCreation(wtDir);
    expect(isWorktreeUnderConstruction(path.join(parentRoot, '.claude', 'worktrees', 'wt-other'))).toBe(false);
  });
});

describe('발견 — 만들어지는 중에는 버블이 생기지 않는다', () => {
  it('유예가 걸린 폴더는 부모 등록 시 워크트리 버블을 만들지 않는다', () => {
    beginWorktreeCreation(wtDir);

    const graph = new ProjectGraph();
    graph.registerProject(parentRoot);

    expect(worktreeLabels(graph)).toEqual([]);
  });

  it('그 사이 주기 스윕이 몇 번을 돌아도 마찬가지다(좌표 없는 버블이 먼저 태어나던 자리)', () => {
    beginWorktreeCreation(wtDir);

    const graph = new ProjectGraph();
    graph.registerProject(parentRoot);
    graph.scanAllProjects();
    graph.scanAllProjects();

    expect(worktreeLabels(graph)).toEqual([]);
  });

  it('유예가 풀리면 다음 스윕에서 곧바로 발견된다', () => {
    beginWorktreeCreation(wtDir);
    const graph = new ProjectGraph();
    graph.registerProject(parentRoot);
    expect(worktreeLabels(graph)).toEqual([]);

    endWorktreeCreation(wtDir);
    graph.scanAllProjects();

    expect(worktreeLabels(graph)).toEqual([WT_NAME]);
  });

  it('유예를 걸지 않으면 종전대로 발견된다 — 가드가 평소 경로를 막지 않는다', () => {
    const graph = new ProjectGraph();
    graph.registerProject(parentRoot);

    expect(worktreeLabels(graph)).toEqual([WT_NAME]);
  });
});
