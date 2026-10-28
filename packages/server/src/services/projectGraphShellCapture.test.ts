/**
 * §5.1 #1-1 — 셸 명령은 어느 문으로 와도 같은 길로 잡는다: (A) `PowerShell` 도구 (B) 코덱스 `pwsh -Command` 꼴
 *  (C) 상대 경로는 명령이 시작된 폴더 기준(사후 cwd 로 풀면 `cd` 가 두 번 붙는다) (E) 폴더를 준 셸 검색 = 폴더 읽기, `cp a out` 은 out 이 폴더면 `out/a`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BubbleData, FileEdit, ProjectCheckpoint } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

let projRoot: string;
let projName: string;

const SESSION = 'sess-shell-capture-1';

beforeEach(() => {
  projRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-shellcap-')));
  projName = path.basename(projRoot);
});

afterEach(() => {
  try { fs.rmSync(projRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

function makeGraph(): ProjectGraph {
  const graph = new ProjectGraph();
  graph.registerProject(projRoot);
  return graph;
}

function write(rel: string, body = 'x\n'): string {
  const abs = path.join(projRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, 'utf8');
  return abs;
}

/** 세션의 첫 이벤트 — 루트에서 파일 하나를 읽는다(세션의 첫 폴더가 루트로 잡힌다). */
function openSessionAtRoot(graph: ProjectGraph): void {
  const seed = write('seed.txt', 'seed\n');
  for (const phase of ['PreToolUse', 'PostToolUse'] as const) {
    graph.processHookEvent({
      session_id: SESSION, hook_event_name: phase, tool_name: 'Read', tool_use_id: 'toolu-seed',
      tool_input: { file_path: seed }, cwd: projRoot,
    });
  }
}

/** 사전 → (디스크 변화) → 사후. 사전·사후의 cwd 를 따로 준다(훅의 cwd 는 Claude 가 cd 한 뒤의 폴더를 따라간다). */
function runShell(
  graph: ProjectGraph,
  opts: { tool?: 'Bash' | 'PowerShell'; command: string; uid: string; preCwd?: string; postCwd?: string; stdout?: string },
  apply: () => void = () => {},
): void {
  const tool = opts.tool ?? 'Bash';
  graph.processHookEvent({
    session_id: SESSION, hook_event_name: 'PreToolUse', tool_name: tool, tool_use_id: opts.uid,
    tool_input: { command: opts.command }, cwd: opts.preCwd ?? projRoot,
  });
  apply();
  graph.processHookEvent({
    session_id: SESSION, hook_event_name: 'PostToolUse', tool_name: tool, tool_use_id: opts.uid,
    tool_input: { command: opts.command }, tool_response: { stdout: opts.stdout ?? '' }, cwd: opts.postCwd ?? opts.preCwd ?? projRoot,
  });
}

function checkpoint(graph: ProjectGraph): ProjectCheckpoint {
  return graph.toProjectCheckpoint(projName);
}

/** 노드 열쇠(프로젝트 상대 경로)로 찾는다 — Windows·macOS 는 열쇠를 소문자로 접으므로 접어서 견준다. */
function nodeAt(cp: ProjectCheckpoint, rel: string): BubbleData | undefined {
  const want = rel.toLowerCase();
  const hit = Object.entries(cp.graph.nodes).find(([k]) => k.toLowerCase() === want);
  return hit?.[1];
}

/** 스냅샷의 수정 이력 열쇠는 노드 id 라 경로(`filePath` — 절대경로)로 찾는다. */
function editsFor(graph: ProjectGraph, rel: string): FileEdit[] {
  const want = `${projRoot}/${rel}`.replace(/\\/g, '/').toLowerCase();
  return Object.values(graph.getSnapshot().fileEdits ?? {})
    .flat()
    .filter((e) => e.filePath.replace(/\\/g, '/').toLowerCase() === want);
}

describe('(A) PowerShell 도구도 셸 명령으로 잡는다', () => {
  it('PowerShell 로 쓴 파일 — 버블·쓰기 수·수정 이력, 그리고 Bash 이력', () => {
    const graph = makeGraph();
    openSessionAtRoot(graph);
    write('src/p.txt', 'old\n');
    runShell(graph, { tool: 'PowerShell', command: 'Set-Content -Path src/p.txt -Value new', uid: 'toolu-ps-1' }, () => {
      fs.writeFileSync(path.join(projRoot, 'src', 'p.txt'), 'new\n', 'utf8');
    });
    const cp = checkpoint(graph);
    expect(nodeAt(cp, 'src/p.txt')?.writeCount).toBe(1);
    const edits = editsFor(graph, 'src/p.txt');
    expect(edits).toHaveLength(1);
    expect(edits[0]!.oldString).toBe('old\n');
    expect(edits[0]!.newString).toBe('new\n');
    const history = Object.values(graph.getSnapshot().bashHistory ?? {}).flat();
    expect(history.some((e) => e.command === 'Set-Content -Path src/p.txt -Value new')).toBe(true);
  });

  it('PowerShell 로 읽은 파일도 버블이 선다(Get-Content)', () => {
    const graph = makeGraph();
    openSessionAtRoot(graph);
    write('docs/r.md', 'r\n');
    runShell(graph, { tool: 'PowerShell', command: 'Get-Content docs/r.md | Select-Object -First 5', uid: 'toolu-ps-2' });
    expect(nodeAt(checkpoint(graph), 'docs/r.md')?.readCount ?? 0).toBeGreaterThan(0);
  });
});

describe('(B) 코덱스 껍데기 안의 읽기', () => {
  it('"…pwsh.exe" -Command \'Get-Content …\' 로 읽은 파일에 버블이 선다', () => {
    const graph = makeGraph();
    openSessionAtRoot(graph);
    write('src/c.txt', 'c\n');
    const cmd = String.raw`"C:\Users\dev\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe" -Command 'Get-Content src/c.txt'`; // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    runShell(graph, { command: cmd, uid: 'toolu-codex-1' });
    expect(nodeAt(checkpoint(graph), 'src/c.txt')?.readCount ?? 0).toBeGreaterThan(0);
  });
});

describe('(C) 상대 경로는 그 명령이 시작될 때의 폴더로 푼다', () => {
  it('셸이 하위 폴더에 앉아 있으면 sed -i … package.json 은 그 폴더의 package.json 이다(루트 것 ❌)', () => {
    const graph = makeGraph();
    openSessionAtRoot(graph);
    write('package.json', '{"name":"root"}\n');
    write('sub/package.json', '{"name":"a"}\n');
    const sub = path.join(projRoot, 'sub');
    runShell(graph, { command: `sed -i 's/a/b/' package.json`, uid: 'toolu-cwd-1', preCwd: sub }, () => {
      fs.writeFileSync(path.join(sub, 'package.json'), '{"name":"b"}\n', 'utf8');
    });
    const cp = checkpoint(graph);
    expect(nodeAt(cp, 'sub/package.json')?.writeCount).toBe(1);
    expect(nodeAt(cp, 'package.json')?.writeCount ?? 0).toBe(0);
    const edits = editsFor(graph, 'sub/package.json');
    expect(edits).toHaveLength(1);
    expect(edits[0]!.newString).toBe('{"name":"b"}\n');
    expect(editsFor(graph, 'package.json')).toHaveLength(0);
  });

  it('cd sub && echo … > f — 사후 cwd 가 이미 sub 여도 경로가 두 번 붙지 않는다', () => {
    const graph = makeGraph();
    openSessionAtRoot(graph);
    fs.mkdirSync(path.join(projRoot, 'sub'), { recursive: true });
    const sub = path.join(projRoot, 'sub');
    runShell(graph, { command: 'cd sub && echo b > out.txt', uid: 'toolu-cwd-2', preCwd: projRoot, postCwd: sub }, () => {
      fs.writeFileSync(path.join(sub, 'out.txt'), 'b\n', 'utf8');
    });
    const cp = checkpoint(graph);
    expect(nodeAt(cp, 'sub/out.txt')?.writeCount).toBe(1);
    expect(nodeAt(cp, 'sub/sub/out.txt')).toBeUndefined();
  });
});

describe('(E) 폴더 검색 · 폴더 목적지', () => {
  it('grep -rn 패턴 폴더 — 그 폴더가 Grep 도구처럼 읽힌다', () => {
    const graph = makeGraph();
    openSessionAtRoot(graph);
    write('lib/x.ts', 'foo\n');
    runShell(graph, { command: 'grep -rn foo lib', uid: 'toolu-grep-1', stdout: 'lib/x.ts:1:foo' });
    const lib = nodeAt(checkpoint(graph), 'lib');
    expect(lib?.bubbleType).toBe('internal_folder');
    expect(lib?.lastTool).toBe('Grep');
  });

  it('cp a.txt out — out 이 있는 폴더면 쓰인 것은 out/a.txt 다', () => {
    const graph = makeGraph();
    openSessionAtRoot(graph);
    write('a.txt', 'a\n');
    fs.mkdirSync(path.join(projRoot, 'out'), { recursive: true });
    runShell(graph, { command: 'cp a.txt out', uid: 'toolu-cp-1' }, () => {
      fs.copyFileSync(path.join(projRoot, 'a.txt'), path.join(projRoot, 'out', 'a.txt'));
    });
    expect(nodeAt(checkpoint(graph), 'out/a.txt')?.writeCount).toBe(1);
  });
});
