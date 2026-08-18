/**
 * §2.1 #5 v1.55 — **외부 폴더/파일을 여는 판정** 회귀 테스트.
 *
 * 배경: 열기 라우트(`open-node-folder`/`open-node-file`)의 가드가 "등록된 프로젝트 루트 안인가"
 * 하나만 봤다. 그런데 `external_folder` 는 **정의상 프로젝트 루트 밖**이라, SSOT 가 명시한
 * "외부 폴더 클릭 → OS 탐색기에서 그 절대경로 열기" 는 구조적으로 늘 403 이었다(클라는 응답을
 * 보지 않아 화면에서는 아무 일도 안 일어나는 것처럼 보였다).
 *
 * 그래서 판정 기준을 하나 더 둔다: **지금 우리가 버블로 그리고 있는 경로인가.** 여기서 못 박는
 * 계약은 둘이다.
 *  - 화면에 떠 있는 외부 폴더·그 위성 파일의 절대경로는 **연다**.
 *  - 버블이 아닌 임의 절대경로는 **열지 않는다**(가드의 원래 취지 — 페어링된 모바일 기기도 이 라우트에 닿는다).
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
