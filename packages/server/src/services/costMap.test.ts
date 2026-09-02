// SCENARIO.md §5.21 — 비용·토큰 지도 회귀 테스트.
//
// 여기서 지키려는 것은 셋이다.
//  (1) 같은 세션을 여러 번 훑어도 **두 번 더해지지 않는다**(스윕은 20초마다 돈다 — 중복 가산은
//      화면에서 알아채기 어렵고 청구액 감각을 통째로 망친다).
//  (2) 캡에 밀린 세션의 몫이 **합계에서 사라지지 않는다**(내역만 잃고 총액은 남는다).
//  (3) 턴을 못 읽은 세션은 `$0` 이 아니라 **측정 없음**이다.

import { describe, it, expect } from 'vitest';
import type { ModelRegistry, TurnTokenUsage } from '@vibisual/shared';
import { COST_MAP_SESSIONS_MAX, calculateTokenCost, costDayKey } from '@vibisual/shared';
import { CostMapService, type CostSweepSession } from './costMap.js';

const REGISTRY: ModelRegistry | null = null; // 패밀리 디폴트 단가로 떨어진다(테스트에 충분).

function turn(over: Partial<TurnTokenUsage> = {}): TurnTokenUsage {
  return {
    turnIndex: 0,
    timestamp: Date.parse('2026-08-20T10:00:00'),
    inputTokens: 1_000,
    outputTokens: 500,
    cacheReadTokens: 10_000,
    cacheCreateTokens: 2_000,
    totalContext: 13_000,
    model: 'claude-sonnet-4-6',
    tools: [],
    ...over,
  };
}

function session(over: Partial<CostSweepSession> = {}): CostSweepSession {
  return {
    sessionId: 'sess-1',
    agentId: 'agent-1',
    subAgentId: 'sub-1',
    label: 'Sub #1',
    cwd: 'C:/work/proj',
    projectName: 'proj',
    ...over,
  };
}

/** 고정 턴 배열을 돌려주는 리더. */
function reader(map: Record<string, TurnTokenUsage[]>) {
  return (_cwd: string, sessionId: string): TurnTokenUsage[] | null => map[sessionId] ?? null;
}

describe('CostMapService — 턴에서 원장으로', () => {
  it('토큰 4종을 나눠 들고 그 턴의 모델 단가로 비용을 낸다', () => {
    const svc = new CostMapService();
    const t = turn();
    svc.sweep([session()], reader({ 'sess-1': [t] }), REGISTRY);

    const map = svc.getSnapshot()[0]!;
    const entry = map.sessions[0]!;
    expect(entry.inputTokens).toBe(1_000);
    expect(entry.outputTokens).toBe(500);
    expect(entry.cacheReadTokens).toBe(10_000);
    expect(entry.cacheCreateTokens).toBe(2_000);
    expect(entry.measured).toBe(true);

    const expected = calculateTokenCost(1_000, 500, 10_000, 2_000, 'claude-sonnet-4-6', REGISTRY).total;
    expect(entry.costUsd).toBeCloseTo(expected, 10);
    // 캐시 읽기를 입력에 합쳐 버렸다면 값이 훨씬 커진다 — 그 회귀를 여기서 잡는다.
    expect(entry.costUsd).toBeLessThan(calculateTokenCost(13_000, 500, 0, 0, 'claude-sonnet-4-6', REGISTRY).total);
  });

  it('같은 턴을 다시 훑어도 두 번 더해지지 않는다', () => {
    const svc = new CostMapService();
    const turns = [turn(), turn({ turnIndex: 1 })];
    const read = reader({ 'sess-1': turns });

    expect(svc.sweep([session()], read, REGISTRY)).toBe(true);
    const first = svc.getSnapshot()[0]!.sessions[0]!.costUsd;

    // 변화 없음 → 갱신 자체가 일어나지 않는다.
    expect(svc.sweep([session()], read, REGISTRY)).toBe(false);
    expect(svc.getSnapshot()[0]!.sessions[0]!.costUsd).toBeCloseTo(first, 10);
  });

  it('턴이 늘면 늘어난 몫만 더한다', () => {
    const svc = new CostMapService();
    const turns = [turn()];
    const read = (_c: string, _s: string): TurnTokenUsage[] => turns;

    svc.sweep([session()], read, REGISTRY);
    const one = svc.getSnapshot()[0]!.sessions[0]!.costUsd;

    turns.push(turn({ turnIndex: 1 }));
    svc.sweep([session()], read, REGISTRY);
    const two = svc.getSnapshot()[0]!.sessions[0]!;

    expect(two.turns).toBe(2);
    expect(two.costUsd).toBeCloseTo(one * 2, 10);
  });

  it('턴 수가 되레 줄면(파일 재작성) 그 세션만 처음부터 다시 센다', () => {
    const svc = new CostMapService();
    let turns = [turn(), turn({ turnIndex: 1 }), turn({ turnIndex: 2 })];
    const read = (_c: string, _s: string): TurnTokenUsage[] => turns;

    svc.sweep([session()], read, REGISTRY);
    const three = svc.getSnapshot()[0]!.sessions[0]!.costUsd;

    turns = [turn()];
    svc.sweep([session()], read, REGISTRY);
    const after = svc.getSnapshot()[0]!.sessions[0]!;
    expect(after.turns).toBe(1);
    expect(after.costUsd).toBeCloseTo(three / 3, 10);
  });

  it('턴을 못 읽은 세션은 0 원이 아니라 측정 없음이다', () => {
    const svc = new CostMapService();
    svc.sweep([session({ sessionId: 'ghost' })], reader({}), REGISTRY);

    const map = svc.getSnapshot()[0]!;
    expect(map.sessions[0]!.measured).toBe(false);
    expect(map.sessions[0]!.costUsd).toBe(0);
    expect(map.measured).toBe(false);
  });
});

describe('CostMapService — 접기(에이전트·날짜·기간)', () => {
  it('에이전트 합은 그 에이전트의 세션들을 접은 값이다', () => {
    const svc = new CostMapService();
    svc.sweep(
      [
        session({ sessionId: 's1', agentId: 'agent-A' }),
        session({ sessionId: 's2', agentId: 'agent-A' }),
        session({ sessionId: 's3', agentId: 'agent-B' }),
      ],
      reader({ s1: [turn()], s2: [turn()], s3: [turn()] }),
      REGISTRY,
    );

    const map = svc.getSnapshot()[0]!;
    const a = map.agents.find((x) => x.agentId === 'agent-A')!;
    const b = map.agents.find((x) => x.agentId === 'agent-B')!;
    expect(a.sessions).toBe(2);
    expect(a.costUsd).toBeCloseTo(b.costUsd * 2, 10);
    // 비용 내림차순 — 배지·표가 같은 순서를 본다.
    expect(map.agents[0]!.agentId).toBe('agent-A');
  });

  it('날짜 버킷과 기간 합계가 로컬 날짜로 갈린다', () => {
    const now = Date.parse('2026-08-20T12:00:00'); // 목요일
    const today = Date.parse('2026-08-20T09:00:00');
    const lastMonth = Date.parse('2026-07-02T09:00:00');

    const svc = new CostMapService();
    svc.sweep(
      [session({ sessionId: 's1' }), session({ sessionId: 's2' })],
      reader({ s1: [turn({ timestamp: today })], s2: [turn({ timestamp: lastMonth })] }),
      REGISTRY,
      now,
    );

    const map = svc.getSnapshot(now)[0]!;
    expect(map.days.map((d) => d.date)).toContain(costDayKey(today));
    expect(map.days.map((d) => d.date)).toContain(costDayKey(lastMonth));
    // 오늘 한 건 · 전체 두 건 — 지난달 몫이 오늘/이번 달에 새어 들지 않는다.
    expect(map.periods.today.costUsd).toBeCloseTo(map.periods.all.costUsd / 2, 10);
    expect(map.periods.month.costUsd).toBeCloseTo(map.periods.today.costUsd, 10);
    // 최신 날짜가 앞에 온다.
    expect(map.days[0]!.date >= map.days[map.days.length - 1]!.date).toBe(true);
  });

  it('스냅샷에는 세션 날짜 분해를 싣지 않고 체크포인트에는 싣는다', () => {
    const svc = new CostMapService();
    svc.sweep([session()], reader({ 'sess-1': [turn()] }), REGISTRY);

    expect(svc.getSnapshot()[0]!.sessions[0]!.days).toBeUndefined();
    expect(svc.toCheckpoint('proj')!.sessions[0]!.days).toBeDefined();
  });
});

describe('CostMapService — 캡·영속', () => {
  it('캡에 밀린 세션의 몫은 retired 로 접혀 전체 합계가 줄지 않는다', () => {
    const svc = new CostMapService();
    const overflow = 5;
    const sessions: CostSweepSession[] = [];
    const turns: Record<string, TurnTokenUsage[]> = {};
    for (let i = 0; i < COST_MAP_SESSIONS_MAX + overflow; i++) {
      const id = `s${i}`;
      sessions.push(session({ sessionId: id }));
      // lastAt 이 서로 다르게 — 오래된 것부터 밀린다.
      turns[id] = [turn({ timestamp: Date.parse('2026-08-20T00:00:00') + i * 1_000 })];
    }
    svc.sweep(sessions, reader(turns), REGISTRY);

    const map = svc.getSnapshot()[0]!;
    expect(map.sessions.length).toBe(COST_MAP_SESSIONS_MAX);
    expect(map.retired).toBeDefined();

    const one = calculateTokenCost(1_000, 500, 10_000, 2_000, 'claude-sonnet-4-6', REGISTRY).total;
    // 전체(all)는 밀려난 몫까지 포함해 원래 세션 수만큼이어야 한다.
    expect(map.periods.all.costUsd).toBeCloseTo(one * (COST_MAP_SESSIONS_MAX + overflow), 6);
  });

  it('체크포인트 왕복으로 원장과 합계가 살아난다', () => {
    const svc = new CostMapService();
    svc.sweep([session()], reader({ 'sess-1': [turn()] }), REGISTRY);
    const cp = svc.toCheckpoint('proj')!;

    const revived = new CostMapService();
    revived.restore(cp);
    const map = revived.getSnapshot()[0]!;
    expect(map.sessions[0]!.sessionId).toBe('sess-1');
    expect(map.periods.all.costUsd).toBeCloseTo(cp.periods.all.costUsd, 10);
    // 날짜 버킷은 세션 분해에서 다시 접히므로 복원 뒤에도 남아 있어야 한다.
    expect(map.days.length).toBe(1);
  });

  it('병합은 세션 id 합집합이고 겹치면 턴을 더 많이 읽은 쪽이 이긴다', () => {
    const a = new CostMapService();
    a.sweep([session({ sessionId: 's1' })], reader({ s1: [turn()] }), REGISTRY);

    const b = new CostMapService();
    b.sweep(
      [session({ sessionId: 's1' }), session({ sessionId: 's2' })],
      reader({ s1: [turn(), turn({ turnIndex: 1 })], s2: [turn()] }),
      REGISTRY,
    );

    a.merge(b.toCheckpoint('proj'));
    const map = a.getSnapshot()[0]!;
    expect(map.sessions.length).toBe(2);
    expect(map.sessions.find((s) => s.sessionId === 's1')!.turns).toBe(2);
  });

  it('옛 체크포인트(costMap 없음)를 복원해도 터지지 않는다', () => {
    const svc = new CostMapService();
    expect(() => svc.restore(undefined)).not.toThrow();
    expect(() => svc.merge(undefined)).not.toThrow();
    expect(svc.getSnapshot()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// §5.21 — "추정" 축. `measured` 와 **직교한다**: 저쪽은 "턴을 못 읽었다", 이쪽은 "턴은 읽었는데
// 그 모델의 단가를 모른다". 새 모델이 나온 직후가 정확히 이 상태이며, 표를 손으로 갱신하기
// 전까지 화면은 금액 옆에 표식을 달아 자릿수를 장담하지 않는다.
// ─────────────────────────────────────────────────────────────────────

describe('CostMapService — 추정 표식', () => {
  it('아는 모델만 쓴 세션에는 깃발이 붙지 않는다', () => {
    const svc = new CostMapService();
    svc.sweep([session()], reader({ 'sess-1': [turn({ model: 'claude-opus-5' })] }), REGISTRY);

    const map = svc.getSnapshot()[0]!;
    expect(map.sessions[0]!.estimated).toBeUndefined();
    expect(map.periods.all.estimated).toBeUndefined();
    expect(map.unseededModels).toBeUndefined();
  });

  it('모르는 모델이 섞이면 세션·에이전트·프로젝트 합이 모두 추정이 된다', () => {
    const svc = new CostMapService();
    svc.sweep(
      [session()],
      reader({ 'sess-1': [turn({ model: 'claude-opus-5' }), turn({ model: 'claude-fable-9' })] }),
      REGISTRY,
    );

    const map = svc.getSnapshot()[0]!;
    expect(map.sessions[0]!.estimated).toBe(true);
    expect(map.agents[0]!.estimated).toBe(true);
    expect(map.periods.all.estimated).toBe(true);
    expect(map.days[0]!.estimated).toBe(true);
  });

  it('미상 모델의 이름을 남긴다 — 무엇을 채워야 하는지까지 말한다', () => {
    const svc = new CostMapService();
    svc.sweep([session()], reader({ 'sess-1': [turn({ model: 'claude-fable-9' })] }), REGISTRY);

    const map = svc.getSnapshot()[0]!;
    expect(map.sessions[0]!.unseededModels).toEqual(['claude-fable-9']);
    expect(map.unseededModels).toEqual(['claude-fable-9']);
  });

  it('0토큰 턴은 추정으로 세지 않는다 — <synthetic> 이 세션을 물들이면 표식이 늑대소년이 된다', () => {
    const svc = new CostMapService();
    const synthetic = turn({
      model: '<synthetic>',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    });
    svc.sweep(
      [session()],
      reader({ 'sess-1': [turn({ model: 'claude-opus-5' }), synthetic] }),
      REGISTRY,
    );

    const map = svc.getSnapshot()[0]!;
    expect(map.sessions[0]!.estimated).toBeUndefined();
    expect(map.sessions[0]!.unseededModels).toBeUndefined();
  });

  it('날짜형 ID 는 시드로 접히므로 추정이 아니다 (실제 대화록에 있는 형태)', () => {
    const svc = new CostMapService();
    svc.sweep([session()], reader({ 'sess-1': [turn({ model: 'claude-haiku-4-5-20251001' })] }), REGISTRY);

    expect(svc.getSnapshot()[0]!.sessions[0]!.estimated).toBeUndefined();
  });

  it('증분 스윕에서도 추정 깃발과 미상 목록이 이어진다', () => {
    const svc = new CostMapService();
    const first = [turn({ model: 'claude-fable-9' })];
    svc.sweep([session()], reader({ 'sess-1': first }), REGISTRY);
    // 두 번째 스윕은 **뒤에 붙은 턴만** 읽는다 — 앞 턴을 다시 안 보므로 깃발이 살아 있어야 한다.
    svc.sweep([session()], reader({ 'sess-1': [...first, turn({ model: 'claude-opus-5' })] }), REGISTRY);

    const entry = svc.getSnapshot()[0]!.sessions[0]!;
    expect(entry.turns).toBe(2);
    expect(entry.estimated).toBe(true);
    expect(entry.unseededModels).toEqual(['claude-fable-9']);
  });

  it('체크포인트 왕복에서 살아남는다 — 껐다 켜면 표식이 사라지면 안 된다', () => {
    const svc = new CostMapService();
    svc.sweep([session()], reader({ 'sess-1': [turn({ model: 'claude-fable-9' })] }), REGISTRY);
    const saved = svc.toCheckpoint('proj')!;

    const restored = new CostMapService();
    restored.restore(saved);
    const map = restored.getSnapshot()[0]!;
    expect(map.sessions[0]!.estimated).toBe(true);
    expect(map.unseededModels).toEqual(['claude-fable-9']);

    const mergedSvc = new CostMapService();
    mergedSvc.merge(saved);
    expect(mergedSvc.getSnapshot()[0]!.sessions[0]!.estimated).toBe(true);
  });

  it('표가 갱신되면 미상 목록에서 그 이름이 빠진다 — 이미 고친 것을 계속 부르지 않는다', () => {
    const svc = new CostMapService();
    svc.sweep([session()], reader({ 'sess-1': [turn({ model: 'claude-fable-9' })] }), REGISTRY);
    expect(svc.getSnapshot()[0]!.unseededModels).toEqual(['claude-fable-9']);

    // 그 모델이 이제 레지스트리에 단가를 갖고 들어왔다(= 표를 채운 것과 같은 상태).
    const filled: ModelRegistry = {
      entries: [{
        id: 'claude-fable-9',
        family: 'fable',
        pricing: { input: 7, output: 35, cacheRead: 0.7, cacheWrite: 8.75 },
        source: 'api',
      }],
      updatedAt: 0,
      sourceMix: 'api-merged',
    };
    svc.sweep([session()], reader({ 'sess-1': [turn({ model: 'claude-fable-9' }), turn()] }), filled);

    const map = svc.getSnapshot()[0]!;
    expect(map.unseededModels).toBeUndefined();
    // 금액 자체는 여전히 추정이다 — 그 돈은 실제로 폴백 단가로 계산됐고, 되돌려 뺄 방법이 없다.
    expect(map.sessions[0]!.estimated).toBe(true);
  });
});
