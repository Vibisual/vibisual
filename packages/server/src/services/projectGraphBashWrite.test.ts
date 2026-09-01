/**
 * §2.1 #3 쓰기 축 — **Bash 로 고쳐도 그 파일이 뜨고 화살표가 쓰기 방향으로 선다** 회귀 테스트.
 *
 * 종전에는 `>` 리다이렉트·heredoc·`tee`·`sed -i` 로 고치면 파일 버블도, 쓰기 화살표도, 수정
 * 이력(diff)도 **전부 0** 이었다 — 읽기 축(`extractBashReadPaths`)이 "바꾸는 낌새"를 통째로
 * 버렸고 그 버린 자리를 받는 축이 없었기 때문이다.
 *
 * 여기서 고정하는 것 넷:
 *  ① 사후에 파일 버블 + **에이전트 → 파일**(쓰기) 엣지가 선다.
 *  ② 사전·사후 디스크 대조로 **diff 가 합성**된다.
 *  ③ **내용이 그대로면 적지 않는다**(오탐의 마지막 관문).
 *  ④ 한 명령이 여러 파일을 고쳐도 **두 번째부터 조용히 사라지지 않는다**(uid 중복 방지의 함정).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ActivityEdge, BubbleData, FileEdit, ProjectCheckpoint } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

let projRoot: string;
let projName: string;

const SESSION = 'sess-bashwrite-1';

beforeEach(() => {
  projRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-bashwrite-')));
  projName = path.basename(projRoot);
  fs.mkdirSync(path.join(projRoot, 'src'), { recursive: true });
});

afterEach(() => {
  try { fs.rmSync(projRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

function makeGraph(): ProjectGraph {
  const graph = new ProjectGraph();
  graph.registerProject(projRoot);
  return graph;
}

/** 사전 → (디스크 변화) → 사후 를 실제 훅 순서대로 흘려보낸다. */
function runBash(graph: ProjectGraph, command: string, apply: () => void, uid = 'toolu-bash-w1'): void {
  graph.processHookEvent({
    session_id: SESSION,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_use_id: uid,
    tool_input: { command },
    cwd: projRoot,
  });
  apply();
  graph.processHookEvent({
    session_id: SESSION,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_use_id: uid,
    tool_input: { command },
    tool_response: { stdout: '' },
    cwd: projRoot,
  });
}

function nodesOf(cp: ProjectCheckpoint): BubbleData[] {
  return Object.values(cp.graph.nodes);
}

function fileNodes(cp: ProjectCheckpoint): BubbleData[] {
  return nodesOf(cp).filter((n) => n.bubbleType === 'file');
}

function mainEdges(cp: ProjectCheckpoint): ActivityEdge[] {
  return Object.values(cp.edges.main.edges ?? {});
}

/** 메인 엣지는 에이전트 ↔ **최상위 폴더** 를 잇는다(파일 단위 엣지는 inner 쪽이다). */
function topFolderId(cp: ProjectCheckpoint): string {
  const folder = nodesOf(cp).find((n) => n.bubbleType === 'internal_folder');
  if (!folder) throw new Error('내부 폴더 노드가 없다');
  return folder.id;
}

function allEdits(graph: ProjectGraph): FileEdit[] {
  return Object.values(graph.getSnapshot().fileEdits ?? {}).flat();
}

describe('① Bash 로 고치면 파일 버블이 뜨고 화살표가 쓰기 방향이다', () => {
  it('리다이렉트로 새 파일을 지으면 file 버블 + lastTool=Write', () => {
    const graph = makeGraph();
    const target = path.join(projRoot, 'src', 'a.ts');
    runBash(graph, `echo "const x = 1;" > "${target}"`, () => {
      fs.writeFileSync(target, 'const x = 1;\n', 'utf8');
    });

    const cp = graph.toProjectCheckpoint(projName);
    const files = fileNodes(cp);
    expect(files).toHaveLength(1);
    expect(files[0]!.lastTool).toBe('Write');
  });

  it('엣지는 **에이전트 → 파일**(쓰기 방향)로 선다', () => {
    const graph = makeGraph();
    const target = path.join(projRoot, 'src', 'a.ts');
    runBash(graph, `echo hi > "${target}"`, () => {
      fs.writeFileSync(target, 'hi\n', 'utf8');
    });

    const cp = graph.toProjectCheckpoint(projName);
    const edges = mainEdges(cp);
    const folderId = topFolderId(cp);
    // 방향 규칙(§2.1 한 쌍에 방향은 하나) — 쓰기는 **에이전트 → 폴더**, 즉 폴더가 target 이다.
    expect(edges.some((e) => e.label === 'Write' && e.target === folderId)).toBe(true);
    expect(edges.some((e) => e.source === folderId)).toBe(false);
  });

  it('사전(Pre)만 오면 아직 아무것도 세우지 않는다 — 실행되지 않은 명령은 거짓이다', () => {
    const graph = makeGraph();
    const target = path.join(projRoot, 'src', 'a.ts');
    graph.processHookEvent({
      session_id: SESSION,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu-pre-only',
      tool_input: { command: `echo hi > "${target}"` },
      cwd: projRoot,
    });

    expect(fileNodes(graph.toProjectCheckpoint(projName))).toHaveLength(0);
  });

  it('지운 파일에는 버블을 세우지 않는다 — 지움은 존재 확인 스윕의 몫이다', () => {
    const graph = makeGraph();
    const target = path.join(projRoot, 'src', 'gone.ts');
    fs.writeFileSync(target, 'bye\n', 'utf8');
    runBash(graph, `rm -f "${target}"`, () => {
      fs.rmSync(target, { force: true });
    });

    expect(fileNodes(graph.toProjectCheckpoint(projName))).toHaveLength(0);
  });
});

describe('② 사전·사후 디스크 대조로 diff 를 합성한다', () => {
  it('sed -i 로 고치면 수정 이력에 old/new 가 남는다', () => {
    const graph = makeGraph();
    const target = path.join(projRoot, 'src', 'a.ts');
    fs.writeFileSync(target, 'const x = 1;\n', 'utf8');

    runBash(graph, `sed -i 's/1/42/' "${target}"`, () => {
      fs.writeFileSync(target, 'const x = 42;\n', 'utf8');
    });

    const edits = allEdits(graph);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.oldString).toBe('const x = 1;\n');
    expect(edits[0]!.newString).toBe('const x = 42;\n');
  });

  it('새로 지은 파일은 old 가 비어 있다', () => {
    const graph = makeGraph();
    const target = path.join(projRoot, 'src', 'new.ts');
    runBash(graph, `cat > "${target}" <<'EOF'\nhello\nEOF`, () => {
      fs.writeFileSync(target, 'hello\n', 'utf8');
    });

    const edits = allEdits(graph);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.oldString).toBe('');
    expect(edits[0]!.newString).toBe('hello\n');
  });
});

describe('③ 내용이 그대로면 적지 않는다 (오탐의 마지막 관문)', () => {
  it('명령이 파일을 실제로 바꾸지 않았으면 이력이 남지 않는다', () => {
    const graph = makeGraph();
    const target = path.join(projRoot, 'src', 'a.ts');
    fs.writeFileSync(target, 'same\n', 'utf8');

    runBash(graph, `sed -i 's/없는것/x/' "${target}"`, () => { /* 디스크 무변화 */ });

    expect(allEdits(graph)).toHaveLength(0);
    // 그래도 "그 파일을 향한 명령"이었으므로 버블·화살표는 선다.
    expect(fileNodes(graph.toProjectCheckpoint(projName))).toHaveLength(1);
  });

  it('사전 스냅샷이 아예 없으면(사후만 도착) 적지 않는다 — 통째로 새로 쓰인 것처럼 보이지 않게', () => {
    const graph = makeGraph();
    const target = path.join(projRoot, 'src', 'a.ts');
    fs.writeFileSync(target, 'original\n', 'utf8');

    graph.processHookEvent({
      session_id: SESSION,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu-post-only',
      tool_input: { command: `sed -i 's/a/b/' "${target}"` },
      tool_response: { stdout: '' },
      cwd: projRoot,
    });

    expect(allEdits(graph)).toHaveLength(0);
    expect(fileNodes(graph.toProjectCheckpoint(projName))).toHaveLength(1);
  });
});

describe('④ 한 명령이 여러 파일을 고쳐도 전부 남는다', () => {
  it('두 번째 파일이 uid 중복 방지에 조용히 먹히지 않는다', () => {
    const graph = makeGraph();
    const a = path.join(projRoot, 'src', 'a.ts');
    const b = path.join(projRoot, 'src', 'b.ts');

    runBash(graph, `echo A > "${a}" && echo B > "${b}"`, () => {
      fs.writeFileSync(a, 'A\n', 'utf8');
      fs.writeFileSync(b, 'B\n', 'utf8');
    });

    const edits = allEdits(graph);
    expect(edits).toHaveLength(2);
    expect(edits.map((e) => e.newString).sort()).toEqual(['A\n', 'B\n']);
    expect(fileNodes(graph.toProjectCheckpoint(projName))).toHaveLength(2);
  });

  it('같은 호출이 두 번 도착해도 이력은 한 벌이다', () => {
    const graph = makeGraph();
    const target = path.join(projRoot, 'src', 'a.ts');
    const cmd = `echo hi > "${target}"`;
    runBash(graph, cmd, () => { fs.writeFileSync(target, 'hi\n', 'utf8'); });
    // 같은 tool_use_id 로 사후가 한 번 더 (재전송·중복 훅)
    graph.processHookEvent({
      session_id: SESSION,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu-bash-w1',
      tool_input: { command: cmd },
      tool_response: { stdout: '' },
      cwd: projRoot,
    });

    expect(allEdits(graph)).toHaveLength(1);
  });
});

describe('⑤ 읽기 축은 그대로다 (회귀)', () => {
  it('cat 으로 읽으면 여전히 읽기 방향(파일 → 에이전트)이다', () => {
    const graph = makeGraph();
    const target = path.join(projRoot, 'src', 'a.ts');
    fs.writeFileSync(target, 'const x = 1;\n', 'utf8');

    graph.processHookEvent({
      session_id: SESSION,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu-bash-r1',
      tool_input: { command: `cat "${target}"` },
      tool_response: { stdout: 'const x = 1;' },
      cwd: projRoot,
    });

    const cp = graph.toProjectCheckpoint(projName);
    expect(fileNodes(cp)[0]!.lastTool).toBe('Read');
    const folderId = topFolderId(cp);
    // 읽기는 **폴더 → 에이전트** — 데이터가 올라온다.
    expect(mainEdges(cp).some((e) => e.label === 'Read' && e.source === folderId)).toBe(true);
    expect(allEdits(graph)).toHaveLength(0);
  });
});
