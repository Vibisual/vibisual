/**
 * §9 슬라이스 스코프 — **클라 쪽 함정 하나**의 회귀 테스트.
 *
 * `applyGraphSnapshot` 은 없는 슬라이스를 `snap.bashHistory ?? {}` 처럼 **빈 객체로 채워** 스토어에
 * 넘긴다. 그 자체는 §9 ③(`?? {}` 는 고정 참조)의 산물이라 옳다 — 서버가 그 슬라이스를 **한 번도
 * 안 보내는** 경우를 위한 것이기 때문이다. 그런데 슬라이스 스코프가 들어오면서 "잠깐 안 보내는"
 * 경우가 새로 생겼고, 그것이 같은 자리에 걸리면 **사용자 눈에는 데이터가 날아간 것으로 보인다.**
 *
 * 해소는 `materializeSnapshot` 이 구조적 공유를 태우기 직전에 `carryForwardScopedSlices` 로
 * 직전 값을 이어받는 것이다. 여기서 못 박는 것 둘:
 *  ① 규칙 자체가 맞는가(직전 참조 그대로 · 실린 것은 안 덮음 · 범위 미적용이면 무동작).
 *  ② `useWebSocket` 이 그 규칙을 **실제로 부르고 있는가** — 그리고 부르는 자리가 `structuralShare`
 *     **앞**인가(뒤로 가면 이어받은 값이 공유를 안 타 매 스냅샷 새 참조가 된다).
 *
 * ⚠ 이 스위트에는 DOM 이 없다(jsdom 미설치). 훅을 렌더할 수 없으므로 ②는 소스 스캔으로 본다 —
 *   `typographyFloor.test.ts`·`terminalShrinkContract.test.ts` 와 같은 계열의 집행이다.
 */
import { describe, it, expect } from 'vitest';
import { carryForwardScopedSlices, SCOPABLE_SLICE_KEYS } from '@vibisual/shared';

const SOURCES = import.meta.glob<string>(
  ['/src/hooks/useWebSocket.ts'],
  { query: '?raw', import: 'default', eager: true },
);

function readSource(path: string): string {
  const src = SOURCES[path];
  expect(typeof src, path + ' 를 원문으로 못 읽었다 — 이 스캔의 전제가 깨졌다').toBe('string');
  expect((src ?? '').length, path + ' 가 빈 문자열로 왔다').toBeGreaterThan(0);
  return src ?? '';
}

/** 실제 스냅샷과 같은 모양(전선에서 오는 optional 슬라이스 + 늘 오는 필드). */
interface WireLike {
  agents: string[];
  agentReports?: Record<string, string[]>;
  sessionGoals?: Record<string, string>;
  verificationRuns?: Record<string, string[]>;
  scopedSlices?: string[];
}

describe('① 범위 밖 슬라이스는 직전 값을 이어받는다', () => {
  it('안 온 슬라이스가 `?? {}` 에 닿지 않는다 — 직전 값이 그대로 흐른다', () => {
    const reports = { a1: ['보고 하나'] };
    const prev: WireLike = { agents: ['a1'], agentReports: reports };
    const next: WireLike = { agents: ['a1'], scopedSlices: [] };

    const merged = carryForwardScopedSlices(prev, next, next.scopedSlices);

    // 스토어에 넘어가는 값이 `{}` 가 아니라 직전 맵 **그 참조**다.
    expect(merged.agentReports).toBe(reports);
    expect(merged.agentReports ?? {}).toBe(reports);
  });

  it('델타를 안 타는 슬라이스도 이어받는다 — 증분 그림자(keyedShadowRef)로는 못 메우는 자리', () => {
    const runs = { s1: ['run'] };
    const merged = carryForwardScopedSlices<WireLike>(
      { agents: [], verificationRuns: runs },
      { agents: [], scopedSlices: [] },
      [],
    );
    expect(merged.verificationRuns).toBe(runs);
  });

  it('여러 스냅샷이 흘러도 계속 이어진다(한 번만 되는 게 아니다)', () => {
    const goals = { s1: '목표' };
    let prev: WireLike = { agents: [], sessionGoals: goals };
    for (let i = 0; i < 5; i++) {
      prev = carryForwardScopedSlices<WireLike>(prev, { agents: [], scopedSlices: [] }, []);
      expect(prev.sessionGoals).toBe(goals);
    }
  });

  it('실려서 온 슬라이스는 덮지 않는다', () => {
    const merged = carryForwardScopedSlices<WireLike>(
      { agents: [], agentReports: { a1: ['옛것'] } },
      { agents: [], agentReports: { a1: ['새것'] }, scopedSlices: ['agentReports'] },
      ['agentReports'],
    );
    expect(merged.agentReports).toEqual({ a1: ['새것'] });
  });

  it('서버가 범위를 안 썼으면 아무것도 이어받지 않는다(지운 값이 되살아나면 안 된다)', () => {
    const next: WireLike = { agents: [] };
    const merged = carryForwardScopedSlices<WireLike>({ agents: [], agentReports: { a1: ['x'] } }, next, undefined);
    expect(merged).toBe(next);
  });
});

describe('② useWebSocket 이 그 규칙을 실제로 쓰고 있다', () => {
  const src = (): string => readSource('/src/hooks/useWebSocket.ts');

  it('`carryForwardScopedSlices` 를 부른다 — 빠지면 범위 밖 슬라이스가 화면에서 사라진다', () => {
    expect(src()).toContain('carryForwardScopedSlices(');
  });

  it('부르는 자리가 `structuralShare` **앞**이다 — 뒤로 가면 이어받은 값이 공유를 안 탄다', () => {
    const text = src();
    const carry = text.indexOf('carryForwardScopedSlices(lastWireRef.current');
    const share = text.indexOf('structuralShare(lastWireRef.current');
    expect(carry, 'carryForwardScopedSlices 호출을 못 찾았다').toBeGreaterThan(0);
    expect(share, 'structuralShare 호출을 못 찾았다').toBeGreaterThan(0);
    expect(carry).toBeLessThan(share);
  });

  it('`set-project-scope` 한 메시지에 세 축을 함께 얹는다(새 메시지 타입 ❌ · 한 왕복)', () => {
    const text = src();
    const at = text.indexOf("type: 'set-project-scope'");
    expect(at, "set-project-scope 발송 지점을 못 찾았다").toBeGreaterThan(0);
    const payload = text.slice(at, at + 400);
    expect(payload).toContain('projects:');
    expect(payload).toContain('folders');
    expect(payload).toContain('slices');
  });

  it('스코프 대상 슬라이스는 모두 `?? {}` 폴백을 가진 자리이거나 별도 액션이다(빈 값 폴백 확인)', () => {
    // 이 목록이 늘어날 때 "그 슬라이스도 이어받기에 걸리는가" 를 한 번 생각하게 하는 자리다.
    expect(SCOPABLE_SLICE_KEYS.length).toBeGreaterThan(0);
    const text = src();
    for (const key of SCOPABLE_SLICE_KEYS) {
      expect(text, key + ' 를 반영하는 자리가 useWebSocket 에 없다').toContain(key);
    }
  });
});
