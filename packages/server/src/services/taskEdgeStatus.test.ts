/**
 * §5.3 #12 — TaskEdge 상태 전이 계약. 그래프 인스턴스 setter 와 매니저 폴백 setter 가 같은 한 벌(`applyTaskEdgeStatus`)을 탄다.
 * ① `errorMessage` 는 지금의 실패만 — 재시도가 성공하면 지난 오류가 남지 않는다.
 * ② `lastExecutedAt` 은 실행 회차 식별자 — 스냅샷 배치가 중간 전이를 접어도 새 회차가 보이고, 같은 회차의 재진입은 올리지 않는다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskEdge } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { graphManager } from './projectGraphManager.js';
import { createSnapshotBroadcastScheduler, type SnapshotBroadcastScheduler } from './snapshotBroadcastScheduler.js';
import { applyTaskEdgeStatus } from './taskEdgeStatus.js';

let scheduler: SnapshotBroadcastScheduler | undefined;
afterEach(() => {
  scheduler?.dispose();
  scheduler = undefined;
  vi.useRealTimers();
});

function newEdge(graph: ProjectGraph): TaskEdge {
  return graph.createTaskEdge('agent-src', 'agent-dst', 'run checks', 'manual', null, { returnFormat: 'summary' });
}

function snap(graph: ProjectGraph, id: string): TaskEdge {
  const edge = graph.getTaskEdgesSnapshot()[id];
  if (!edge) throw new Error(`edge not found: ${id}`);
  return edge;
}

describe('TaskEdge 오류는 지금의 실패만 담는다', () => {
  it('실패 뒤 재시도가 성공하면 지난 오류가 남지 않는다', () => {
    const graph = new ProjectGraph();
    const edge = newEdge(graph);
    graph.setTaskEdgeStatus(edge.id, 'error', 'old failure result', 'OLD_FAILURE');
    expect(snap(graph, edge.id).errorMessage).toBe('OLD_FAILURE');

    graph.setTaskEdgeStatus(edge.id, 'executing');
    expect(snap(graph, edge.id).errorMessage).toBeUndefined();

    graph.setTaskEdgeStatus(edge.id, 'completed', 'NEW_SUCCESS');
    const after = snap(graph, edge.id);
    expect(after).toMatchObject({ status: 'completed', lastResult: 'NEW_SUCCESS' });
    expect(after.errorMessage).toBeUndefined();
  });

  it('다시 실패하면 새 오류로 바뀐다', () => {
    const graph = new ProjectGraph();
    const edge = newEdge(graph);
    graph.setTaskEdgeStatus(edge.id, 'error', undefined, 'FIRST');
    graph.setTaskEdgeStatus(edge.id, 'executing');
    graph.setTaskEdgeStatus(edge.id, 'error', undefined, 'SECOND');
    expect(snap(graph, edge.id)).toMatchObject({ status: 'error', errorMessage: 'SECOND' });
  });

  it('매니저 경로도 같은 계약이다', () => {
    const edge = graphManager.createTaskEdge('agent-mgr-src', 'agent-mgr-dst', 'run checks', 'manual', null);
    try {
      graphManager.setTaskEdgeStatus(edge.id, 'error', undefined, 'OLD_FAILURE');
      graphManager.setTaskEdgeStatus(edge.id, 'executing');
      graphManager.setTaskEdgeStatus(edge.id, 'completed', 'NEW_SUCCESS');
      const after = graphManager.getTaskEdge(edge.id);
      expect(after).toMatchObject({ status: 'completed', lastResult: 'NEW_SUCCESS' });
      expect(after?.errorMessage).toBeUndefined();
    } finally {
      graphManager.deleteTaskEdge(edge.id);
    }
  });
});

describe('TaskEdge 실행 회차 표식', () => {
  it('한 스냅샷 배치 안의 재실행도 회차 표식이 바뀐 채 나간다', () => {
    vi.useFakeTimers();
    const graph = new ProjectGraph();
    const edge = newEdge(graph);
    graph.setTaskEdgeStatus(edge.id, 'executing');
    graph.setTaskEdgeStatus(edge.id, 'completed', 'previous result');
    const previousRun = snap(graph, edge.id).lastExecutedAt;
    expect(previousRun).toBeTypeOf('number');

    const sent: Array<Pick<TaskEdge, 'status' | 'lastExecutedAt' | 'lastResult'>> = [];
    scheduler = createSnapshotBroadcastScheduler({
      minDelayMs: 16, maxDelayMs: 250, backoffFactor: 4,
      flush: () => {
        const { status, lastExecutedAt, lastResult } = snap(graph, edge.id);
        sent.push({ status, lastExecutedAt, lastResult });
      },
      onError: (error) => { throw error; },
    });
    graph.setTaskEdgeStatus(edge.id, 'executing'); scheduler.request();
    graph.setTaskEdgeStatus(edge.id, 'completed', 'new result'); scheduler.request();
    vi.advanceTimersByTime(16);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ status: 'completed', lastResult: 'new result' });
    expect(sent[0]!.lastExecutedAt).toBeGreaterThan(previousRun!);
  });

  it('같은 밀리초에 두 번 나가도 회차가 겹치지 않는다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const edge = { status: 'idle' } as TaskEdge;
    applyTaskEdgeStatus(edge, 'executing');
    const first = edge.lastExecutedAt!;
    applyTaskEdgeStatus(edge, 'completed', 'done');
    applyTaskEdgeStatus(edge, 'executing');
    expect(edge.lastExecutedAt).toBeGreaterThan(first);
  });

  it('같은 회차를 잇는 재진입과 끝 상태는 회차를 올리지 않는다', () => {
    const edge = { status: 'idle' } as TaskEdge;
    applyTaskEdgeStatus(edge, 'executing');
    const run = edge.lastExecutedAt;
    applyTaskEdgeStatus(edge, 'completed', 'entry turn done');
    applyTaskEdgeStatus(edge, 'executing', undefined, undefined, { sameRun: true });
    applyTaskEdgeStatus(edge, 'error', undefined, 'verification failed');
    expect(edge.lastExecutedAt).toBe(run);
    expect(edge.errorMessage).toBe('verification failed');
  });
});
