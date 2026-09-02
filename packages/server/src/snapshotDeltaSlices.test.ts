/**
 * §9 — **키맵 슬라이스 증분의 두 전제**를 고정한다(2026-09-02 라운드).
 *
 * v3.89 가 `fileEdits`·`bashHistory` 에 증분을 붙였을 때, 나머지 키맵 슬라이스는 손대지 않았다.
 * 넣어 봐야 소용이 없었기 때문이다 — 서버가 그것들을 **매 스냅샷마다 새로 복사**해 내보내고 있어서
 * 참조 비교가 전부 "바뀜"으로 잡혔다(실측 2026-09-02 · 살아 있는 checkpoint: 키맵 941KB 의
 * 참조 유지율 **0%**. 한 에이전트가 한 줄 뱉을 때마다 `agentReports` 240KB·`sessionGoals` 171KB 가
 * 통째로 다시 갔다).
 *
 * 그래서 이 파일이 지키는 것은 둘이고, **둘 중 하나만 무너져도 최적화가 조용히 0이 된다**:
 *  ① 안 바뀐 값은 **같은 사본**이 나온다(`ProjectGraph.stableCopy` / `sessionGoalViewCache`).
 *  ② 표(`DELTA_SLICE_KEYS`)에 있는 슬라이스는 전부 실제로 델타를 타고, 왕복하면 원본과 같다.
 *
 * 실측 효과(같은 체크포인트): 전선 1,184KB → **408.9KB**.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentReport, GraphSnapshot, WSMessage } from '@vibisual/shared';
import { DELTA_SLICE_KEYS, applyKeyedSliceDelta } from '@vibisual/shared';
import { ProjectGraph } from './services/projectGraph.js';
import { broadcast, setBroadcastSink, resetSnapshotDeltaBaseline } from './broadcastBus.js';

vi.mock('./services/appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

const tmpDirs: string[] = [];
afterEach(() => {
  setBroadcastSink(null);
  for (const d of tmpDirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function makeGraph(): ProjectGraph {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-delta-')));
  tmpDirs.push(dir);
  const g = new ProjectGraph();
  g.registerProject(dir);
  return g;
}

const report = (agentId: string, id: string): AgentReport =>
  ({ id, agentId, did: 'did ' + id, userActions: [], createdAt: Date.now() } as unknown as AgentReport);

describe('① 안 바뀐 슬라이스는 같은 사본이 나온다 (델타의 전제)', () => {
  it('두 번 물어도 같은 배열 참조다 — 이게 무너지면 델타가 전부 "바뀜"이 된다', () => {
    const g = makeGraph();
    g.addAgentReport(report('a1', 'r1'));

    const first = g.getAgentReportsRecord();
    const second = g.getAgentReportsRecord();

    expect(first?.['a1']).toBeDefined();
    expect(second?.['a1']).toBe(first?.['a1']);
  });

  it('건드리지 않은 에이전트는 다른 에이전트가 뱉어도 사본이 그대로다', () => {
    const g = makeGraph();
    g.addAgentReport(report('quiet', 'q1'));
    g.addAgentReport(report('busy', 'b1'));
    const before = g.getAgentReportsRecord();

    g.addAgentReport(report('busy', 'b2'));
    const after = g.getAgentReportsRecord();

    expect(after?.['quiet']).toBe(before?.['quiet']);   // 조용한 쪽은 그대로
    expect(after?.['busy']).not.toBe(before?.['busy']); // 뱉은 쪽만 새것
  });

  it('뒤에 붙이면 반드시 새 사본이 온다 — 변경이 유실되면 안 된다', () => {
    const g = makeGraph();
    g.addAgentReport(report('a1', 'r1'));
    const before = g.getAgentReportsRecord();

    g.addAgentReport(report('a1', 'r2'));
    const after = g.getAgentReportsRecord();

    expect(after?.['a1']).not.toBe(before?.['a1']);
    expect(after?.['a1']).toHaveLength(2);
  });

  it('사본은 내부 배열과 다른 객체다 — 원본을 그대로 실으면 델타가 변경을 못 본다', () => {
    const g = makeGraph();
    g.addAgentReport(report('a1', 'r1'));
    const rec = g.getAgentReportsRecord();

    // 제자리 push 로 바뀌는 내부 배열을 그대로 내보내면, 다음 스냅샷에서 참조가 같아
    // "안 바뀜" 으로 읽힌다 — 사본이라야 그 사고가 안 난다.
    g.addAgentReport(report('a1', 'r2'));
    expect(rec?.['a1']).toHaveLength(1);
  });

  it('세션 목표도 같은 규약이다(객체 판)', () => {
    const g = makeGraph();
    g.setSessionGoal({ agentId: 'ag1', subAgentId: 's1', text: '목표 하나', steps: [] });

    const first = g.getSessionGoalsRecord();
    const second = g.getSessionGoalsRecord();

    expect(first?.['s1']).toBeDefined();
    expect(second?.['s1']).toBe(first?.['s1']);
  });
});

describe('② 표에 있는 슬라이스는 전부 델타를 타고, 왕복하면 원본과 같다', () => {
  let sent: WSMessage[] = [];

  beforeEach(() => {
    sent = [];
    resetSnapshotDeltaBaseline();
    setBroadcastSink((m) => { sent.push(m); });
  });

  /** 클라(`useWebSocket.materializeSnapshot`)와 **같은 규칙**으로 전체 맵을 되돌린다. */
  function decode(
    wire: Record<string, unknown>,
    shadow: Record<string, Record<string, unknown>>,
  ): Record<string, unknown> {
    const deltas = wire['deltas'] as Record<string, never> | undefined;
    const full: Record<string, unknown> = { ...wire };
    for (const key of DELTA_SLICE_KEYS) {
      const d = deltas?.[key];
      if (d) {
        const merged = applyKeyedSliceDelta(shadow[key] ?? {}, d);
        shadow[key] = merged;
        full[key] = merged;
      } else {
        shadow[key] = (wire[key] ?? {}) as Record<string, unknown>;
      }
    }
    delete full['deltas'];
    return full;
  }

  const push = (snap: GraphSnapshot): Record<string, unknown> => {
    broadcast({ type: 'graph_snapshot', payload: snap, timestamp: Date.now() } as WSMessage);
    return (sent[sent.length - 1] as unknown as { payload: Record<string, unknown> }).payload;
  };

  it('첫 전송은 전량(기준점 없음), 두 번째부터 바뀐 키만 간다', () => {
    const g = makeGraph();
    // 키가 하나뿐이면 그 하나가 바뀐 순간 "절반 초과"라 `diffKeyedSlice` 가 일부러 전량으로
    // 되돌린다(증분이 이득이 없는 구간). 실사용 규모(에이전트 여럿)로 세운다.
    for (const id of ['a1', 'a2', 'a3', 'a4']) g.addAgentReport(report(id, id + '-r1'));

    const w1 = push(g.getSnapshot());
    expect(w1['deltas']).toBeUndefined();
    expect(w1['agentReports']).toBeDefined();

    g.addAgentReport(report('a1', 'a1-r2'));
    const w2 = push(g.getSnapshot());
    const deltas = w2['deltas'] as Record<string, { changed: Record<string, unknown> }>;
    expect(deltas).toBeDefined();
    expect(deltas['agentReports']).toBeDefined();
    expect(w2['agentReports']).toBeUndefined(); // 전량은 빠졌다
    // 뱉은 한 에이전트만 실린다 — 나머지 셋은 전선에 오르지 않는다.
    expect(Object.keys(deltas['agentReports']!.changed)).toEqual(['a1']);
  });

  it('증분을 풀면 서버 원본과 한 글자도 다르지 않다 (표의 모든 슬라이스)', () => {
    const g = makeGraph();
    g.addAgentReport(report('a1', 'r1'));
    g.setSessionGoal({ agentId: 'ag1', subAgentId: 's1', text: '목표', steps: [] });

    const shadow: Record<string, Record<string, unknown>> = {};
    decode(push(g.getSnapshot()), shadow);

    g.addAgentReport(report('a2', 'r9'));
    g.setSessionGoal({ agentId: 'ag1', subAgentId: 's1', text: '목표 고침', steps: [] });
    const server = g.getSnapshot();
    const client = decode(push(server), shadow);

    for (const key of DELTA_SLICE_KEYS) {
      const authoritative = (server as unknown as Record<string, unknown>)[key];
      if (authoritative === undefined) continue;
      expect(client[key], key + ' 가 어긋났다').toEqual(authoritative);
    }
  });

  it('서버가 안 싣는 슬라이스를 빈 객체로 지어 보내지 않는다', () => {
    // 보고·목표가 하나도 없으면 그 슬라이스는 `undefined` 다. 증분이 그것을 `{}` 로 바꾸면
    // 그 기능을 안 쓰는 사람에게 매번 새 빈 객체가 가서 §9 ③(고정 참조)이 깨진다.
    const g = makeGraph();

    const w1 = push(g.getSnapshot());
    const w2 = push(g.getSnapshot());

    for (const wire of [w1, w2]) {
      expect(wire['agentReports']).toBeUndefined();
      expect(wire['sessionGoals']).toBeUndefined();
      const deltas = wire['deltas'] as Record<string, unknown> | undefined;
      expect(deltas?.['agentReports']).toBeUndefined();
      expect(deltas?.['sessionGoals']).toBeUndefined();
    }
  });

  it('기준점을 지우면 다음 전송이 다시 전량이다 (새 클라이언트 안전망)', () => {
    const g = makeGraph();
    g.addAgentReport(report('a1', 'r1'));
    push(g.getSnapshot());
    g.addAgentReport(report('a1', 'r2'));
    expect((push(g.getSnapshot())['deltas'] as object)).toBeDefined();

    resetSnapshotDeltaBaseline();
    g.addAgentReport(report('a1', 'r3'));
    const after = push(g.getSnapshot());

    expect(after['deltas']).toBeUndefined();
    expect(after['agentReports']).toBeDefined();
  });
});
