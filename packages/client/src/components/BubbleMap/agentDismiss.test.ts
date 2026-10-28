import { describe, expect, it } from 'vitest';

import { shouldDismissOnSelect, shouldDismissOnOpen } from './agentDismiss.js';

/**
 * 재시작 뒤 `idle` 로 복원된 잔상(§2.4 재시작 강등)을 클릭으로 걷을 수 있어야 한다는 회귀.
 * 함께 잠근다: `active` 는 대상 ❌ · 더블클릭은 `completed` 만(걷지 않고 열어 보는 손이 남게).
 */
describe('확인 dismiss 판정 — 싱글 클릭(선택)', () => {
  it('종료·크래시 뒤 남은 idle 잔상을 걷는다', () => {
    expect(shouldDismissOnSelect('idle')).toBe(true);
  });

  it('completed·error 는 종전대로 대상이다', () => {
    expect(shouldDismissOnSelect('completed')).toBe(true);
    expect(shouldDismissOnSelect('error')).toBe(true);
  });

  it('active 는 대상이 아니다', () => {
    expect(shouldDismissOnSelect('active')).toBe(false);
  });

  it('소멸 중이거나 상태를 모르면 건드리지 않는다', () => {
    expect(shouldDismissOnSelect('disappearing')).toBe(false);
    expect(shouldDismissOnSelect(undefined)).toBe(false);
  });
});

describe('확인 dismiss 판정 — 더블클릭(IDE 열기)', () => {
  it('completed 만 확인으로 친다 (§6)', () => {
    expect(shouldDismissOnOpen('completed')).toBe(true);
  });

  it('idle 잔상은 열어 봐도 걷지 않는다 — 싱글 클릭보다 좁다', () => {
    expect(shouldDismissOnOpen('idle')).toBe(false);
    expect(shouldDismissOnSelect('idle')).toBe(true);
  });

  it('active·error 는 열기만 한다', () => {
    expect(shouldDismissOnOpen('active')).toBe(false);
    expect(shouldDismissOnOpen('error')).toBe(false);
  });
});
