/**
 * §2.1 (A)(B)(C)(D) — 외부 폴더 **요약 · 예산 승격 · 휘발 접기 · 읽는 이름** 회귀.
 *
 * 사용자 보고: "외부 폴더가 1개만 보여서 이게 뭔지 확정이 안 된다."
 * 실측(실행 중이던 프로젝트 체크포인트): `external_folder` 33개가 최상위 3개로 접혔고, 그중
 * 홈 하나가 **25곳을 삼킨 채** `activity=0` · 위성 0 · 화면 숫자는 직속 자식 수 `4` 였다.
 *
 * 옆 파일(`projectGraphExternalTree.test.ts`)이 보증하는 것은 **접합 트리 그 자체**라 거기서는
 * 예산을 1 로 눌러 승격을 끈다. 이 파일은 그 위에 얹히는 네 축만 본다 — 한 파일이 두 축을 함께
 * 재면 어느 쪽이 깨졌는지 알 수 없다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BubbleData } from '@vibisual/shared';
import { EXTERNAL_PROMOTION_PER_PARENT } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

let projRoot: string;
let extRoot: string;

const SESSION = 'sess-ext-promo';

beforeEach(() => {
  projRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-ext-promo-proj-')));
  extRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-ext-promo-src-')));
});

afterEach(() => {
  for (const dir of [projRoot, extRoot]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function makeGraph(budget = 12): ProjectGraph {
  const graph = new ProjectGraph();
  graph.registerProject(projRoot);
  graph.setExternalTopBudget(budget);
  return graph;
}

/** 외부 절대경로 파일 하나를 만들고 Edit 훅을 흘린다 — 그 파일의 부모가 `external_folder` 가 된다. */
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

/** 최상위에 실제로 뜬 외부 폴더 버블들. */
function topExternals(graph: ProjectGraph): BubbleData[] {
  return graph.getSnapshot().topFolders.filter((n) => n.bubbleType === 'external_folder');
}

function findByPathEnd(graph: ProjectGraph, suffix: string): BubbleData | undefined {
  const snap = graph.getSnapshot();
  const all: BubbleData[] = [...snap.topFolders];
  for (const kids of Object.values(snap.children)) all.push(...kids);
  return all.find((n) => n.bubbleType === 'external_folder' && n.path.replace(/\\/g, '/').endsWith(suffix));
}

describe('(B) 예산제 능동 승격 — 보이는 것은 활동이 정한다', () => {
  it('예산이 있으면 접합에 가려져 있던 자리가 최상위로 나온다', () => {
    const graph = makeGraph(12);
    editExternal(graph, 'alpha/a.txt', 'toolu-a');
    editExternal(graph, 'beta/b.txt', 'toolu-b');

    // 예산이 넉넉하니 둘 다 밖으로 — "1개만 보여서 뭔지 모르겠다"의 반대다.
    const tops = topExternals(graph).map((n) => n.path.replace(/\\/g, '/'));
    expect(tops.some((p) => p.endsWith('/alpha'))).toBe(true);
    expect(tops.some((p) => p.endsWith('/beta'))).toBe(true);
  });

  it('예산이 0 이면 종전 그대로 — 접합 하나만 선다', () => {
    const graph = makeGraph(1); // room = 1 - 루트 1개 = 0
    editExternal(graph, 'alpha/a.txt', 'toolu-a');
    editExternal(graph, 'beta/b.txt', 'toolu-b');
    expect(topExternals(graph)).toHaveLength(1);
  });

  it('한 부모에서 몰아 꺼내지 않는다 — 형제 12개여도 부모당 상한까지', () => {
    const graph = makeGraph(40); // 예산은 넉넉해도
    for (let i = 0; i < 12; i++) editExternal(graph, `pack/s${i}/t.json`, `toolu-s${i}`);

    // 접합(`…/pack`) + 부모당 상한만큼. 12개가 전부 나오면 접합 트리가 무너진 것이다.
    const tops = topExternals(graph);
    expect(tops.length).toBe(1 + EXTERNAL_PROMOTION_PER_PARENT);
  });

  it('핀을 꽂은 폴더는 예산과 무관하게 최상위에 남는다 (사용자 결정)', () => {
    const graph = makeGraph(1); // 승격 자리는 0
    editExternal(graph, 'alpha/a.txt', 'toolu-a');
    editExternal(graph, 'beta/b.txt', 'toolu-b');
    expect(topExternals(graph)).toHaveLength(1); // 아직은 접합 하나

    const beta = findByPathEnd(graph, '/beta');
    expect(beta).toBeDefined();
    expect(graph.togglePreservePinned(beta!.id)).toBe(true);

    const tops = topExternals(graph).map((n) => n.path.replace(/\\/g, '/'));
    expect(tops.some((p) => p.endsWith('/beta'))).toBe(true);
  });
});

describe('(A) 접합이 자기 안을 말한다 — 자손 롤업 요약', () => {
  it('접합에 그 아래에서 만진 폴더 수 · 파일 수 · 이름 칩이 실린다', () => {
    const graph = makeGraph(1); // 승격을 꺼서 접합 하나에 다 모이게
    editExternal(graph, 'alpha/a1.txt', 'toolu-a1');
    editExternal(graph, 'alpha/a2.txt', 'toolu-a2');
    editExternal(graph, 'beta/b1.txt', 'toolu-b1');

    const junction = topExternals(graph)[0]!;
    // 종전에는 이 자리가 `activity=0` · 위성 0 · 숫자는 직속 자식 수뿐이었다.
    expect(junction.externalDescendantFolders).toBe(2);
    expect(junction.externalDescendantFiles).toBe(3);
    expect(junction.externalSummaryChips).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });

  it('히트도 자손 합으로 굴러온다 — 없으면 접합은 자손이 뜨거워도 영원히 회색이다', () => {
    const graph = makeGraph(1);
    editExternal(graph, 'alpha/a1.txt', 'toolu-a1');
    editExternal(graph, 'beta/b1.txt', 'toolu-b1');

    const junction = topExternals(graph)[0]!;
    expect(junction.readCount ?? 0).toBe(0);           // 접합은 스스로 만져진 적이 없다
    expect(junction.externalRollupWriteCount ?? 0).toBeGreaterThan(0); // 그런데 자손은 고쳐졌다
  });

  it('요약은 표시 전용 파생값이다 — 자손이 빠지면 함께 줄어든다', () => {
    const graph = makeGraph(1);
    editExternal(graph, 'alpha/a1.txt', 'toolu-a1');
    editExternal(graph, 'beta/b1.txt', 'toolu-b1');
    expect(topExternals(graph)[0]!.externalDescendantFolders).toBe(2);

    const beta = findByPathEnd(graph, '/beta');
    graph.removeBubble(beta!.id);

    // 형제가 하나로 줄면 접합은 사라지고 남은 폴더가 최상위로 올라온다(트리 규율 그대로).
    const tops = topExternals(graph);
    expect(tops).toHaveLength(1);
    expect(tops[0]!.path.replace(/\\/g, '/').endsWith('/alpha')).toBe(true);
  });
});

describe('(C) 휘발 경로 접기 — 세션이 늘어도 버블은 하나', () => {
  const UUID = (n: number) => `6926b71f-4898-481d-a4f0-df5629adb3${String(n).padStart(2, '0')}`;

  it('세션 UUID 자리는 자기 버블을 갖지 않고 가장 가까운 비휘발 조상에 모인다', () => {
    const graph = makeGraph(12);
    for (let i = 0; i < 5; i++) {
      editExternal(graph, `claudetmp/proj/${UUID(i)}/tasks/t.json`, `toolu-u${i}`);
    }

    // 종전이었다면 세션마다 폴더 버블 하나씩. 이제는 `…/proj` 한 자리에 모인다.
    const proj = findByPathEnd(graph, '/claudetmp/proj');
    expect(proj).toBeDefined();
    expect(proj!.externalFoldedPlaces).toBe(5);

    // 세션 폴더 자체는 버블이 되지 않는다.
    expect(findByPathEnd(graph, `/${UUID(0)}`)).toBeUndefined();
    expect(findByPathEnd(graph, `/${UUID(0)}/tasks`)).toBeUndefined();
  });

  it('평범한 폴더명은 접지 않는다 — 모르는 것을 휘발로 넘겨짚지 않는다', () => {
    const graph = makeGraph(12);
    editExternal(graph, 'plain/sess-1/tasks/t.json', 'toolu-p1');
    expect(findByPathEnd(graph, '/plain/sess-1/tasks')).toBeDefined();
  });
});

describe('(D) 읽는 이름 — 경로는 그대로 두고 라벨만 바뀐다', () => {
  it('알려진 자리면 i18n 키가 실리고, 모르는 자리는 비어 있다', () => {
    const graph = makeGraph(12);
    // 홈 아래 `.claude/…` 는 이 테스트의 임시 폴더가 아니라 실제 홈 기준이라, 여기서는
    // "모르는 자리는 키가 없다"만 고정한다(사전 매칭 자체는 `externalFolderView.test.ts`
    // 가 세 OS 로 재고 있다 — 판정이 두 벌이 아니라는 것이 이 시험의 요지다).
    editExternal(graph, 'alpha/a.txt', 'toolu-a');
    const alpha = findByPathEnd(graph, '/alpha');
    expect(alpha).toBeDefined();
    expect(alpha!.externalPlaceKey).toBeUndefined();
    // 경로는 무슨 일이 있어도 그대로다 — 탐색기 열기·위성 매칭이 여기에 걸려 있다.
    expect(alpha!.absolutePath?.replace(/\\/g, '/')).toContain('/alpha');
  });
});
