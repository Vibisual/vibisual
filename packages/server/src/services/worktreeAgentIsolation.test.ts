/**
 * §5.7 #26 — **워크트리 안에서 만든 에이전트는 워크트리 안에서 돈다.**
 *
 * 사용자 요구: "워크트리 만들면 그건 거기 내부에서 독립적으로 돌아가게 하고 싶다."
 *
 * 그 약속이 지켜지는지는 결국 사슬 하나에 달려 있다 —
 *   생성(`createCustomAgent(project=워크트리명)`) → `sessionCwds[세션] = 워크트리 경로`
 *   → `getAgentProjectName/Path(에이전트)` → **스폰 cwd**(`index.ts` 의 `setProjectResolver`)
 *   → 서브에이전트 스트림 저장 위치 · 스킬 스캔 경로.
 * 이 사슬 중 한 칸이라도 부모로 접히면 사용자는 워크트리 안에서 명령을 보냈는데 **부모 트리가**
 * 고쳐진다 — 격리를 쓰는 이유가 통째로 사라지는 사고라 여기서 못 박는다.
 *
 * 동시에 **일부러 부모로 접는 축**(대화·명령 이력의 탭 귀속)도 함께 고정한다. 그쪽까지 워크트리로
 * 갈라 두면 워크트리를 정리하는 순간 그 대화가 통째로 사라지기 때문이다(`getProjectSessionIds` 주석).
 * 둘은 반대 방향이지만 **둘 다 의도된 것**이라, 한쪽을 고치다 다른 쪽을 뒤집지 않도록 같은 파일에 둔다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraph } from './projectGraph.js';
import { invalidateWorktreeLiveness } from './worktreeLiveness.js';

let parentRoot: string;
let parentName: string;
let wtPath: string;

const WT_NAME = 'wt-iso';

beforeEach(() => {
  parentRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-wtiso-')));
  parentName = path.basename(parentRoot);
  // 살아있는 워크트리 = `.git` 이 있는 `<parent>/.claude/worktrees/<이름>` (v3.71 판정 규칙).
  wtPath = path.join(parentRoot, '.claude', 'worktrees', WT_NAME);
  fs.mkdirSync(wtPath, { recursive: true });
  fs.writeFileSync(path.join(wtPath, '.git'), `gitdir: ${parentRoot}/.git/worktrees/${WT_NAME}\n`, 'utf8');
  invalidateWorktreeLiveness();
});

afterEach(() => {
  try { fs.rmSync(parentRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  invalidateWorktreeLiveness();
});

/** 부모를 등록하면 `discoverWorktrees` 가 `.claude/worktrees/*` 를 훑어 워크트리도 함께 등록한다. */
function makeGraph(): ProjectGraph {
  const graph = new ProjectGraph();
  graph.registerProject(parentRoot);
  return graph;
}

/** 등록된 워크트리 프로젝트의 표시명 — 캔버스가 `worktreeProjects` 로 받아 생성 때 되돌려 보내는 값. */
function worktreeProjectName(graph: ProjectGraph): string {
  const snap = graph.getSnapshot();
  const names = Object.values(snap.worktreeProjects ?? {});
  expect(names.length).toBe(1);
  return names[0]!;
}

/** 경로 비교는 구분자·대소문자에 흔들리지 않게 접어서 — Windows/macOS/Linux 공통. */
function samePath(a: string | null, b: string): boolean {
  if (!a) return false;
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const A = norm(a);
  const B = norm(b);
  return A === B || A.toLowerCase() === B.toLowerCase();
}

describe('워크트리 안에서 만든 커스텀 에이전트 (§5.7 #26)', () => {
  it('워크트리가 부모와 별개의 프로젝트로 등록된다', () => {
    const graph = makeGraph();
    const wtName = worktreeProjectName(graph);
    expect(wtName).not.toBe(parentName);
    const info = graph.getProjectByName(wtName);
    expect(info?.parentProjectPath).toBeTruthy();
    expect(samePath(info?.path ?? null, wtPath)).toBe(true);
  });

  it('스폰 cwd 가 워크트리 경로다 — 부모로 접히면 워크트리 안 명령이 부모 트리를 고친다', () => {
    const graph = makeGraph();
    const wtName = worktreeProjectName(graph);
    const agent = graph.createCustomAgent('', { x: 0, y: 0 }, wtName);

    // `index.ts` 의 setProjectResolver 가 스폰 cwd 로 쓰는 바로 그 두 함수.
    expect(graph.getAgentProjectName(agent.id)).toBe(wtName);
    expect(samePath(graph.getAgentProjectPath(agent.id), wtPath)).toBe(true);
    expect(samePath(graph.getAgentCwdByAgentId(agent.id), wtPath)).toBe(true);
  });

  it('부모 캔버스에서 만든 에이전트는 종전대로 부모 트리에서 돈다', () => {
    const graph = makeGraph();
    const agent = graph.createCustomAgent('', { x: 0, y: 0 }, parentName);
    expect(graph.getAgentProjectName(agent.id)).toBe(parentName);
    expect(samePath(graph.getAgentProjectPath(agent.id), parentRoot)).toBe(true);
  });

  it('두 에이전트가 서로 다른 트리를 본다 — 같은 캔버스에서 만들어도 섞이지 않는다', () => {
    const graph = makeGraph();
    const wtName = worktreeProjectName(graph);
    const inWorktree = graph.createCustomAgent('', { x: 0, y: 0 }, wtName);
    const inParent = graph.createCustomAgent('', { x: 100, y: 0 }, parentName);
    expect(graph.getAgentProjectPath(inWorktree.id)).not.toBe(graph.getAgentProjectPath(inParent.id));
  });

  it('워크트리 파일이 부모 캔버스의 노드로 새지 않는다', () => {
    const graph = makeGraph();
    const nodes = Object.keys(graph.toProjectCheckpoint(parentName).graph.nodes);
    // 부모 캔버스에는 워크트리 **버블**만 있고, 워크트리 안 파일 노드는 하나도 없어야 한다.
    const leaked = nodes.filter((k) => k.toLowerCase().includes('/worktrees/') && !k.endsWith(WT_NAME));
    expect(leaked).toEqual([]);
  });

  it('대화·명령 이력은 **일부러** 부모 탭에 귀속된다 — 워크트리를 정리해도 남게', () => {
    const graph = makeGraph();
    const wtName = worktreeProjectName(graph);
    const agent = graph.createCustomAgent('', { x: 0, y: 0 }, wtName);
    // 저장 단위는 부모 탭 하나 — 워크트리 세션도 그 안에 실린다(§3.2 분산 저장 + getProjectSessionIds).
    const parentCk = graph.toProjectCheckpoint(parentName);
    const savedAgentIds = Object.values(parentCk.graph.agents).map((a) => a.id);
    expect(savedAgentIds).toContain(agent.id);
    // 워크트리 ProjectInfo 도 부모 체크포인트에 함께 실려야 재시작 후 cwd 가 다시 해석된다.
    const savedProjectPaths = Object.values(parentCk.graph.projects).map((p) => p.path);
    expect(savedProjectPaths.some((p) => samePath(p, wtPath))).toBe(true);
  });
});
