/**
 * §2.1 #5 — 외부 폴더 접합 트리 회귀.
 *
 * 사용자 보고: "다 같은 부모 폴더를 갖고 있는데 계속 분할하는 문제가 있어."
 * 실측(실행 중이던 프로젝트 체크포인트): `external_folder` 48개가 **전부 최상위**였고,
 * 그중 17개는 `…/temp/claude/<프로젝트>/<세션UUID>/tasks` 로 **부모가 같은 형제**였다.
 * 세션이 하나 늘 때마다 최상위 버블이 하나 늘어 캔버스가 끝없이 쪼개졌다.
 *
 * 이제 외부 폴더도 **내부 폴더와 같은 규율**로 조상-자손을 세운다. 다만 v1.55 평탄화가
 * 막으려던 것(드라이브 루트부터 이어지는 1자형 경유 체인)은 그대로 지킨다 — 버블이 되는 것은
 * ① 에이전트가 실제로 만진 폴더와 ② 자식이 둘 이상인 분기점뿐이다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BubbleData, ProjectCheckpoint } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { pathKey } from './pathKey.js';

let projRoot: string;
let projName: string;
let extRoot: string;

const SESSION = 'sess-ext-tree';

beforeEach(() => {
  projRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-ext-tree-proj-')));
  projName = path.basename(projRoot);
  extRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-ext-tree-src-')));
});

afterEach(() => {
  for (const dir of [projRoot, extRoot]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function makeGraph(): ProjectGraph {
  const graph = new ProjectGraph();
  graph.registerProject(projRoot);
  return graph;
}

/** 외부 절대경로 파일 하나를 만들고 Edit 훅을 흘린다 (→ 그 파일의 부모가 external_folder). */
function editExternal(graph: ProjectGraph, relPath: string, uid: string): string {
  const abs = path.join(extRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'x\n', 'utf8');
  graph.processHookEvent({
    session_id: SESSION,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_use_id: uid,
    tool_input: { file_path: abs, old_string: 'x', new_string: 'y' },
    cwd: projRoot,
  });
  return abs;
}

function extFolders(graph: ProjectGraph): BubbleData[] {
  return graph.getSnapshot().topFolders.filter((n) => n.bubbleType === 'external_folder');
}

/** 스냅샷의 최상위 외부 폴더 절대경로(소문자 접힘 여부와 무관하게 비교하려면 path 사용). */
function topExtPaths(graph: ProjectGraph): string[] {
  return extFolders(graph).map((n) => n.path).sort();
}

function childPathsOf(graph: ProjectGraph, folder: BubbleData): string[] {
  const snap = graph.getSnapshot();
  return (snap.children[folder.id] ?? [])
    .filter((c) => c.bubbleType === 'external_folder')
    .map((c) => c.path)
    .sort();
}

describe('외부 폴더가 하나뿐이면 v1.55 평탄화 그대로다', () => {
  it('만진 폴더 1개 → 최상위 1개, 경유 폴더 버블 0개', () => {
    const graph = makeGraph();
    editExternal(graph, 'a/b/c/one.txt', 'toolu-1');

    const tops = topExtPaths(graph);
    expect(tops).toHaveLength(1);
    expect(tops[0]!.endsWith('/a/b/c')).toBe(true);
    // 드라이브 루트부터의 1자형 체인이 생기지 않는다.
    expect(extFolders(graph)).toHaveLength(1);
  });
});

describe('부모가 같은 외부 폴더는 최상위에서 쪼개지지 않는다', () => {
  it('형제 둘 → 공통 부모 접합 1개 밑으로 묶인다', () => {
    const graph = makeGraph();
    editExternal(graph, 'work/alpha/one.txt', 'toolu-1');
    editExternal(graph, 'work/beta/two.txt', 'toolu-2');

    const tops = extFolders(graph);
    expect(tops).toHaveLength(1);
    expect(tops[0]!.path.endsWith('/work')).toBe(true);

    const children = childPathsOf(graph, tops[0]!);
    expect(children).toHaveLength(2);
    expect(children.some((p) => p.endsWith('/work/alpha'))).toBe(true);
    expect(children.some((p) => p.endsWith('/work/beta'))).toBe(true);
  });

  it('세션 UUID 처럼 형제가 계속 늘어도 최상위는 그대로 1개다 (사용자 보고 재현)', () => {
    const graph = makeGraph();
    for (let i = 0; i < 12; i++) {
      editExternal(graph, `tmp/claude/proj/sess-${i}/tasks/t.json`, `toolu-s${i}`);
    }

    // 종전이었다면 최상위 12개. 이제는 공통 부모 하나.
    const tops = extFolders(graph);
    expect(tops).toHaveLength(1);
    expect(tops[0]!.path.endsWith('/tmp/claude/proj')).toBe(true);
    expect(childPathsOf(graph, tops[0]!)).toHaveLength(12);
  });

  it('만진 조상이 있으면 그 조상이 부모가 된다 (접합을 새로 만들지 않는다)', () => {
    const graph = makeGraph();
    editExternal(graph, 'root.txt', 'toolu-r');        // extRoot 자체를 만진다
    editExternal(graph, 'deep/one.txt', 'toolu-d1');
    editExternal(graph, 'other/two.txt', 'toolu-d2');

    const tops = extFolders(graph);
    expect(tops).toHaveLength(1);
    // 기대값도 그 OS 의 규칙으로 접는다 — 여기에 .toLowerCase() 를 박으면 대소문자를
    // 가리는 Linux 에서만 깨진다(win/mac 은 접히므로 개발기에서는 영영 안 보인다).
    expect(tops[0]!.path).toBe(pathKey(extRoot));
    expect(childPathsOf(graph, tops[0]!)).toHaveLength(2);
  });
});

describe('접합 버블은 만진 폴더처럼 굴지 않는다', () => {
  it('접합은 위성 0 · 하위 폴더 수를 childCount 로 갖는다', () => {
    const graph = makeGraph();
    editExternal(graph, 'work/alpha/one.txt', 'toolu-1');
    editExternal(graph, 'work/beta/two.txt', 'toolu-2');

    const junction = extFolders(graph)[0]!;
    expect(junction.satelliteFileCount ?? 0).toBe(0);
    expect(junction.childCount).toBe(2);
  });

  it('라벨 — 최상위는 전체 절대경로, 중첩은 부모로부터의 상대경로', () => {
    const graph = makeGraph();
    editExternal(graph, 'work/alpha/one.txt', 'toolu-1');
    editExternal(graph, 'work/beta/two.txt', 'toolu-2');

    const snap = graph.getSnapshot();
    const top = extFolders(graph)[0]!;
    expect(top.label.startsWith('(ext) ')).toBe(true);
    expect(top.label).toContain('/work');

    const kids = (snap.children[top.id] ?? []).filter((c) => c.bubbleType === 'external_folder');
    expect(kids.map((k) => k.label).sort()).toEqual(['alpha', 'beta']);
    // 전체 경로는 absolutePath 로 남아 OS 탐색기 열기가 그대로 동작한다.
    for (const k of kids) expect(k.absolutePath).toBe(k.path);
  });

  it('형제가 하나로 줄면 접합은 사라지고 남은 폴더가 최상위로 올라온다', () => {
    const graph = makeGraph();
    editExternal(graph, 'work/alpha/one.txt', 'toolu-1');
    editExternal(graph, 'work/beta/two.txt', 'toolu-2');

    const junction = extFolders(graph)[0]!;
    const beta = (graph.getSnapshot().children[junction.id] ?? [])
      .find((c) => c.bubbleType === 'external_folder' && c.path.endsWith('/beta'));
    expect(beta).toBeDefined();

    graph.removeBubble(beta!.id);

    const tops = extFolders(graph);
    expect(tops).toHaveLength(1);
    expect(tops[0]!.path.endsWith('/work/alpha')).toBe(true);
  });
});

describe('에이전트 엣지는 화면에 실제로 뜨는 최상위 버블에 걸린다', () => {
  it('중첩된 외부 폴더를 만져도 엣지 대상은 최상위 조상이다 (내부 폴더와 대칭)', () => {
    const graph = makeGraph();
    editExternal(graph, 'work/alpha/one.txt', 'toolu-1');
    editExternal(graph, 'work/beta/two.txt', 'toolu-2');

    const snap = graph.getSnapshot();
    const top = extFolders(graph)[0]!;
    const agent = snap.agents[0];
    expect(agent).toBeDefined();

    const targets = new Set(snap.edges.filter((e) => e.source === agent!.id).map((e) => e.target));
    expect(targets.has(top.id)).toBe(true);
  });
});

describe('체크포인트를 왕복해도 계층이 유지된다', () => {
  function extFolderNodes(cp: ProjectCheckpoint): BubbleData[] {
    return Object.values(cp.graph.nodes).filter((n) => n.bubbleType === 'external_folder');
  }

  it('접합도 그 탭 소속으로 저장되고 복원 후 같은 트리가 선다', () => {
    const graph = makeGraph();
    editExternal(graph, 'work/alpha/one.txt', 'toolu-1');
    editExternal(graph, 'work/beta/two.txt', 'toolu-2');

    const cp = graph.toProjectCheckpoint(projName);
    // 만진 폴더 2개 + 접합 1개
    expect(extFolderNodes(cp)).toHaveLength(3);

    const revived = makeGraph();
    revived.restoreFromCheckpoint(cp);
    const tops = extFolders(revived);
    expect(tops).toHaveLength(1);
    expect(childPathsOf(revived, tops[0]!)).toHaveLength(2);
  });

  it('평탄하게 적힌 옛 체크포인트도 열면 다시 묶인다', () => {
    const graph = makeGraph();
    editExternal(graph, 'work/alpha/one.txt', 'toolu-1');
    editExternal(graph, 'work/beta/two.txt', 'toolu-2');
    const cp = graph.toProjectCheckpoint(projName);

    // 옛 저장분 흉내 — 접합을 지우고 만진 폴더를 전부 최상위로 되돌린다.
    const junctionKey = Object.entries(cp.graph.nodes)
      .find(([k, n]) => n.bubbleType === 'external_folder' && (cp.graph.hierarchy.satelliteMap[k] ?? []).length === 0)?.[0];
    expect(junctionKey).toBeDefined();
    delete cp.graph.nodes[junctionKey!];
    delete cp.graph.hierarchy.childrenMap[junctionKey!];
    cp.graph.hierarchy.topLevelPaths = Object.keys(cp.graph.nodes)
      .filter((k) => cp.graph.nodes[k]!.bubbleType === 'external_folder');

    const revived = makeGraph();
    revived.restoreFromCheckpoint(cp);
    const tops = extFolders(revived);
    expect(tops).toHaveLength(1);
    expect(childPathsOf(revived, tops[0]!)).toHaveLength(2);
  });
});

describe('경로 모양은 세 OS 를 다 받는다 (멀티플랫폼 축 ①)', () => {
  /** POSIX 절대경로는 첫 세그먼트가 **빈 문자열**이라 루트 판정이 갈린다.
   *  개발기가 Windows 라도 이 분기는 여기서 단위로 재야 mac/linux 에서 처음 깨지지 않는다. */
  function editPosixExternal(graph: ProjectGraph, abs: string, uid: string): void {
    graph.processHookEvent({
      session_id: SESSION,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_use_id: uid,
      tool_input: { file_path: abs, old_string: 'x', new_string: 'y' },
      cwd: projRoot,
    });
  }

  it('POSIX 절대경로 형제도 공통 부모로 묶이고, 루트(`/`)는 접합이 되지 않는다', () => {
    const graph = makeGraph();
    editPosixExternal(graph, '/srv/work/alpha/one.txt', 'toolu-p1');
    editPosixExternal(graph, '/srv/work/beta/two.txt', 'toolu-p2');

    const tops = extFolders(graph);
    expect(tops).toHaveLength(1);
    expect(tops[0]!.path).toBe('/srv/work');
    expect(childPathsOf(graph, tops[0]!)).toEqual(['/srv/work/alpha', '/srv/work/beta']);
  });

  it('서로 다른 드라이브/루트는 각자 최상위로 남는다 (드라이브 루트 접합 ❌)', () => {
    const graph = makeGraph();
    editPosixExternal(graph, '/srv/one.txt', 'toolu-p1');
    editPosixExternal(graph, '/opt/two.txt', 'toolu-p2');

    expect(topExtPaths(graph)).toEqual(['/opt', '/srv']);
  });
});
