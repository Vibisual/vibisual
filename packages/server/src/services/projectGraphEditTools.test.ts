/**
 * §2.1 #3 — **`MultiEdit`/`NotebookEdit` 로 고쳐도 그 파일이 뜬다** 회귀 테스트.
 *
 * 종전에는 `FILE_PATH_KEYS` 가 `Read`/`Write`/`Edit`/`Grep`/`Glob` 다섯뿐이라, 이 두 도구는
 * 감사 원장(`AUDIT_WRITE_TOOLS`)과 IDE 스트림(`DIFF_INPUT_TOOLS`)에는 남는데 **캔버스에는
 * 한 획도 안 그려졌다** — 파일 버블 ✗ 쓰기 화살표 ✗ 수정 이력 ✗.
 *
 * 여기서 고정하는 것 다섯:
 *  ① 파일 버블 + **에이전트 → 파일**(쓰기) 엣지가 선다.
 *  ② `MultiEdit` 조각 여러 개는 **이력 한 줄**로 접힌다(호출 하나 = 한 줄).
 *  ③ `NotebookEdit` 는 `notebook_path` 에서 경로를 꺼내고, `file_path` 로 와도 받는다.
 *  ④ `old_source` 가 없으면 이전 본문을 지어내지 않는다(old='').
 *  ⑤ 기존 `Edit`/`Write` 동작은 그대로다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ActivityEdge, BubbleData, FileEdit, ProjectCheckpoint } from '@vibisual/shared';
import { MAX_FILE_EDITS } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

let projRoot: string;
let projName: string;

const SESSION = 'sess-edittools-1';

beforeEach(() => {
  projRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-edittools-')));
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

/** 훅 한 방(사후). 편집 계열은 Pre/Post 둘 다 수용하므로 한쪽만으로 충분하다. */
function runTool(
  graph: ProjectGraph,
  toolName: string,
  toolInput: Record<string, unknown>,
  uid = `toolu-${toolName}-1`,
): void {
  graph.processHookEvent({
    session_id: SESSION,
    hook_event_name: 'PostToolUse',
    tool_name: toolName,
    tool_use_id: uid,
    tool_input: toolInput,
    tool_response: {},
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

describe('① MultiEdit — 버블이 뜨고 화살표가 쓰기 방향이다', () => {
  it('파일 버블 + lastTool=MultiEdit', () => {
    const graph = makeGraph();
    const target = path.join(projRoot, 'src', 'a.ts');
    runTool(graph, 'MultiEdit', {
      file_path: target,
      edits: [{ old_string: 'const x = 1;', new_string: 'const x = 42;' }],
    });

    const cp = graph.toProjectCheckpoint(projName);
    const files = fileNodes(cp);
    expect(files).toHaveLength(1);
    expect(files[0]!.lastTool).toBe('MultiEdit');
  });

  it('엣지는 **에이전트 → 파일**(쓰기 방향) — READ_TOOLS 밖이라 방향 규칙이 그대로 선다', () => {
    const graph = makeGraph();
    runTool(graph, 'MultiEdit', {
      file_path: path.join(projRoot, 'src', 'a.ts'),
      edits: [{ old_string: 'a', new_string: 'b' }],
    });

    const cp = graph.toProjectCheckpoint(projName);
    const folderId = topFolderId(cp);
    expect(mainEdges(cp).some((e) => e.label === 'MultiEdit' && e.target === folderId)).toBe(true);
    expect(mainEdges(cp).some((e) => e.source === folderId)).toBe(false);
  });
});

describe('② MultiEdit 조각 여러 개는 이력 한 줄로 접힌다', () => {
  it('조각 셋이 한 줄에 줄바꿈으로 이어 붙는다', () => {
    const graph = makeGraph();
    runTool(graph, 'MultiEdit', {
      file_path: path.join(projRoot, 'src', 'a.ts'),
      edits: [
        { old_string: 'const a = 1;', new_string: 'const a = 10;' },
        { old_string: 'const b = 2;', new_string: 'const b = 20;' },
        { old_string: 'const c = 3;', new_string: 'const c = 30;' },
      ],
    });

    const edits = allEdits(graph);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.oldString).toBe('const a = 1;\nconst b = 2;\nconst c = 3;');
    expect(edits[0]!.newString).toBe('const a = 10;\nconst b = 20;\nconst c = 30;');
  });

  it('조각이 MAX_FILE_EDITS 보다 많아도 그 파일의 지난 이력을 밀어내지 않는다', () => {
    const graph = makeGraph();
    const target = path.join(projRoot, 'src', 'a.ts');
    // 먼저 평범한 Edit 한 건을 남긴다.
    runTool(graph, 'Edit', { file_path: target, old_string: 'old', new_string: 'new' }, 'toolu-seed');

    const many = Array.from({ length: MAX_FILE_EDITS + 5 }, (_, i) => ({
      old_string: `line${i}`,
      new_string: `LINE${i}`,
    }));
    runTool(graph, 'MultiEdit', { file_path: target, edits: many }, 'toolu-many');

    // 병합창(§3.2.3 D축)이 두 건을 하나로 접을 수 있으므로 "한 호출이 20건을 만들지 않았다"만 본다.
    const edits = allEdits(graph);
    expect(edits.length).toBeLessThanOrEqual(2);
    expect(edits[0]!.newString).toContain(`LINE${MAX_FILE_EDITS + 4}`);
  });

  it('조각이 하나도 성립하지 않으면 빈 이력을 남기지 않는다', () => {
    const graph = makeGraph();
    runTool(graph, 'MultiEdit', {
      file_path: path.join(projRoot, 'src', 'a.ts'),
      edits: [{ old_string: 'a' }, { new_string: 'b' }, 42],
    });

    expect(allEdits(graph)).toHaveLength(0);
    // 경로 인자는 멀쩡하므로 "그 파일을 향한 호출"로 버블·화살표는 선다.
    expect(fileNodes(graph.toProjectCheckpoint(projName))).toHaveLength(1);
  });
});

describe('③ NotebookEdit — notebook_path 에서 경로를 꺼낸다', () => {
  it('파일 버블 + 쓰기 엣지 + 이력', () => {
    const graph = makeGraph();
    runTool(graph, 'NotebookEdit', {
      notebook_path: path.join(projRoot, 'src', 'nb.ipynb'),
      new_source: 'print(42)',
      old_source: 'print(1)',
    });

    const cp = graph.toProjectCheckpoint(projName);
    const files = fileNodes(cp);
    expect(files).toHaveLength(1);
    expect(files[0]!.lastTool).toBe('NotebookEdit');
    expect(mainEdges(cp).some((e) => e.label === 'NotebookEdit' && e.target === topFolderId(cp))).toBe(true);

    const edits = allEdits(graph);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.oldString).toBe('print(1)');
    expect(edits[0]!.newString).toBe('print(42)');
    expect(edits[0]!.filePath.endsWith('/nb.ipynb')).toBe(true);
  });

  it('경로가 file_path 로 와도 받는다 — 버블과 이력이 **같은 폴백 순서**를 본다', () => {
    const graph = makeGraph();
    runTool(graph, 'NotebookEdit', {
      file_path: path.join(projRoot, 'src', 'nb.ipynb'),
      new_source: 'print(7)',
    });

    expect(fileNodes(graph.toProjectCheckpoint(projName))).toHaveLength(1);
    expect(allEdits(graph)).toHaveLength(1);
  });

  it('④ old_source 가 없으면 이전 본문을 지어내지 않는다', () => {
    const graph = makeGraph();
    runTool(graph, 'NotebookEdit', {
      notebook_path: path.join(projRoot, 'src', 'nb.ipynb'),
      new_source: 'print(7)',
    });

    const edits = allEdits(graph);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.oldString).toBe('');
    expect(edits[0]!.newString).toBe('print(7)');
  });

  it('new_source 가 없으면 이력을 남기지 않는다', () => {
    const graph = makeGraph();
    runTool(graph, 'NotebookEdit', {
      notebook_path: path.join(projRoot, 'src', 'nb.ipynb'),
      cell_id: 'c1',
    });

    expect(allEdits(graph)).toHaveLength(0);
  });
});

describe('⑤ 기존 도구는 그대로다 (회귀)', () => {
  it('Edit — old_string → new_string', () => {
    const graph = makeGraph();
    runTool(graph, 'Edit', {
      file_path: path.join(projRoot, 'src', 'a.ts'),
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    });

    const edits = allEdits(graph);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.oldString).toBe('const x = 1;');
    expect(edits[0]!.newString).toBe('const x = 2;');
  });

  it('Write — 사전(Pre)에 디스크 본문을 old 로 뜬다', () => {
    const graph = makeGraph();
    const target = path.join(projRoot, 'src', 'a.ts');
    fs.writeFileSync(target, 'before\n', 'utf8');

    graph.processHookEvent({
      session_id: SESSION,
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_use_id: 'toolu-write-1',
      tool_input: { file_path: target, content: 'after\n' },
      cwd: projRoot,
    });

    const edits = allEdits(graph);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.oldString).toBe('before\n');
    expect(edits[0]!.newString).toBe('after\n');
  });

  it('Read 는 여전히 읽기 방향이다 — 새 도구가 방향 규칙을 흔들지 않았다', () => {
    const graph = makeGraph();
    runTool(graph, 'Read', { file_path: path.join(projRoot, 'src', 'a.ts') });

    const cp = graph.toProjectCheckpoint(projName);
    expect(mainEdges(cp).some((e) => e.label === 'Read' && e.source === topFolderId(cp))).toBe(true);
    expect(allEdits(graph)).toHaveLength(0);
  });

  it('같은 호출이 두 번 도착해도 이력은 한 벌이다', () => {
    const graph = makeGraph();
    const input = {
      file_path: path.join(projRoot, 'src', 'a.ts'),
      edits: [{ old_string: 'a', new_string: 'b' }],
    };
    runTool(graph, 'MultiEdit', input, 'toolu-dup');
    runTool(graph, 'MultiEdit', input, 'toolu-dup');

    expect(allEdits(graph)).toHaveLength(1);
  });
});
