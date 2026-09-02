/**
 * §9 슬라이스 스코프 — **규칙 자체**(순수 함수)의 회귀 테스트.
 *
 * 규칙 전문은 `shared/src/sliceScope.ts` 머리말이 소유한다. 여기서 못 박는 것은 그 중
 * **어기면 데이터가 사라지는 넷**이다:
 *  ① 아무도 선언하지 않으면 전량이다(침묵은 축소가 아니다).
 *  ② 선언 안 한 창이 하나라도 있으면 합집합이 통째로 전량이 된다.
 *  ③ 뺄 수 없는 슬라이스는 **어떤 선언으로도** 빠지지 않는다.
 *  ④ 범위로 빠진 슬라이스는 받는 쪽에서 **직전 값을 그대로** 이어받는다(`?? {}` 에 닿지 않는다).
 *
 * 규칙 파일은 `@vibisual/shared` 에 있지만 그 패키지에는 러너가 없다 — `keyedSliceDelta.test.ts`
 * 가 그렇듯 서버 스위트에서 함께 돈다.
 */
import { describe, it, expect } from 'vitest';
import {
  SLICE_SCOPE_GROUPS,
  SLICE_SCOPE_GROUP_NAMES,
  SCOPABLE_SLICE_KEYS,
  ALWAYS_SHIPPED_SLICES,
  SLICE_TABLES_ARE_DISJOINT,
  isSliceScopeGroup,
  resolveSliceShipSet,
  stripScopedOutSlices,
  carryForwardScopedSlices,
  type ScopableSliceKey,
  type SliceScopeGroup,
} from '@vibisual/shared';

type Declaration = readonly SliceScopeGroup[] | null;

const ship = (...declarations: Declaration[]): ReadonlySet<ScopableSliceKey> | null =>
  resolveSliceShipSet(declarations);

describe('① 아무도 선언하지 않으면 전량이다', () => {
  it('붙은 창이 없으면 범위 미적용(null)', () => {
    expect(ship()).toBeNull();
  });

  it('빈 배열 선언은 "아무것도 안 읽는다" 라는 **유효한 선언**이다 — 미선언과 다르다', () => {
    const set = ship([]);
    expect(set).not.toBeNull();
    expect([...(set ?? [])]).toEqual([]);
  });
});

describe('② 선언 안 한 창이 하나라도 있으면 합집합이 전량이 된다', () => {
  it('구버전 창(null) 하나가 전체를 되돌린다', () => {
    expect(ship(['ideLane'], null)).toBeNull();
  });

  it('그 창이 빠지면 다시 좁아진다', () => {
    expect(ship(['ideLane'])).not.toBeNull();
  });

  it('창이 여럿이면 합집합이다 — 한 창만 읽어도 실린다', () => {
    const set = ship([], ['pluginAgentData']);
    expect([...(set ?? [])].sort()).toEqual(['agentReports', 'agentReviews']);
  });

  it('IDE 를 연 창이 하나 있으면 그 묶음이 통째로 실린다', () => {
    const set = ship(['ideLane'], []);
    for (const key of SLICE_SCOPE_GROUPS.ideLane) expect(set?.has(key)).toBe(true);
  });
});

describe('③ 뺄 수 없는 슬라이스는 어떤 선언으로도 빠지지 않는다', () => {
  it('두 표는 겹치지 않는다(런타임 판 — 타입 쪽은 SLICE_TABLES_ARE_DISJOINT 가 컴파일에서 막는다)', () => {
    expect(SLICE_TABLES_ARE_DISJOINT).toBe(true);
    const scopable = new Set<string>(SCOPABLE_SLICE_KEYS);
    const overlap = Object.keys(ALWAYS_SHIPPED_SLICES).filter((k) => scopable.has(k));
    expect(overlap, '절대 못 빼는 슬라이스가 뺄 수 있는 표에도 있다: ' + overlap.join(', ')).toEqual([]);
  });

  it('절대 안 빠지는 표의 모든 항목에 근거가 적혀 있다 — 빈 note 는 등재가 아니다', () => {
    const blank = Object.entries(ALWAYS_SHIPPED_SLICES).filter(([, why]) => why.trim().length === 0);
    expect(blank.map(([k]) => k)).toEqual([]);
  });

  it('빈 선언(= 최대로 좁힌 상태)에서도 스코프 대상 밖 필드는 한 개도 안 지워진다', () => {
    const snapshot = {
      // 전역 집계·탭 표시 — §9 ④
      projects: { p: 1 },
      stubProjects: { s: 1 },
      activeAgentCount: 3,
      agentPhase: 'working',
      // 캔버스 골격
      agents: [1],
      topFolders: [2],
      edges: [3],
      nodeProjects: { n: 'p' },
      brainInjections: { a: [1] },
      // 화면이 늘 읽는 것
      auditLogs: [4],
      costMaps: [5],
      agentFeedbacks: { a: [1] },
      // 스코프 대상
      agentReports: { a: [1] },
      sessionGoals: { s: 1 },
    };
    const set = ship([]);
    const { snapshot: out, scopedSlices } = stripScopedOutSlices(snapshot, set ?? new Set());

    expect(scopedSlices).toEqual([]);
    for (const key of Object.keys(ALWAYS_SHIPPED_SLICES)) {
      if (!(key in snapshot)) continue;
      expect(key in out, key + ' 가 스코프에 지워졌다 — 절대 빠지면 안 되는 슬라이스다').toBe(true);
    }
    // 스코프 대상만 빠진다.
    expect('agentReports' in out).toBe(false);
    expect('sessionGoals' in out).toBe(false);
  });

  it('원본 스냅샷은 건드리지 않는다 — 서버가 그 객체를 캐시해 재사용한다', () => {
    const snapshot = { agentReports: { a: [1] }, projects: {} };
    stripScopedOutSlices(snapshot, new Set());
    expect(snapshot.agentReports).toBeDefined();
  });

  it('실은 목록을 그대로 되돌려 준다 — 클라가 "빈 것"과 "아직 안 온 것"을 가르는 유일한 근거', () => {
    const { snapshot, scopedSlices } = stripScopedOutSlices(
      { agentReports: { a: [1] }, agentReviews: { a: [1] }, sessionGoals: { s: 1 } },
      ship(['pluginAgentData']) ?? new Set(),
    );
    expect(scopedSlices.sort()).toEqual(['agentReports', 'agentReviews']);
    expect('sessionGoals' in snapshot).toBe(false);
  });
});

describe('④ 범위로 빠진 슬라이스는 직전 값을 그대로 이어받는다', () => {
  it('안 온 슬라이스가 **직전 참조 그대로** 온다(참조까지 같아야 리렌더가 안 난다)', () => {
    const reports = { a1: ['r1'] };
    const prev = { agentReports: reports, agents: ['old'] };
    const next = { agents: ['new'] } as typeof prev;

    const merged = carryForwardScopedSlices(prev, next, []);

    expect(merged.agentReports).toBe(reports);
    expect(merged.agents).toEqual(['new']);
  });

  it('델타를 안 타는 슬라이스도 이어받는다 — keyedShadow 만으로는 부족한 자리', () => {
    // `verificationRuns` 는 `DELTA_SLICE_KEYS` 에 없다. 클라의 증분 그림자로는 못 메운다.
    const runs = { s1: ['run'] };
    const merged = carryForwardScopedSlices({ verificationRuns: runs }, {} as { verificationRuns: unknown }, []);
    expect(merged.verificationRuns).toBe(runs);
  });

  it('실려서 온 슬라이스는 덮지 않는다 — 새 값이 옛 값에 지워지면 그게 더 큰 사고다', () => {
    const merged = carryForwardScopedSlices(
      { agentReports: { a1: ['old'] } },
      { agentReports: { a1: ['new'] } },
      ['agentReports'],
    );
    expect(merged.agentReports).toEqual({ a1: ['new'] });
  });

  it('서버가 범위를 안 썼으면(구버전 서버·전량) 아무것도 이어받지 않는다 — 지운 값이 되살아나면 안 된다', () => {
    const next = { agents: [] } as { agents: unknown[]; agentReports?: unknown };
    const merged = carryForwardScopedSlices({ agentReports: { a1: ['old'] }, agents: [] }, next, undefined);
    expect(merged).toBe(next);
    expect(merged.agentReports).toBeUndefined();
  });

  it('첫 스냅샷(직전 값 없음)에는 이어받을 것이 없다', () => {
    const next = { agents: [] };
    expect(carryForwardScopedSlices(null, next, [])).toBe(next);
  });

  it('메울 것이 없으면 사본을 만들지 않는다(무변화 프레임에 새 참조를 만들지 않는다)', () => {
    const next = { agentReports: { a: [1] } };
    expect(carryForwardScopedSlices({ agentReports: { a: [1] } }, next, SCOPABLE_SLICE_KEYS)).toBe(next);
  });
});

describe('선언 값의 신뢰 경계', () => {
  it('아는 그룹만 통과한다 — 전선에서 온 값을 그대로 믿지 않는다', () => {
    for (const name of SLICE_SCOPE_GROUP_NAMES) expect(isSliceScopeGroup(name)).toBe(true);
    for (const bogus of ['', 'nope', 'toString', '__proto__', 42, null, undefined, {}]) {
      expect(isSliceScopeGroup(bogus)).toBe(false);
    }
  });

  it('스코프 대상 목록은 그룹 합집합과 정확히 같다 — 목록을 손으로 두 벌 들지 않는다', () => {
    const union = new Set<string>();
    for (const g of SLICE_SCOPE_GROUP_NAMES) for (const k of SLICE_SCOPE_GROUPS[g]) union.add(k);
    expect([...SCOPABLE_SLICE_KEYS].sort()).toEqual([...union].sort());
  });
});
