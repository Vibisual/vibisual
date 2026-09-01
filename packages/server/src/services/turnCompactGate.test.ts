import { describe, expect, it } from 'vitest';
import {
  autoCompactThresholdTokens,
  turnCompactTriggerTokens,
  shouldCompactAfterTurn,
  resolveAutoCompact,
  TURN_COMPACT_TRIGGER_RATIO,
  DEFAULT_AUTOCOMPACT_TOKENS,
} from '@vibisual/shared';

/**
 * §4 (CLI 사양 추종) — 턴 경계 압축의 **발동 판정**. 손잡이는 자동 압축 값 하나뿐이다.
 *
 * 사용자 보고 둘이 이 파일에 고정돼 있다.
 *  1. "턴 끝나고" 가 매 턴이었다 — 짧은 대화까지 요약으로 접혀 세부가 사라지고, `/compact` 자체가
 *     요약 1회 호출이라 턴마다 토큰과 한도를 먹었다.
 *  2. 고쳐 놓고 보니 **체크박스와 드롭다운이 같은 일**이었고, 같은 숫자를 쓰는 한 CLI 가 늘 먼저
 *     접어 체크박스가 아예 뜨지 못했다. 그래서 하나로 합치고 우리 선을 한 단 낮췄다.
 */
describe('autoCompactThresholdTokens — CLI 에게 넘어가는 창 크기', () => {
  it('숫자 문자열은 그대로 토큰 수', () => {
    expect(autoCompactThresholdTokens('400000')).toBe(400000);
    expect(autoCompactThresholdTokens('100000')).toBe(100000);
  });

  it("'auto' 는 숫자가 아니므로 그 모델의 창 크기를 쓴다", () => {
    expect(autoCompactThresholdTokens('auto', 1_000_000)).toBe(1_000_000);
  });

  it("'auto' 인데 창 크기를 모르면 판정 불가(null)", () => {
    expect(autoCompactThresholdTokens('auto')).toBeNull();
    expect(autoCompactThresholdTokens('auto', 0)).toBeNull();
  });
});

describe('turnCompactTriggerTokens — 우리가 턴 경계에서 접는 선', () => {
  it('창 크기보다 **낮다** — 같으면 CLI 가 먼저 접어 우리 차례가 오지 않는다', () => {
    const trigger = turnCompactTriggerTokens('400000');
    expect(trigger).not.toBeNull();
    expect(trigger!).toBeLessThan(400_000);
    expect(trigger).toBe(Math.round(400_000 * TURN_COMPACT_TRIGGER_RATIO));
  });

  it('기본 400k 설정에서 320k', () => {
    expect(turnCompactTriggerTokens(DEFAULT_AUTOCOMPACT_TOKENS)).toBe(320_000);
  });

  it("'auto' 는 모델 창에서 같은 비율로 파생된다", () => {
    expect(turnCompactTriggerTokens('auto', 1_000_000)).toBe(800_000);
    expect(turnCompactTriggerTokens('auto')).toBeNull();
  });

  it('비율은 1 미만이어야 한다 — 이 상수가 1 이 되면 기능이 통째로 죽는다', () => {
    expect(TURN_COMPACT_TRIGGER_RATIO).toBeGreaterThan(0);
    expect(TURN_COMPACT_TRIGGER_RATIO).toBeLessThan(1);
  });
});

describe('shouldCompactAfterTurn', () => {
  it('발동선 미만이면 접지 않는다 — 이것이 "매 턴" 을 끝낸 줄이다', () => {
    expect(shouldCompactAfterTurn({ requested: false, autoCompact: '400000', contextUsed: 319_999 })).toBe(false);
    expect(shouldCompactAfterTurn({ requested: false, autoCompact: '400000', contextUsed: 1_000 })).toBe(false);
  });

  it('발동선에 닿으면 접는다 — 창 크기(400k)가 아니라 320k 다', () => {
    expect(shouldCompactAfterTurn({ requested: false, autoCompact: '400000', contextUsed: 320_000 })).toBe(true);
    expect(shouldCompactAfterTurn({ requested: false, autoCompact: '400000', contextUsed: 390_000 })).toBe(true);
  });

  it('켜고 끄는 스위치가 없다 — 값을 고른 것만으로 발동한다(합쳐진 축)', () => {
    // 종전에는 `compactAfterTurn: true` 가 있어야 참이었다. 이제 그 입력 자체가 없다.
    expect(shouldCompactAfterTurn({ requested: false, contextUsed: 330_000 })).toBe(true);
  });

  it('에이전트가 요청했으면 발동선을 묻지 않는다(판단을 맡긴 축)', () => {
    expect(shouldCompactAfterTurn({ requested: true, autoCompact: '400000', contextUsed: 1_000 })).toBe(true);
    // 컨텍스트를 아예 못 재도 요청은 통과한다.
    expect(shouldCompactAfterTurn({ requested: true })).toBe(true);
  });

  it('컨텍스트를 못 재면 접지 않는다 — 모르는 채로 쏘면 종전의 매 턴 압축이다', () => {
    expect(shouldCompactAfterTurn({ requested: false, autoCompact: '400000' })).toBe(false);
    expect(shouldCompactAfterTurn({ requested: false, autoCompact: '400000', contextUsed: 0 })).toBe(false);
  });

  it('에이전트가 미설정이면 설정 창 전역값에서 발동선이 나온다', () => {
    const base = { requested: false, contextUsed: 170_000 } as const;
    expect(shouldCompactAfterTurn({ ...base, userAutoCompact: '200000' })).toBe(true);  // 선 160k
    expect(shouldCompactAfterTurn({ ...base, userAutoCompact: '400000' })).toBe(false); // 선 320k
  });

  it('양쪽 다 미설정이면 내장 기본(400k → 320k)이 발동선이다', () => {
    expect(resolveAutoCompact(undefined, undefined)).toBe(DEFAULT_AUTOCOMPACT_TOKENS);
    expect(shouldCompactAfterTurn({ requested: false, contextUsed: 319_000 })).toBe(false);
    expect(shouldCompactAfterTurn({ requested: false, contextUsed: 321_000 })).toBe(true);
  });

  it("'auto' 는 모델 창의 비율을 넘겨야 접는다 — 창을 모르면 접지 않는다", () => {
    const base = { requested: false, autoCompact: 'auto' } as const;
    expect(shouldCompactAfterTurn({ ...base, contextUsed: 700_000, contextMax: 1_000_000 })).toBe(false);
    expect(shouldCompactAfterTurn({ ...base, contextUsed: 800_000, contextMax: 1_000_000 })).toBe(true);
    expect(shouldCompactAfterTurn({ ...base, contextUsed: 900_000 })).toBe(false);
  });

  it('범위 밖 저장분은 내장 기본으로 떨어진다(CLI 가 거부하는 값을 발동선으로 쓰지 않는다)', () => {
    // resolveAutoCompact 가 목록 밖 값을 버리므로 선은 50k*0.8 이 아니라 320k 다.
    expect(shouldCompactAfterTurn({ requested: false, autoCompact: '50000', contextUsed: 60_000 })).toBe(false);
  });
});
