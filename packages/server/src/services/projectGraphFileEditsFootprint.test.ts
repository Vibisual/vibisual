/**
 * 체크포인트 `activity.fileEdits` 고아 키 회귀 테스트 (v4.67).
 *
 * 배경: 저장 필터는 `projectNodePaths`(= `nodeProjectNames` 유래)를 쓰는데, 노드가 사라져도
 * 이 귀속 기록은 남는다. 반면 화면으로 나가는 `getSnapshot().fileEdits` 는 `this.nodes` 에
 * 노드가 있어야 통과시킨다. 그래서 노드 없는 경로의 편집이 **저장·백업·복원만 되고 UI 엔
 * 영영 도달하지 못하는** 죽은 데이터로 남았다(실측 94키 1.15MB).
 *
 * 이 테스트가 지키는 것은 두 가지다.
 *  - 살아있는 노드의 편집은 종전 그대로 저장된다(= 화면에 보이던 것이 줄지 않는다).
 *  - 노드가 사라진 경로의 편집은 저장되지 않는다(= 죽은 데이터가 쌓이지 않는다).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraph } from './projectGraph.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-fileedits-')));
});

afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

/** 파일 하나를 만들고 그 파일에 대한 Edit PostToolUse 훅 이벤트를 흘려보낸다. */
function editFile(graph: ProjectGraph, sessionId: string, relPath: string): void {
  const abs = path.join(tmpRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'after\n', 'utf8');
  graph.processHookEvent({
    session_id: sessionId,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_use_id: `toolu-${relPath}`,
    tool_input: { file_path: abs, old_string: 'before', new_string: 'after' },
    cwd: tmpRoot,
  });
}

describe('toProjectCheckpoint — fileEdits 는 노드가 실재하는 경로만 저장한다', () => {
  it('살아있는 노드의 편집은 저장되고, 노드가 사라진 경로의 편집은 저장되지 않는다', () => {
    const graph = new ProjectGraph();
    const project = graph.registerProject(tmpRoot);
    const sessionId = 'sess-footprint-1';

    editFile(graph, sessionId, 'keep.ts');
    editFile(graph, sessionId, 'orphan.ts');

    // 둘 다 저장 + 화면 양쪽에 잡히는 정상 상태에서 출발한다.
    const before = graph.toProjectCheckpoint(project.name);
    const beforeKeys = Object.keys(before.activity?.fileEdits ?? {});
    expect(beforeKeys.some((k) => k.endsWith('keep.ts'))).toBe(true);
    expect(beforeKeys.some((k) => k.endsWith('orphan.ts'))).toBe(true);

    // 노드 id 는 체크포인트의 graph.nodes(경로 → BubbleData)에서 얻는다.
    // GraphSnapshot 에는 nodes 맵이 없고 topFolders/children/satellites 로 갈라져 나간다.
    const orphanPath = Object.keys(before.graph?.nodes ?? {}).find((p) => p.endsWith('orphan.ts'));
    expect(orphanPath).toBeDefined();

    // 고아 상태를 그대로 재현한다 — 파일이 지워져 노드는 사라졌는데(graph.nodes 에서 제외)
    // 경로→프로젝트 귀속 기록(nodeProjectRoots)과 편집 이력은 남아 있는 디스크 판본.
    // 실제 사용자의 checkpoint.json 에 94키 1.36MB 로 쌓여 있던 바로 그 모양이다.
    const stale = JSON.parse(JSON.stringify(before)) as typeof before;
    delete stale.graph!.nodes[orphanPath!];

    const revived = new ProjectGraph();
    revived.registerProject(tmpRoot);
    revived.restoreFromCheckpoint(stale);

    // 복원 직후: 편집 이력은 메모리에 올라와 있지만 화면으로는 나가지 않는다(노드가 없으므로).
    const revivedSnapKeys = Object.keys(revived.getSnapshot().fileEdits ?? {});
    const orphanId = before.graph?.nodes[orphanPath!]?.id;
    expect(orphanId).toBeDefined();
    expect(revivedSnapKeys).not.toContain(orphanId);

    // 다음 저장에서 죽은 데이터가 회수된다. 살아있는 쪽은 그대로 남아야 한다.
    const after = revived.toProjectCheckpoint(project.name);
    const afterKeys = Object.keys(after.activity?.fileEdits ?? {});
    expect(afterKeys.some((k) => k.endsWith('orphan.ts'))).toBe(false);
    expect(afterKeys.some((k) => k.endsWith('keep.ts'))).toBe(true);
  });

  it('저장된 fileEdits 키는 항상 저장된 graph.nodes 안에 있다 (두 필터가 어긋나지 않는다)', () => {
    const graph = new ProjectGraph();
    const project = graph.registerProject(tmpRoot);
    const sessionId = 'sess-footprint-2';

    for (const rel of ['a.ts', 'b.ts', 'sub/c.ts']) editFile(graph, sessionId, rel);
    const seed = graph.toProjectCheckpoint(project.name);

    // 파일 셋 중 둘이 지워져 노드가 사라진 판본을 만든다(귀속 기록·편집 이력은 잔존).
    const stale = JSON.parse(JSON.stringify(seed)) as typeof seed;
    for (const suffix of ['b.ts', 'c.ts']) {
      const p = Object.keys(stale.graph!.nodes).find((k) => k.endsWith(suffix));
      expect(p).toBeDefined();
      delete stale.graph!.nodes[p!];
    }
    expect(Object.keys(stale.activity?.fileEdits ?? {})).toHaveLength(3); // 편집 이력은 3개 그대로

    const revived = new ProjectGraph();
    revived.registerProject(tmpRoot);
    revived.restoreFromCheckpoint(stale);

    const cp = revived.toProjectCheckpoint(project.name);
    const savedEditKeys = Object.keys(cp.activity?.fileEdits ?? {});
    const nodePaths = new Set(Object.keys(cp.graph?.nodes ?? {}));
    // 재저장본에는 살아있는 하나만 남고, 저장되는 모든 키는 저장되는 노드 안에 있다.
    expect(savedEditKeys).toHaveLength(1);
    for (const key of savedEditKeys) expect(nodePaths.has(key)).toBe(true);
  });
});
