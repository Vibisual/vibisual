/**
 * §2.1 #5 — 외부 폴더·파일 열기: 화면에 그리는 외부 폴더·위성 파일 경로는 연다(루트 밖이라 루트 가드만으론 늘 403),
 * 버블이 아닌 임의 절대경로는 열지 않는다(페어링된 모바일 기기도 닿는 라우트).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraph } from './projectGraph.js';

let tmpRoot: string;
let outsideRoot: string;

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-openguard-')));
  outsideRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-openguard-ext-')));
});

afterEach(() => {
  for (const dir of [tmpRoot, outsideRoot]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** 절대경로 파일 하나를 만들고 그 파일에 대한 Edit PostToolUse 훅을 흘려보낸다. */
function editFile(graph: ProjectGraph, absFile: string): void {
  fs.mkdirSync(path.dirname(absFile), { recursive: true });
  fs.writeFileSync(absFile, 'after\n', 'utf8');
  graph.processHookEvent({
    session_id: 'sess-open-guard',
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_use_id: `toolu-${path.basename(absFile)}`,
    tool_input: { file_path: absFile, old_string: 'before', new_string: 'after' },
    cwd: tmpRoot,
  });
}

function makeGraph(): ProjectGraph {
  const graph = new ProjectGraph();
  // 프로젝트가 등록돼 있어야 노드가 이 인스턴스에 귀속된다.
  graph.registerProject(tmpRoot);
  return graph;
}

describe('hasNodeAbsolutePath — 열기 가드의 두 번째 기준', () => {
  it('프로젝트 루트 밖이어도 외부 폴더 버블의 경로면 true', () => {
    const graph = makeGraph();
    const extFile = path.join(outsideRoot, 'memory', 'MEMORY.md');
    editFile(graph, extFile);

    // 외부 폴더 버블(= 그 파일의 직속 부모 1개) 과 그 위성 파일 둘 다 열 수 있어야 한다.
    expect(graph.hasNodeAbsolutePath(path.dirname(extFile))).toBe(true);
    expect(graph.hasNodeAbsolutePath(extFile)).toBe(true);
  });

  it('프로젝트 루트 안의 파일 버블도 true', () => {
    const graph = makeGraph();
    const inFile = path.join(tmpRoot, 'src', 'index.ts');
    editFile(graph, inFile);

    expect(graph.hasNodeAbsolutePath(inFile)).toBe(true);
  });

  it('버블이 아닌 임의 절대경로는 false', () => {
    const graph = makeGraph();
    editFile(graph, path.join(outsideRoot, 'memory', 'MEMORY.md'));

    expect(graph.hasNodeAbsolutePath(path.join(outsideRoot, 'memory', 'SECRET.md'))).toBe(false);
    expect(graph.hasNodeAbsolutePath(path.join(os.homedir(), '.ssh', 'id_rsa'))).toBe(false);
  });

  it('구분자·중복 슬래시가 달라도 같은 경로로 본다', () => {
    const graph = makeGraph();
    const extFile = path.join(outsideRoot, 'memory', 'MEMORY.md');
    editFile(graph, extFile);

    const dir = path.dirname(extFile);
    expect(graph.hasNodeAbsolutePath(`${dir}${path.sep}`)).toBe(true);
    expect(graph.hasNodeAbsolutePath(path.join(dir, 'sub', '..'))).toBe(true);
  });
});
