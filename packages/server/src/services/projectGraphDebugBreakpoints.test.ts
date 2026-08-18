import { describe, expect, it } from 'vitest';
import type { DebugBreakpoint } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { mergeSnapshots } from './projectGraphManager.js';

/**
 * §5.5 #17-20 ⑩ v4.94 — 중단점의 **영속 왕복** 회귀 테스트.
 *
 * 앱 버블(§5.13)·플레이 버블(§5.14)에서 이미 두 번 데인 자리를 그대로 못 박는다:
 *   ① `toProjectCheckpoint`(디스크 포맷)를 빠뜨리면 화면엔 보이는데 **껐다 켜면 사라진다**.
 *   ② `mergeSnapshots` 를 빠뜨리면 프로젝트를 **둘 이상 연 사람에게만** 사라진다.
 *
 * 중단점 고유의 계약도 하나 있다: **세션 상태는 저장하지 않는다.** 어느 줄에 찍었는지는
 * 사용자의 것이라 살아나야 하지만, `verified`(어댑터가 실제로 걸었는가)는 그때 그 프로세스의
 * 사정이라 다음 실행에서 다시 판정된다.
 */

const PROJECT_CWD = '/tmp/breakpoint-project';

function makeGraph(): { graph: ProjectGraph; projectName: string } {
  const graph = new ProjectGraph();
  // 프로젝트가 등록돼 있어야 toProjectCheckpoint 의 이름 필터를 통과한다.
  const info = graph.registerProject(PROJECT_CWD);
  return { graph, projectName: info.name };
}

const BPS: DebugBreakpoint[] = [
  { file: 'src/server.ts', line: 12, enabled: true },
  { file: 'src/server.ts', line: 40, enabled: false },
  { file: 'src/util/a.ts', line: 3, enabled: true },
];

describe('중단점 — 저장과 조회', () => {
  it('찍으면 목록과 스냅샷에 함께 나타난다', () => {
    const { graph, projectName } = makeGraph();
    graph.setDebugBreakpoints(projectName, BPS);

    expect(graph.getDebugBreakpoints(projectName)).toHaveLength(3);
    expect(graph.getSnapshot().debugBreakpoints?.[projectName]).toHaveLength(3);
  });

  it('전량 교체다 — 보낸 목록이 곧 전체가 된다(부분 갱신 축 ❌)', () => {
    const { graph, projectName } = makeGraph();
    graph.setDebugBreakpoints(projectName, BPS);
    graph.setDebugBreakpoints(projectName, [{ file: 'src/server.ts', line: 12, enabled: true }]);

    expect(graph.getDebugBreakpoints(projectName)).toEqual([
      { file: 'src/server.ts', line: 12, enabled: true },
    ]);
  });

  it('빈 목록을 보내면 그 프로젝트 키 자체가 사라진다(빈 배열을 방송하지 않는다)', () => {
    const { graph, projectName } = makeGraph();
    graph.setDebugBreakpoints(projectName, BPS);
    graph.setDebugBreakpoints(projectName, []);

    expect(graph.getDebugBreakpoints(projectName)).toEqual([]);
    expect(graph.getSnapshot().debugBreakpoints).toBeUndefined();
  });

  it('망가진 항목(줄 번호 0·빈 경로)은 버리고 나머지는 살린다', () => {
    const { graph, projectName } = makeGraph();
    graph.setDebugBreakpoints(projectName, [
      { file: '', line: 5, enabled: true },
      { file: 'src/a.ts', line: 0, enabled: true },
      { file: 'src/a.ts', line: 7, enabled: true },
    ]);
    expect(graph.getDebugBreakpoints(projectName)).toEqual([
      { file: 'src/a.ts', line: 7, enabled: true },
    ]);
  });

  it('enabled 를 안 주면 켜진 것으로 본다(끄는 것은 명시적인 행동이다)', () => {
    const { graph, projectName } = makeGraph();
    graph.setDebugBreakpoints(projectName, [
      { file: 'src/a.ts', line: 7 } as DebugBreakpoint,
    ]);
    expect(graph.getDebugBreakpoints(projectName)[0]?.enabled).toBe(true);
  });
});

describe('중단점 — 영속 왕복 (껐다 켜도 남는가)', () => {
  it('프로젝트 체크포인트에 실리고 그대로 복원된다', () => {
    const { graph, projectName } = makeGraph();
    graph.setDebugBreakpoints(projectName, BPS);

    const cp = graph.toProjectCheckpoint(projectName);
    expect(cp.debugBreakpoints).toHaveLength(3);

    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(cp);
    expect(restored.getDebugBreakpoints(projectName)).toEqual(BPS);
  });

  it('멀티프로젝트 보트에서 병합으로 들어온다 (restore 의 짝)', () => {
    const { graph, projectName } = makeGraph();
    graph.setDebugBreakpoints(projectName, BPS);
    const cp = graph.toProjectCheckpoint(projectName);

    const other = new ProjectGraph();
    other.registerProject('/tmp/other-project');
    other.mergeFromCheckpoint(cp);

    expect(other.getDebugBreakpoints(projectName)).toEqual(BPS);
  });

  it('중단점이 없던 구버전 체크포인트도 그대로 복원된다 (하위 호환)', () => {
    const { graph, projectName } = makeGraph();
    const cp = graph.toProjectCheckpoint(projectName);
    expect(cp.debugBreakpoints).toBeUndefined();

    const restored = new ProjectGraph();
    expect(() => restored.restoreFromCheckpoint(cp)).not.toThrow();
    expect(restored.getDebugBreakpoints(projectName)).toEqual([]);
  });
});

describe('중단점 — 스냅샷 병합 (프로젝트를 둘 이상 연 사람)', () => {
  it('mergeSnapshots 가 두 프로젝트의 중단점을 모두 남긴다', () => {
    const a = new ProjectGraph();
    const infoA = a.registerProject('/tmp/proj-a');
    a.setDebugBreakpoints(infoA.name, [{ file: 'a.ts', line: 1, enabled: true }]);

    const b = new ProjectGraph();
    const infoB = b.registerProject('/tmp/proj-b');
    b.setDebugBreakpoints(infoB.name, [{ file: 'b.ts', line: 2, enabled: true }]);

    const merged = mergeSnapshots(a.getSnapshot(), b.getSnapshot());
    expect(merged.debugBreakpoints?.[infoA.name]).toHaveLength(1);
    expect(merged.debugBreakpoints?.[infoB.name]).toHaveLength(1);
  });

  it('둘 다 비어 있으면 필드를 만들지 않는다', () => {
    const a = new ProjectGraph();
    a.registerProject('/tmp/proj-a');
    const b = new ProjectGraph();
    b.registerProject('/tmp/proj-b');
    expect(mergeSnapshots(a.getSnapshot(), b.getSnapshot()).debugBreakpoints).toBeUndefined();
  });
});
