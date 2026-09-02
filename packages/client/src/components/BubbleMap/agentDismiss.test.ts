import { describe, expect, it } from 'vitest';

import { shouldDismissOnSelect, shouldDismissOnOpen } from './agentDismiss.js';

/**
 * "종료하거나 튕긴 뒤 다시 켜면 버블이 그대로 남는다"(사용자 보고)의 회귀 방지.
 *
 * 재시작하면 살아 있던 세션은 전부 `idle` 로 복원된다(§2.4 재시작 강등). 그런데 확인 dismiss
 * 조건이 `completed`/`error` 뿐이라, **그 잔상을 걷을 클릭이 아예 없었다** — 죽은 세션이
 * 만졌던 파일·폴더 버블이 주인 없이 캔버스에 쌓였다.
 *
 * 함께 잠그는 반대편 둘:
 *  - `active` 는 절대 대상이 아니다(지금 쓰는 세션의 작업 지도를 지우는 일이 된다).
 *  - 더블클릭은 `completed` 에서만 걷는다 — 잔상을 **걷지 않고 열어 보는 손**이 남아야 한다.
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
  it('completed 만 확인으로 친다 (§6 v2.74)', () => {
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
