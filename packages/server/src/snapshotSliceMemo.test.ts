/**
 * §9 (2d) — **슬라이스별 버전 메모이제이션**을 고정한다.
 *
 * 왜 있나: `getSnapshot()` 은 에이전트가 도는 내내 16~250ms 마다 불리고, 서버가 Electron 메인
 * 프로세스와 한 몸이라 여기서 태운 밀리초가 그대로 프레임에서 나간다. 그런데 무효화 신호가
 * `mutationVersion` **전역 하나**뿐이라 어느 슬라이스가 바뀌었는지 몰랐고, 한 슬라이스만 바뀌어도
 * 키맵 슬라이스 전부를 다시 순회했다. 2026-09-02 라운드의 `stableCopy` 는 "복사"만 아꼈을 뿐
 * "순회"는 그대로 지불했다.
 *
 * 그래서 이 파일이 지키는 것은 넷이고, **하나라도 무너지면 최적화가 조용히 0 이 되거나(①②)
 * 더 나쁘게는 데이터가 사라진다(③④)**:
 *  ① 안 바뀌면 **같은 참조**가 나온다 — 순회를 건너뛴다는 뜻이고, 증분(`broadcastBus`)의 전제다.
 *  ② 한 슬라이스를 바꾸면 **그 슬라이스만** 새 참조다 — 하나 바뀌었다고 전부 다시 짓지 않는다.
 *  ③ 값이 memo 없이 지은 것과 **한 글자도 다르지 않다** — 성능 경로일 뿐 정확성 경로가 아니다.
 *  ④ **TTL 안전망** — `VersionedMap` 이 못 잡는 제자리 변경도 한 창 안에 반드시 다시 지어진다.
 *
 * ④ 가 없으면 `map.get(k)!.push(x)` 같은 제자리 변경이 영영 "안 바뀜"으로 읽혀 **유실된다.**
 * 이 "감지 + TTL" 두 층은 §9 「저장은 바뀐 프로젝트만」(`CHECKPOINT_QUIET_SWEEP_MS`)과 같은 규약이다.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentReport, SessionLoop, SessionMemo } from '@vibisual/shared';
import { ProjectGraph, VersionedMap } from './services/projectGraph.js';

vi.mock('./services/appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./services/appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

/**
 * `SLICE_MEMO_TTL`(= `SNAPSHOT_CACHE_TTL`, 200ms) 은 private 이라 여기 값을 박는다.
 * 정확한 값이 아니라 "확실히 넘겼다"만 필요하므로 넉넉히 잡는다 — 상수를 올려도 이 테스트는 산다.
 */
const PAST_TTL_MS = 5_000;

const tmpDirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const d of tmpDirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function makeGraph(): ProjectGraph {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-memo-')));
  tmpDirs.push(dir);
  const g = new ProjectGraph();
  g.registerProject(dir);
  return g;
}

const report = (agentId: string, id: string): AgentReport =>
  ({ id, agentId, did: 'did ' + id, userActions: [], createdAt: Date.now() } as unknown as AgentReport);

const memoCard = (id: string): SessionMemo =>
  ({ id, text: 'memo ' + id, createdAt: Date.now() } as unknown as SessionMemo);

const loop = (agentId: string, subAgentId: string, command: string): SessionLoop =>
  ({
    agentId,
    subAgentId,
    command,
    mode: 'count',
    total: 3,
    completed: 0,
    enabled: true,
    intervalMs: 0,
    stopOnError: true,
    contextMode: 'none',
    spentCostUsd: 0,
    spentTokens: 0,
  } as unknown as SessionLoop);

/** 서로 다른 키맵 슬라이스 여럿을 한꺼번에 채운다(②·③ 이 여러 축을 봐야 의미가 있다). */
function seed(g: ProjectGraph): void {
  for (const a of ['a1', 'a2', 'a3']) g.addAgentReport(report(a, a + '-r1'));
  g.setAgentMemos('a1', [memoCard('m1')]);
  g.setSessionGoal({ agentId: 'a1', subAgentId: 's1', text: '목표 하나', steps: [] });
  g.setSessionLoop(loop('a1', 's1', '반복 명령'));
}

/** 내부 소스 맵을 **일부러** 들여다본다 — ④ 가 재현해야 하는 사고가 바로 이 경로다. */
function innerReports(g: ProjectGraph): Map<string, AgentReport[]> {
  return (g as unknown as { agentReports: Map<string, AgentReport[]> }).agentReports;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('VersionedMap — 누락이 구조적으로 불가능한 감지', () => {
  it('set/delete/clear 만 버전을 올린다', () => {
    const m = new VersionedMap<string, number>();
    expect(m.version).toBe(0);

    m.set('a', 1);
    expect(m.version).toBe(1);

    // 같은 키에 같은 값을 다시 넣어도 "손댔다"로 친다 — 값 동등성 비교는 memo 가 아끼려는
    // 그 순회만큼 비싸다. 과잉 무효화는 느려질 뿐이지만 과소 무효화는 유실이다.
    m.set('a', 1);
    expect(m.version).toBe(2);

    m.get('a');
    m.has('a');
    void [...m.entries()];
    expect(m.version).toBe(2); // 읽기는 안 올린다

    expect(m.delete('none')).toBe(false);
    expect(m.version).toBe(2); // 없는 키 삭제는 변경이 아니다

    expect(m.delete('a')).toBe(true);
    expect(m.version).toBe(3);

    m.clear();
    expect(m.version).toBe(3); // 이미 비었으면 변경 아님

    m.set('b', 2);
    m.clear();
    expect(m.version).toBe(5);
  });

  it('Map 으로 통한다 — 기존 호출 코드를 한 줄도 안 고쳐도 되는 이유', () => {
    const m = new VersionedMap<string, number>();
    m.set('a', 1);
    expect(m instanceof Map).toBe(true);
    expect(Object.fromEntries(m)).toEqual({ a: 1 });
    expect(m.size).toBe(1);
    expect([...m.keys()]).toEqual(['a']);
  });
});

describe('① 아무것도 안 바꾸면 키맵 슬라이스가 같은 참조다', () => {
  it('빌더를 두 번 불러도 같은 Record 객체다 — 순회를 아예 건너뛴다는 뜻', () => {
    const g = makeGraph();
    seed(g);

    const first = g.getAgentReportsRecord();
    const second = g.getAgentReportsRecord();

    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it('getSnapshot 을 두 번 불러도(스냅샷 통째 캐시를 비운 뒤에도) 슬라이스는 같은 참조다', () => {
    const g = makeGraph();
    seed(g);

    const s1 = g.getSnapshot();
    // 스냅샷 캐시만 무효화하고 키맵 소스는 하나도 안 건드리는 창구.
    // 이게 없으면 스냅샷 통째 캐시에 가려 슬라이스 memo 가 실제로 도는지 확인할 수 없다.
    g.notifyBrainChanged();
    const s2 = g.getSnapshot();

    expect(s2).not.toBe(s1);                        // 스냅샷 자체는 새로 지어졌고
    expect(s2.agentReports).toBe(s1.agentReports);  // 슬라이스는 안 지어졌다
    expect(s2.agentMemos).toBe(s1.agentMemos);
    expect(s2.sessionGoals).toBe(s1.sessionGoals);
    expect(s2.sessionLoops).toBe(s1.sessionLoops);
  });

  it('내용이 하나도 없는 슬라이스는 계속 undefined 다 — 빈 객체를 새로 짓지 않는다', () => {
    const g = makeGraph();
    expect(g.getAgentReportsRecord()).toBeUndefined();
    expect(g.getAgentReportsRecord()).toBeUndefined();
    expect(g.getSessionGoalsRecord()).toBeUndefined();
  });
});

describe('② 한 슬라이스를 바꾸면 그 슬라이스만 새 참조다', () => {
  it('보고를 하나 더 하면 agentReports 만 새것이고 나머지는 그대로다', () => {
    const g = makeGraph();
    seed(g);

    const before = {
      reports: g.getAgentReportsRecord(),
      memos: g.getAgentMemosRecord(),
      goals: g.getSessionGoalsRecord(),
      loops: g.getSessionLoopsRecord(),
    };

    g.addAgentReport(report('a1', 'a1-r2'));

    expect(g.getAgentReportsRecord()).not.toBe(before.reports); // 바뀐 축만 새것
    expect(g.getAgentMemosRecord()).toBe(before.memos);         // 나머지는 순회조차 안 했다
    expect(g.getSessionGoalsRecord()).toBe(before.goals);
    expect(g.getSessionLoopsRecord()).toBe(before.loops);
  });

  it('목표를 고치면 sessionGoals 만 새것이다 (반대 방향도 같다)', () => {
    const g = makeGraph();
    seed(g);

    const beforeReports = g.getAgentReportsRecord();
    const beforeLoops = g.getSessionLoopsRecord();
    const beforeGoals = g.getSessionGoalsRecord();

    g.setSessionGoal({ agentId: 'a1', subAgentId: 's1', text: '목표 고침', steps: [] });

    expect(g.getSessionGoalsRecord()).not.toBe(beforeGoals);
    expect(g.getAgentReportsRecord()).toBe(beforeReports);
    expect(g.getSessionLoopsRecord()).toBe(beforeLoops);
  });

  it('안 건드린 키의 값 사본은 슬라이스를 다시 지어도 그대로다 (증분의 전제 유지)', () => {
    const g = makeGraph();
    seed(g);
    const before = g.getAgentReportsRecord();

    g.addAgentReport(report('a1', 'a1-r2'));
    const after = g.getAgentReportsRecord();

    expect(after?.['a2']).toBe(before?.['a2']);     // 조용한 에이전트는 같은 배열
    expect(after?.['a1']).not.toBe(before?.['a1']); // 뱉은 쪽만 새 배열
    expect(after?.['a1']).toHaveLength(2);
  });

  it('키를 지워도 잡힌다 — delete 가 감지에서 빠지면 좀비 키가 전선에 남는다', () => {
    const g = makeGraph();
    seed(g);
    const before = g.getAgentMemosRecord();
    expect(before?.['a1']).toBeDefined();

    g.setAgentMemos('a1', []); // 빈 목록 = 항목 자체를 지운다

    const after = g.getAgentMemosRecord();
    expect(after).not.toBe(before);
    expect(after).toBeUndefined();
  });
});

describe('③ 값이 memo 없이 지은 것과 같다 (성능 경로일 뿐 정확성 경로가 아니다)', () => {
  it('memo 를 무효화해 다시 지어도 결과가 깊이 같다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00Z'));

    const g = makeGraph();
    seed(g);

    const memoized = {
      reports: g.getAgentReportsRecord(),
      memos: g.getAgentMemosRecord(),
      goals: g.getSessionGoalsRecord(),
      loops: g.getSessionLoopsRecord(),
      taskEdges: g.getTaskEdgesSnapshot(),
      compactCounts: g.getCompactCounts(),
      contis: g.getContisRecord(),
    };

    // TTL 을 넘겨 memo 를 걷어낸 뒤 완전히 새로 짓게 한다.
    vi.setSystemTime(Date.now() + PAST_TTL_MS);
    const rebuilt = {
      reports: g.getAgentReportsRecord(),
      memos: g.getAgentMemosRecord(),
      goals: g.getSessionGoalsRecord(),
      loops: g.getSessionLoopsRecord(),
      taskEdges: g.getTaskEdgesSnapshot(),
      compactCounts: g.getCompactCounts(),
      contis: g.getContisRecord(),
    };

    expect(rebuilt).toEqual(memoized);
  });

  it('스냅샷에 실린 슬라이스가 빌더를 직접 부른 결과와 같다', () => {
    const g = makeGraph();
    seed(g);

    const snap = g.getSnapshot();

    expect(snap.agentReports).toEqual(g.getAgentReportsRecord());
    expect(snap.agentMemos).toEqual(g.getAgentMemosRecord());
    expect(snap.sessionGoals).toEqual(g.getSessionGoalsRecord());
    expect(snap.sessionLoops).toEqual(g.getSessionLoopsRecord());
    expect(snap.taskEdges).toEqual(g.getTaskEdgesSnapshot());
  });

  it('바뀐 뒤의 값이 정확하다 — memo 가 옛 내용을 붙들지 않는다', () => {
    const g = makeGraph();
    seed(g);
    g.getAgentReportsRecord(); // memo 를 한 번 세워 두고

    g.addAgentReport(report('a4', 'a4-r1'));

    const after = g.getAgentReportsRecord();
    expect(Object.keys(after ?? {}).sort()).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(after?.['a4']).toHaveLength(1);
  });
});

describe('④ TTL 안전망 — 감지 못 한 변경도 한 창 안에 반드시 다시 지어진다', () => {
  it('시간이 TTL 을 넘으면 소스가 그대로여도 memo 가 무효화된다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00Z'));

    const g = makeGraph();
    seed(g);

    const first = g.getAgentReportsRecord();
    expect(g.getAgentReportsRecord()).toBe(first); // 같은 창 안 = 재사용

    vi.setSystemTime(Date.now() + PAST_TTL_MS);
    const afterTtl = g.getAgentReportsRecord();

    expect(afterTtl).not.toBe(first);              // 다시 지었다
    expect(afterTtl).toEqual(first);               // 소스가 그대로라 값은 같다
    expect(afterTtl?.['a1']).toBe(first?.['a1']);  // 값 사본은 그대로 = 증분은 안 깨진다
  });

  it('제자리 변경(= VersionedMap 이 못 잡는 것)이 TTL 안에 반드시 따라잡힌다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00Z'));

    const g = makeGraph();
    g.addAgentReport(report('a1', 'r1'));
    expect(g.getAgentReportsRecord()?.['a1']).toHaveLength(1);

    // `set` 을 다시 부르지 않고 값 배열을 제자리로 민다 — `appendVerificationAttempt` 의
    // `run.attempts.push` 같은 실제 경로가 하는 짓이다. 맵 버전은 안 올라간다.
    const live = innerReports(g).get('a1');
    expect(live).toBeDefined();
    live?.push(report('a1', 'r2'));

    // 창 안에서는 지난 사본이 나온다 — **이것이 이 설계가 감수하는 최대 지연이다.**
    expect(g.getAgentReportsRecord()?.['a1']).toHaveLength(1);

    // 창을 넘기면 무조건 다시 짓는다 — 그래서 **유실 경로는 없다.**
    vi.setSystemTime(Date.now() + PAST_TTL_MS);
    expect(g.getAgentReportsRecord()?.['a1']).toHaveLength(2);
  });

  it('체크포인트 복원이 맵을 통째로 갈아 끼워도 지난 결과가 새 나가지 않는다', () => {
    const source = makeGraph();
    const incoming = source.createTaskEdge('a1', 'a2', '들어올 명령', 'manual', null);
    const cp = source.toCheckpoint();
    expect(Object.keys(cp.taskEdges ?? {})).toEqual([incoming.id]);

    const target = makeGraph();
    const outgoing = target.createTaskEdge('b1', 'b2', '밀려날 명령', 'manual', null);
    // memo 를 세워 둔다. 이 시점 `taskEdges` 는 set 을 한 번 탄 맵이라 **버전 1** 이다.
    expect(Object.keys(target.getTaskEdgesSnapshot())).toEqual([outgoing.id]);

    // 복원은 `taskEdges` 필드를 **새 VersionedMap** 으로 통째로 바꾼다. 새 맵도 set 한 번이라
    // 역시 버전 1 — memo 가 버전만 봤다면 여기서 밀려난 옛 엣지가 그대로 새 나간다.
    // `source` 객체 동일성까지 대조하는 이유가 정확히 이것이다.
    target.restoreFromCheckpoint(cp);

    expect(Object.keys(target.getTaskEdgesSnapshot())).toEqual([incoming.id]);
  });
});

