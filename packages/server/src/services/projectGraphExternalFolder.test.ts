/**
 * §2.1 #3 · #5 — 캔버스가 "지금 읽는 중"을 못 보던 두 구멍 회귀 테스트.
 *
 * ① **Bash 로 읽어도 그 파일이 뜬다**: 파일 버블은 `FILE_PATH_KEYS` 다섯 도구의 경로 인자에서만
 *    생겼는데, 실사용에서 에이전트는 `sed`/`cat` 으로 읽는 일이 잦다. 그 동안 캔버스는 직전
 *    `Edit`/`Write` 상태로 얼어붙어, 화면 화살표가 쓰기 방향인 채 읽기를 못 보여 줬다.
 * ③ **외부 폴더 버블도 그 탭의 것이다**: `external_folder` 와 그 위성은 캔버스에 떠 있으면서도
 *    체크포인트에 **0건** 저장됐다(소속 미기재 → `getProjectNodePaths` 필터 탈락). 앱을 껐다 켜면
 *    그대로 사라졌다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ActivityEdge, BubbleData, ProjectCheckpoint } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

let projRoot: string;
let projName: string;
let extRoot: string;
let extFile: string;

const SESSION = 'sess-ext-1';

beforeEach(() => {
  projRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-extproj-')));
  projName = path.basename(projRoot);
  // 프로젝트 **밖**의 폴더 — 어느 등록 프로젝트에도 속하지 않아야 external 로 라우팅된다.
  extRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-extsrc-')));
  extFile = path.join(extRoot, 'MPSCarryableObject.cpp');
  fs.writeFileSync(extFile, 'int main() { return 0; }\n', 'utf8');
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

function editExternalFile(graph: ProjectGraph): void {
  graph.processHookEvent({
    session_id: SESSION,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_use_id: 'toolu-edit-1',
    tool_input: { file_path: extFile, old_string: 'return 0', new_string: 'return 1' },
    cwd: projRoot,
  });
}

function bashReadExternalFile(graph: ProjectGraph, command: string): void {
  graph.processHookEvent({
    session_id: SESSION,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_use_id: 'toolu-bash-1',
    tool_input: { command },
    cwd: projRoot,
  });
}

function nodesOf(cp: ProjectCheckpoint): BubbleData[] {
  return Object.values(cp.graph.nodes);
}

function externalFolders(cp: ProjectCheckpoint): BubbleData[] {
  return nodesOf(cp).filter((n) => n.bubbleType === 'external_folder');
}

function externalFileNodes(cp: ProjectCheckpoint): BubbleData[] {
  return nodesOf(cp).filter(
    (n) => n.bubbleType === 'file' && (n.path ?? '').includes('__ext__'),
  );
}

function mainEdges(cp: ProjectCheckpoint): ActivityEdge[] {
  return Object.values(cp.edges.main.edges ?? {});
}

describe('③ 외부 폴더 버블이 체크포인트를 왕복한다', () => {
  it('외부 파일을 Edit 하면 external_folder + 위성이 그 탭 체크포인트에 실린다', () => {
    const graph = makeGraph();
    editExternalFile(graph);

    const cp = graph.toProjectCheckpoint(projName);
    expect(externalFolders(cp)).toHaveLength(1);
    expect(externalFileNodes(cp)).toHaveLength(1);
    expect(externalFolders(cp)[0]!.label).toContain('(ext)');
  });

  it('껐다 켜도(병합 복원) 외부 폴더와 위성이 살아 있다', () => {
    const graph = makeGraph();
    editExternalFile(graph);
    const cp = graph.toProjectCheckpoint(projName);

    const revived = makeGraph();
    revived.mergeFromCheckpoint(cp);

    const after = revived.toProjectCheckpoint(projName);
    expect(externalFolders(after)).toHaveLength(1);
    expect(externalFileNodes(after)).toHaveLength(1);
  });

  it('외부 폴더의 위성 등록(satelliteMap)도 함께 실린다 — 폴더만 뜨고 위성 0 금지', () => {
    const graph = makeGraph();
    editExternalFile(graph);

    const cp = graph.toProjectCheckpoint(projName);
    const folderKey = Object.entries(cp.graph.nodes)
      .find(([, n]) => n.bubbleType === 'external_folder')?.[0];
    expect(folderKey).toBeDefined();
    expect(cp.graph.hierarchy.satelliteMap[folderKey!] ?? []).toHaveLength(1);
  });
});

describe('① Bash 로 읽어도 파일 버블이 뜨고 방향이 읽기로 선다', () => {
  it('sed 로 읽으면 external_folder + 위성이 생기고 lastTool 이 Read 다', () => {
    const graph = makeGraph();
    bashReadExternalFile(graph, `sed -n '1,5p' "${extFile}"`);

    const cp = graph.toProjectCheckpoint(projName);
    expect(externalFolders(cp)).toHaveLength(1);
    expect(externalFolders(cp)[0]!.lastTool).toBe('Read');
    expect(externalFileNodes(cp)[0]!.lastTool).toBe('Read');
  });

  it('Edit 뒤 Bash 읽기가 오면 엣지가 읽기 방향(폴더 → 에이전트)으로 뒤집힌다', () => {
    const graph = makeGraph();
    editExternalFile(graph);

    const beforeCp = graph.toProjectCheckpoint(projName);
    const agentId = Object.values(beforeCp.graph.agents)[0]!.id;
    const folderId = externalFolders(beforeCp)[0]!.id;
    // 쓰기: 에이전트 → 폴더
    expect(mainEdges(beforeCp).some((e) => e.source === agentId && e.target === folderId)).toBe(true);

    bashReadExternalFile(graph, `cat "${extFile}"`);

    const afterCp = graph.toProjectCheckpoint(projName);
    const edges = mainEdges(afterCp).filter(
      (e) => (e.source === agentId && e.target === folderId) || (e.source === folderId && e.target === agentId),
    );
    // 한 쌍에 방향 하나 — 읽기 방향만 남는다.
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: folderId, target: agentId, label: 'Read' });
  });

  it('바꾸는 낌새가 있는 Bash 는 파일 버블을 만들지 않는다', () => {
    const graph = makeGraph();
    bashReadExternalFile(graph, `cat "${extFile}" > "${path.join(extRoot, 'copy.cpp')}"`);
    expect(externalFolders(graph.toProjectCheckpoint(projName))).toHaveLength(0);
  });

  it('디스크에 없는 경로는 채택하지 않는다 (오탐 차단)', () => {
    const graph = makeGraph();
    bashReadExternalFile(graph, `cat "${path.join(extRoot, 'does-not-exist.cpp')}"`);
    expect(externalFolders(graph.toProjectCheckpoint(projName))).toHaveLength(0);
  });

  it('읽기 화이트리스트 밖 Bash 는 종전대로 파일 버블을 만들지 않는다', () => {
    const graph = makeGraph();
    bashReadExternalFile(graph, `ls -la "${extRoot}"`);
    expect(externalFolders(graph.toProjectCheckpoint(projName))).toHaveLength(0);
  });
});

describe('④ 외부 파일에 쓴 내용이 그 파일 버블에 붙는다', () => {
  it('Edit diff 가 외부 파일 버블(node.id) 로 스냅샷에 실린다', () => {
    const graph = makeGraph();
    editExternalFile(graph);

    const cp = graph.toProjectCheckpoint(projName);
    const fileNodeId = externalFileNodes(cp)[0]!.id;

    const edits = graph.getSnapshot().fileEdits[fileNodeId] ?? [];
    expect(edits).toHaveLength(1);
    expect(edits[0]!.oldString).toBe('return 0');
    expect(edits[0]!.newString).toBe('return 1');
  });

  it('Write 로 만든 외부 파일의 본문도 그 버블에 붙는다', () => {
    const graph = makeGraph();
    const newFile = path.join(extRoot, 'cards_new.txt');
    graph.processHookEvent({
      session_id: SESSION,
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_use_id: 'toolu-write-1',
      tool_input: { file_path: newFile, content: 'hello card\n' },
      cwd: projRoot,
    });

    const cp = graph.toProjectCheckpoint(projName);
    const fileNodeId = externalFileNodes(cp)[0]!.id;

    const edits = graph.getSnapshot().fileEdits[fileNodeId] ?? [];
    expect(edits).toHaveLength(1);
    expect(edits[0]!.newString).toBe('hello card\n');
  });

  it('껐다 켜도 외부 파일의 diff 가 살아 있다 — 체크포인트 왕복', () => {
    const graph = makeGraph();
    editExternalFile(graph);
    const cp = graph.toProjectCheckpoint(projName);

    // 노드 필터를 통과해 실제로 저장돼야 한다(키가 어긋나면 여기서 0건으로 버려진다).
    expect(Object.keys(cp.activity.fileEdits)).toHaveLength(1);

    const revived = makeGraph();
    revived.mergeFromCheckpoint(cp);
    const after = revived.toProjectCheckpoint(projName);
    const fileNodeId = externalFileNodes(after)[0]!.id;
    expect(revived.getSnapshot().fileEdits[fileNodeId] ?? []).toHaveLength(1);
  });
});
