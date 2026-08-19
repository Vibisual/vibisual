/**
 * 워크트리 프로젝트의 **루트 노드 왕복 제거** 회귀 테스트.
 *
 * 배경: 부팅 복원이 "모든 등록 프로젝트에 루트 노드 보장" 으로 워크트리에도 `__root__:<이름>` 을
 * 만들었는데, 10초마다 도는 `scanAllProjects()` → `migrateWorktreeProjects()` 스윕이 그 노드를
 * 다시 지웠다(워크트리의 화면 표현은 부모 캔버스의 워크트리 버블이라 **의도된** 삭제다).
 *
 * 그 왕복 때문에 부팅 직후 저장본에만 노드 1개가 실리고, 그 뒤의 정상적으로 비어 있는 저장본이
 * §3.2.1-3 통째-0 가드에 매 저장마다 걸렸다 — 거부는 디스크를 갱신하지 않으므로 판정 조건이
 * 그대로 남아 경고가 무한히 쌓였다.
 *
 * 계약: 워크트리 프로젝트는 **처음부터** 자기 루트 노드를 갖지 않는다(만들었다 지우는 왕복 ❌).
 * 부모의 루트 노드와 부모 캔버스의 워크트리 버블은 종전 그대로다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraph } from './projectGraph.js';
import { invalidateWorktreeLiveness } from './worktreeLiveness.js';

let parentRoot: string;
let parentName: string;

const WT_NAME = 'wt-alpha';

beforeEach(() => {
  parentRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-wtroot-')));
  parentName = path.basename(parentRoot);
  // 살아있는 워크트리 = `.git` 이 있는 `<parent>/.claude/worktrees/<이름>`.
  const wt = path.join(parentRoot, '.claude', 'worktrees', WT_NAME);
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${parentRoot}/.git/worktrees/${WT_NAME}\n`, 'utf8');
  invalidateWorktreeLiveness();
});

afterEach(() => {
  try { fs.rmSync(parentRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  invalidateWorktreeLiveness();
});

/** 부모를 등록하면 `discoverWorktrees` 가 `.claude/worktrees/*` 를 훑어 워크트리까지 함께 등록한다. */
function makeGraph(): ProjectGraph {
  const graph = new ProjectGraph();
  graph.registerProject(parentRoot);
  return graph;
}

function nodeKeys(graph: ProjectGraph, projectName: string): string[] {
  return Object.keys(graph.toProjectCheckpoint(projectName).graph.nodes);
}

function bubbleTypes(graph: ProjectGraph, projectName: string): string[] {
  return Object.values(graph.toProjectCheckpoint(projectName).graph.nodes).map((n) => n.bubbleType);
}

describe('워크트리 프로젝트에는 루트 노드를 만들지 않는다', () => {
  it('등록 직후부터 워크트리 소유 노드가 하나도 없다', () => {
    const graph = makeGraph();

    expect(nodeKeys(graph, WT_NAME)).toEqual([]);
  });

  it('워크트리의 화면 표현은 부모 캔버스의 워크트리 버블이다', () => {
    const graph = makeGraph();

    expect(bubbleTypes(graph, parentName)).toContain('worktree');
    expect(nodeKeys(graph, parentName)).toContain(`__root__:${parentName}`);
  });

  it('주기 스윕을 돌려도 그대로다 — 만들었다 지우는 왕복이 없다', () => {
    const graph = makeGraph();
    const before = nodeKeys(graph, parentName).sort();

    graph.scanAllProjects();
    graph.scanAllProjects();

    expect(nodeKeys(graph, WT_NAME)).toEqual([]);
    expect(nodeKeys(graph, parentName).sort()).toEqual(before);
  });

  it('워크트리를 직접 등록해도(훅이 워크트리 cwd 로 들어오는 경로) 루트 노드가 생기지 않는다', () => {
    const graph = makeGraph();

    graph.registerProject(path.join(parentRoot, '.claude', 'worktrees', WT_NAME));

    expect(nodeKeys(graph, WT_NAME)).toEqual([]);
  });
});

describe('체크포인트 복원에서도 워크트리 루트 노드가 되살아나지 않는다', () => {
  it('부모 체크포인트를 복원해도 워크트리는 빈 채로 남는다 (경고 무한 반복의 발화점)', () => {
    const graph = makeGraph();
    const cp = graph.toProjectCheckpoint(parentName);
    // 부모 체크포인트에는 자식 워크트리의 ProjectInfo 까지 실린다 — 복원 시 이 목록을 훑으며
    // "모든 등록 프로젝트에 루트 노드 보장" 이 워크트리 루트 노드를 만들던 자리다.
    expect(Object.values(cp.graph.projects).some((p) => p.parentProjectPath)).toBe(true);

    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(cp);

    expect(nodeKeys(restored, WT_NAME)).toEqual([]);
    expect(nodeKeys(restored, parentName)).toContain(`__root__:${parentName}`);
  });

  it('다중 프로젝트 병합 경로(mergeFromCheckpoint)도 같다', () => {
    const graph = makeGraph();
    const cp = graph.toProjectCheckpoint(parentName);

    const other = new ProjectGraph();
    other.registerProject(path.join(os.tmpdir(), 'vibi-wtroot-other'));
    other.mergeFromCheckpoint(cp);

    expect(nodeKeys(other, WT_NAME)).toEqual([]);
  });
});

describe('일반 프로젝트는 종전대로 루트 노드를 갖는다', () => {
  it('부모(비워크트리) 프로젝트의 루트 노드는 그대로 생성된다', () => {
    const graph = makeGraph();

    expect(nodeKeys(graph, parentName)).toContain(`__root__:${parentName}`);
  });
});
