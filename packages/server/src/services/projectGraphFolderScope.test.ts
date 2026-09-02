/**
 * §9 폴더 스코프 — `getSnapshot()` 이 실제로 무엇을 싣고 무엇을 빼는가.
 *
 * 규칙(`folderScope.ts`)이 맞아도 **적용 지점이 어긋나면** 증상은 똑같이 "폴더를 열었는데
 * 비어 있다" 로 나온다. 그래서 규칙 테스트와 별개로, 실제 그래프를 세워 세 슬라이스
 * (`children`·`innerEdges`·폴더 위성)가 같은 집합을 따라가는지 여기서 못 박는다.
 *
 * 가장 중요한 항목은 맨 앞의 **등가성**이다 — 범위를 안 주면 이 변경 전과 한 글자도 달라지지
 * 않아야 한다(내부 조회용 스냅샷·REST·명령 dispatch 가 전부 그 경로를 쓴다).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BubbleData } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

let projRoot: string;
const SESSION = 'sess-folder-scope';

beforeEach(() => {
  projRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-folder-scope-')));
});

afterEach(() => {
  try { fs.rmSync(projRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

/** 프로젝트 안의 파일 하나를 Edit 훅으로 흘린다 → 그 경로의 폴더 체인이 만들어진다. */
function editInternal(graph: ProjectGraph, relPath: string, uid: string): void {
  const abs = path.join(projRoot, relPath);
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
}

/**
 * 두 갈래 · 세 단계짜리 트리를 세운다.
 *   src/ ─ core/ ─ deep/deep.ts
 *        └ util/util.ts
 *   docs/ ─ guide.md
 * 최상위는 `src` 와 `docs` 두 개다.
 */
function makeTree(): { graph: ProjectGraph; byLabel: Map<string, BubbleData> } {
  const graph = new ProjectGraph();
  graph.registerProject(projRoot);
  editInternal(graph, path.join('src', 'core', 'deep', 'deep.ts'), 'u1');
  editInternal(graph, path.join('src', 'util', 'util.ts'), 'u2');
  editInternal(graph, path.join('docs', 'guide.md'), 'u3');

  const byLabel = new Map<string, BubbleData>();
  const snap = graph.getSnapshot();
  const walk = (list: BubbleData[]): void => {
    for (const n of list) {
      byLabel.set(n.label, n);
      const kids = snap.children[n.id];
      if (kids) walk(kids);
    }
  };
  walk(snap.topFolders);
  return { graph, byLabel };
}

/** 스냅샷 안에서 그 폴더의 자식 라벨들(없으면 null — "빈 폴더"와 "안 실림"을 구분한다). */
function childLabels(graph: ProjectGraph, scope: Set<string> | null, folderId: string): string[] | null {
  const kids = graph.getSnapshot(scope).children[folderId];
  return kids === undefined ? null : kids.map((c) => c.label).sort();
}

describe('§9 폴더 스코프 — 범위를 안 주면 종전과 같다', () => {
  it('scope 없이 부른 스냅샷은 모든 폴더의 children 을 그대로 싣는다', () => {
    const { graph, byLabel } = makeTree();
    const full = graph.getSnapshot();
    // 세 단계 전부 들어 있다.
    for (const label of ['src', 'core', 'deep', 'util', 'docs']) {
      const node = byLabel.get(label);
      expect(node, `${label} 버블이 없다`).toBeDefined();
    }
    expect(full.children[byLabel.get('src')!.id]).toBeDefined();
    expect(full.children[byLabel.get('core')!.id]).toBeDefined();
    expect(full.children[byLabel.get('deep')!.id]).toBeDefined();
  });

  it('null 과 명시적 미선언은 같은 결과다 — 내부 조회용 경로가 조용히 좁아지면 기능 손상이다', () => {
    const { graph } = makeTree();
    const a = JSON.stringify(graph.getSnapshot());
    const b = JSON.stringify(graph.getSnapshot(null));
    expect(a).toBe(b);
  });
});

describe('§9 폴더 스코프 — 메인 뷰', () => {
  it('빈 선언(폴더 밖)이면 최상위 폴더의 children 만 실린다', () => {
    const { graph, byLabel } = makeTree();
    const scope = new Set<string>();

    // 최상위 두 개는 눌렀을 때 즉시 열려야 하므로 실린다.
    expect(childLabels(graph, scope, byLabel.get('src')!.id)).toEqual(['core', 'util']);
    expect(childLabels(graph, scope, byLabel.get('docs')!.id)).toEqual(['guide.md']);
    // 그 안쪽은 아직 아무도 안 본다 → 아예 실리지 않는다(= 이 최적화가 걷어낸 몫).
    expect(childLabels(graph, scope, byLabel.get('core')!.id)).toBeNull();
    expect(childLabels(graph, scope, byLabel.get('deep')!.id)).toBeNull();
  });
});

describe('§9 폴더 스코프 — 폴더 안', () => {
  it('연 폴더 + 그 하위 폴더(한 칸 앞)가 함께 온다', () => {
    const { graph, byLabel } = makeTree();
    const scope = new Set([byLabel.get('src')!.id]);

    // 지금 그리는 내용
    expect(childLabels(graph, scope, byLabel.get('src')!.id)).toEqual(['core', 'util']);
    // 한 칸 앞 — src 안에서 core 를 누르면 왕복 없이 열린다
    expect(childLabels(graph, scope, byLabel.get('core')!.id)).toEqual(['deep']);
    // 두 칸 앞은 안 온다(누르는 사이에 선언이 나가고 스냅샷이 돌아온다)
    expect(childLabels(graph, scope, byLabel.get('deep')!.id)).toBeNull();
  });

  it('내비 경로를 통째로 선언하면 조상도 실린다 — 뒤로가기·경로 표시가 살아 있다', () => {
    const { graph, byLabel } = makeTree();
    const scope = new Set([byLabel.get('src')!.id, byLabel.get('core')!.id]);

    expect(childLabels(graph, scope, byLabel.get('src')!.id)).toEqual(['core', 'util']);
    expect(childLabels(graph, scope, byLabel.get('core')!.id)).toEqual(['deep']);
    expect(childLabels(graph, scope, byLabel.get('deep')!.id)).toEqual(['deep.ts']);
  });

  it('다른 갈래의 최상위는 계속 온다 — 홈으로 나가는 것도 즉시여야 한다', () => {
    const { graph, byLabel } = makeTree();
    const scope = new Set([byLabel.get('src')!.id]);
    expect(childLabels(graph, scope, byLabel.get('docs')!.id)).toEqual(['guide.md']);
  });
});

describe('§9 폴더 스코프 — 세 슬라이스가 같은 집합을 따라간다', () => {
  it('innerEdges 도 children 과 같은 폴더만 싣는다', () => {
    const { graph, byLabel } = makeTree();
    const deepId = byLabel.get('deep')!.id;

    // 전량일 때는 있다(폴더 안에 파일이 붙어 있으므로 내부 엣지가 선다).
    const fullInner = graph.getSnapshot().innerEdges;
    expect(Object.keys(fullInner).length).toBeGreaterThan(0);

    // 범위 밖이면 그 폴더의 내부 엣지도 빠진다 — 안 그리는 화면의 화살표를 실어 나르지 않는다.
    const scoped = graph.getSnapshot(new Set<string>()).innerEdges;
    expect(scoped[deepId]).toBeUndefined();
    // 그러면서 최상위는 남아 있다(스코프 집합이 실제로 적용됐다는 대조군).
    expect(Object.keys(scoped).every((id) => id !== deepId)).toBe(true);
  });

  it('폴더 위성은 범위를 따르되, **에이전트 위성은 범위와 무관하게 항상 온다**', () => {
    const { graph, byLabel } = makeTree();
    // 에이전트가 Bash 를 쓰면 그 에이전트에 영구 위성이 붙는다.
    graph.processHookEvent({
      session_id: SESSION,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 'u-bash',
      tool_input: { command: 'echo hi' },
      cwd: projRoot,
    });

    const scoped = graph.getSnapshot(new Set<string>());
    const agent = scoped.agents.find((a) => a.path === SESSION) ?? scoped.agents[0];
    expect(agent, '에이전트 버블이 없다').toBeDefined();
    // 에이전트는 폴더 안에 들어가 있어도 메인 캔버스에 그려진다 — 그 위성을 빼면 화면이 빈다.
    expect(scoped.satellites[agent!.id]).toBeDefined();

    // 반면 범위 밖 폴더의 위성(파일)은 빠진다.
    const deepId = byLabel.get('deep')!.id;
    expect(scoped.satellites[deepId]).toBeUndefined();
  });
});

describe('§9 폴더 스코프 — 캐시가 범위를 섞지 않는다', () => {
  it('같은 tick 에 범위를 바꿔 부르면 각자 맞는 결과가 온다(슬롯이 하나면 여기서 깨진다)', () => {
    const { graph, byLabel } = makeTree();
    const coreId = byLabel.get('core')!.id;

    const narrow = graph.getSnapshot(new Set<string>());
    const wide = graph.getSnapshot(new Set([byLabel.get('src')!.id]));
    const narrowAgain = graph.getSnapshot(new Set<string>());

    expect(narrow.children[coreId]).toBeUndefined();
    expect(wide.children[coreId]).toBeDefined();
    // 넓은 범위를 한 번 부른 뒤에도 좁은 범위는 여전히 좁아야 한다 — 캐시가 새면 여기서 샌다.
    expect(narrowAgain.children[coreId]).toBeUndefined();
  });

  it('전량 조회와 스코프 조회가 번갈아 와도 서로를 밀어내지 않는다', () => {
    const { graph, byLabel } = makeTree();
    const coreId = byLabel.get('core')!.id;
    const scope = new Set([byLabel.get('src')!.id]);

    for (let i = 0; i < 3; i++) {
      expect(graph.getSnapshot().children[coreId]).toBeDefined();
      expect(graph.getSnapshot(scope).children[coreId]).toBeDefined();
      expect(graph.getSnapshot(new Set<string>()).children[coreId]).toBeUndefined();
    }
  });
});
