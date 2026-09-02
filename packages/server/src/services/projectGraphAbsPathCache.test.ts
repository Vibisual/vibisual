/**
 * §9 — `resolveAbsolutePath` 결과 캐시의 **자기검증**을 고정한다.
 *
 * **왜 캐시했나.** `enrichNode` 가 노드마다 이 함수를 부르므로 `getSnapshot()` 1회에 노드 수만큼
 * `path.resolve` 가 돌았다 — 이 저장소의 실제 체크포인트(2,467 노드) 기준 **3.5ms/스냅샷**. 서버가
 * Electron 메인 프로세스와 한 몸이라 그 시간이 그대로 창의 프레임에서 나간다.
 *
 * **왜 이 테스트가 필요한가.** 캐시는 무효화 장부를 두지 않는다 — 갱신 지점이 20곳 넘게 흩어져
 * 있어(프로젝트 등록·닫기·워크트리·체크포인트 복원·노드 이동) 손으로 심으면 한 곳만 빠져도 경로가
 * 조용히 옛것으로 남는다. 대신 캐시 항목이 그때의 (루트·프로젝트명)을 함께 들고 있다가 쓸 때마다
 * 대조한다. 여기서 지키는 것은 **그 대조가 실제로 작동하는가** 다 — 캐시가 답을 굳혀 버리면
 * 프로젝트를 갈아 끼운 뒤 버블이 남의 폴더를 가리키게 된다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectGraph } from './projectGraph.js';

describe('ProjectGraph.resolveAbsolutePath — 캐시가 답을 굳히지 않는다', () => {
  let rootA: string;
  let rootB: string;

  beforeEach(() => {
    rootA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-abscache-a-')));
    rootB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-abscache-b-')));
  });

  afterEach(() => {
    for (const r of [rootA, rootB]) {
      try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });

  function edit(graph: ProjectGraph, root: string, relPath: string): void {
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x\n', 'utf8');
    graph.processHookEvent({
      session_id: `sess-${path.basename(root)}`,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_use_id: `toolu-${root}-${relPath}`,
      tool_input: { file_path: abs, old_string: 'a', new_string: 'x' },
      cwd: root,
    });
  }

  it('같은 키를 반복해서 물어도 같은 답을 준다(캐시 히트가 답을 바꾸지 않는다)', () => {
    const graph = new ProjectGraph();
    graph.registerProject(rootA);
    edit(graph, rootA, 'src/feature.ts');

    const projectName = Object.values(graph.getSnapshot().projects)[0]!.name;
    const keys = Object.keys(graph.toProjectCheckpoint(projectName).graph.nodes);
    const fileKey = keys.find((k) => k.endsWith('feature.ts'));
    expect(fileKey).toBeDefined();

    const first = graph.resolveAbsolutePath(fileKey!);
    expect(first).not.toBeNull();
    for (let i = 0; i < 5; i++) expect(graph.resolveAbsolutePath(fileKey!)).toBe(first);
    expect(fs.existsSync(first!)).toBe(true);
  });

  it('같은 상대 키라도 프로젝트가 다르면 각자의 루트로 풀린다(캐시가 섞이지 않는다)', () => {
    const graph = new ProjectGraph();
    graph.registerProject(rootA);
    graph.registerProject(rootB);
    edit(graph, rootA, 'shared.ts');
    edit(graph, rootB, 'shared.ts');

    const snap = graph.getSnapshot();
    const projNames = Object.values(snap.projects).map((p) => p.name);
    expect(projNames.length).toBe(2);

    const resolved: string[] = [];
    for (const name of projNames) {
      const nodes = graph.toProjectCheckpoint(name).graph.nodes;
      for (const key of Object.keys(nodes)) {
        if (!key.endsWith('shared.ts')) continue;
        const abs = graph.resolveAbsolutePath(key);
        if (abs) resolved.push(abs);
      }
    }

    // 두 프로젝트의 shared.ts 는 서로 다른 절대 경로여야 한다 — 하나로 접히면 캐시가 섞인 것이다.
    expect(new Set(resolved).size).toBe(resolved.length);
    for (const abs of resolved) expect(fs.existsSync(abs)).toBe(true);
  });

  it('스냅샷의 absolutePath 가 실제 디스크 경로와 일치한다(반복 호출 뒤에도)', () => {
    const graph = new ProjectGraph();
    graph.registerProject(rootA);
    edit(graph, rootA, 'a/b/deep.ts');

    // 여러 번 스냅샷을 떠서 캐시가 충분히 데워진 뒤 확인한다.
    for (let i = 0; i < 3; i++) graph.getSnapshot();
    const snap = graph.getSnapshot();

    const all = [...snap.topFolders, ...Object.values(snap.children).flat(), ...Object.values(snap.satellites).flat()];
    const deep = all.find((n) => n.label === 'deep.ts');
    expect(deep).toBeDefined();
    expect(deep!.absolutePath).toBeDefined();
    expect(fs.existsSync(deep!.absolutePath!)).toBe(true);
  });

  it('노드가 자기 absolutePath 를 들고 있으면 그 값이 이긴다(외부 폴더 규칙 불변)', () => {
    const graph = new ProjectGraph();
    graph.registerProject(rootA);
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-abscache-out-')));
    try {
      const abs = path.join(outside, 'far.ts');
      fs.writeFileSync(abs, 'x\n', 'utf8');
      graph.processHookEvent({
        session_id: 'sess-outside',
        hook_event_name: 'PostToolUse',
        tool_name: 'Read',
        tool_use_id: 'toolu-outside',
        tool_input: { file_path: abs },
        cwd: rootA,
      });

      const snap = graph.getSnapshot();
      const all = [...snap.topFolders, ...Object.values(snap.children).flat(), ...Object.values(snap.satellites).flat()];
      const far = all.find((n) => n.label === 'far.ts');
      expect(far).toBeDefined();
      // 루트 밖이라 상대 키로는 풀 수 없다 — 노드가 들고 있는 절대 경로가 그대로 나와야 한다.
      expect(far!.absolutePath?.replace(/\\/g, '/').toLowerCase())
        .toBe(abs.replace(/\\/g, '/').toLowerCase());
    } finally {
      try { fs.rmSync(outside, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });
});
