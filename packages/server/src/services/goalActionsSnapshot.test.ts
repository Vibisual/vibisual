/**
 * §5.5 #17-17 ⑫ — **팔레트가 화면까지 닿는가** 회귀.
 *
 * 집계 산식(`goalActions.test.ts`)이 맞아도 배선이 한 곳이라도 비면 팔레트는 빈 서랍이 되는데,
 * 그 실패는 "아직 안 배웠다"와 똑같이 생겨서 눈으로는 못 잡는다. 그래서 세 지점을 못박는다 —
 * 스냅샷에 실리는가 · 고정이 껐다 켜도 사는가 · **프로젝트를 2개 열어도 살아남는가**.
 *
 * 마지막 축이 이 파일을 쓰게 한 이유다: `mergeSnapshots` 는 필드를 **하나하나 적어** 합치므로,
 * 새 필드를 거기 등록하지 않으면 다중 프로젝트에서만 조용히 사라진다(brain·sessionGoals 가
 * 이미 그 결함을 겪었고 주석으로 경고까지 남아 있다). 같은 자리에서 `visualKinds` 가 **실제로
 * 빠져 있던 것**을 이 라운드에 함께 고쳤으므로 그것도 여기서 함께 지킨다.
 */
import { describe, expect, it } from 'vitest';
import { ProjectGraph } from './projectGraph.js';
import { mergeSnapshots } from './projectGraphManager.js';

function graphWith(cwd: string): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  const info = graph.registerProject(cwd);
  return { graph, projectName: info.name };
}

describe('⑫(a) 팔레트가 스냅샷에 실린다', () => {
  it('스킬을 부르면 그 스킬이 팔레트에 선다', () => {
    const { graph } = graphWith('/tmp/proj-a');
    graph.recordSkillUsageFromCommandText('/vibisual-qa 점검해줘');

    const cards = graph.getSnapshot().goalActions;
    expect(cards?.map((c) => c.id)).toContain('skill:vibisual-qa');
    expect(cards?.find((c) => c.id === 'skill:vibisual-qa')?.payload).toBe('/vibisual-qa');
  });

  it('아무 것도 배우지 않았으면 빈 배열이 아니라 undefined 다(전선에 빈 칸을 싣지 않는다)', () => {
    const { graph } = graphWith('/tmp/proj-empty');
    expect(graph.getSnapshot().goalActions).toBeUndefined();
  });
});

describe('⑫(b) 고정은 껐다 켜도 산다 — 팔레트 자체는 파생이라 저장되지 않는다', () => {
  it('디스크 포맷 → 복원 왕복에서 고정이 남는다', () => {
    const { graph, projectName } = graphWith('/tmp/proj-pin');
    graph.recordSkillUsageFromCommandText('/release');
    graph.setGoalActionPinned('skill:release', true);

    const cp = graph.toProjectCheckpoint(projectName);
    expect(cp?.pinnedGoalActions).toEqual(['skill:release']);
    // 파생 목록은 디스크에 실리지 않는다 — 저장하면 배운 것과 저장본이 갈린다.
    expect((cp as unknown as { goalActions?: unknown }).goalActions).toBeUndefined();

    const revived = new ProjectGraph();
    revived.restoreFromCheckpoint(cp!);
    revived.recordSkillUsageFromCommandText('/release');
    expect(revived.getSnapshot().goalActions?.[0]).toMatchObject({ id: 'skill:release', pinned: true });
  });

  it('해제하면 저장본에서도 빠진다', () => {
    const { graph, projectName } = graphWith('/tmp/proj-unpin');
    graph.recordSkillUsageFromCommandText('/release');
    graph.setGoalActionPinned('skill:release', true);
    graph.setGoalActionPinned('skill:release', false);
    expect(graph.toProjectCheckpoint(projectName)?.pinnedGoalActions).toBeUndefined();
  });
});

describe('⑫ 프로젝트를 2개 열어도 사라지지 않는다 — mergeSnapshots 등록', () => {
  it('두 프로젝트의 팔레트가 합쳐진다', () => {
    const a = graphWith('/tmp/merge-a');
    const b = graphWith('/tmp/merge-b');
    a.graph.recordSkillUsageFromCommandText('/release');
    b.graph.recordSkillUsageFromCommandText('/vibisual-qa');

    const merged = mergeSnapshots(a.graph.getSnapshot(), b.graph.getSnapshot());
    expect(merged.goalActions?.map((c) => c.id).sort()).toEqual(['skill:release', 'skill:vibisual-qa']);
  });

  it('같은 id 는 한 칸으로 접히고 많이 배운 쪽이 남는다', () => {
    const a = graphWith('/tmp/merge-c');
    const b = graphWith('/tmp/merge-d');
    a.graph.recordSkillUsageFromCommandText('/release');
    b.graph.recordSkillUsageFromCommandText('/release\n/release');

    const merged = mergeSnapshots(a.graph.getSnapshot(), b.graph.getSnapshot());
    expect(merged.goalActions).toHaveLength(1);
    expect(merged.goalActions?.[0]?.useCount).toBe(2);
  });

  it('⑪(a) 종류 카드도 병합에서 살아남는다 — 빠져 있으면 무대가 통째로 중립 점이 된다', () => {
    const a = graphWith('/tmp/merge-kind-a');
    const b = graphWith('/tmp/merge-kind-b');
    a.graph.upsertVisualKind({ key: 'shader', label: '셰이더', color: '#F472B6' });
    b.graph.upsertVisualKind({ key: 'migration', label: '이관' });

    const merged = mergeSnapshots(a.graph.getSnapshot(), b.graph.getSnapshot());
    expect(Object.keys(merged.visualKinds ?? {}).sort()).toEqual(
      expect.arrayContaining(['migration', 'shader']),
    );
  });
});
