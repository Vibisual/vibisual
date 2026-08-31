import { describe, it, expect } from 'vitest';
import {
  DETACHED_REDOCK_INSET_PX,
  isCursorDeepInside,
  stepAppEntry,
  type ScreenRect,
} from '@vibisual/shared';

// shared 의 순수 판정 로직은 server 테스트에서 검증한다(pathCase.test.ts·updateDelivery.test.ts 선례).
//
// §5.5 #17-6 (H-4) — 앱 안 IDE 와 독립 창을 **한 손짓 안에서** 오가므로, 되돌아오는 판정이
// 헐거우면 창이 무한히 왕복한다. 창을 띄우지 않고 그 규칙을 여기서 고정한다.

const APP: ScreenRect = { x: 100, y: 100, width: 1000, height: 800 };

describe('isCursorDeepInside — 앱 안으로 "들어왔다"의 문턱', () => {
  it('한가운데는 안이다', () => {
    expect(isCursorDeepInside({ x: 600, y: 500 }, APP)).toBe(true);
  });

  it('네모 밖은 당연히 밖이다', () => {
    expect(isCursorDeepInside({ x: 90, y: 500 }, APP)).toBe(false);
    expect(isCursorDeepInside({ x: 600, y: 1000 }, APP)).toBe(false);
  });

  it('경계 바로 안쪽은 아직 "안"이 아니다 — 가장자리에서 꺼낸 창이 도로 합쳐지지 않게', () => {
    // 왼쪽 경계에서 1px 안쪽 — 네모 안이지만 inset(48px) 을 넘지 못했다.
    expect(isCursorDeepInside({ x: 101, y: 500 }, APP)).toBe(false);
    // 아래 경계에서 1px 위쪽도 같다.
    expect(isCursorDeepInside({ x: 600, y: 899 }, APP)).toBe(false);
  });

  it('inset 만큼 들어오면 그때부터 안이다(네 변 모두)', () => {
    const i = DETACHED_REDOCK_INSET_PX;
    expect(isCursorDeepInside({ x: 100 + i, y: 500 }, APP)).toBe(true);
    expect(isCursorDeepInside({ x: 1100 - i, y: 500 }, APP)).toBe(true);
    expect(isCursorDeepInside({ x: 600, y: 100 + i }, APP)).toBe(true);
    expect(isCursorDeepInside({ x: 600, y: 900 - i }, APP)).toBe(true);
  });

  it('inset 두 배보다 작은 창은 가운데를 문턱으로 삼는다 — 판정이 통째로 사라지지 않게', () => {
    const tiny: ScreenRect = { x: 0, y: 0, width: 40, height: 30 };
    expect(isCursorDeepInside({ x: 20, y: 15 }, tiny)).toBe(true);
    expect(isCursorDeepInside({ x: 60, y: 15 }, tiny)).toBe(false);
  });
});

describe('stepAppEntry — 밖 → 안 **전이**에서만 되돌린다', () => {
  it('밖에 있다 들어오면 그때 한 번만 친다', () => {
    const a = stepAppEntry(false, true);
    expect(a).toEqual({ inside: true, entered: true });
    // 다음 틱에도 안이면 다시 치지 않는다(합치는 일이 두 번 일어나면 안 된다).
    expect(stepAppEntry(a.inside, true)).toEqual({ inside: true, entered: false });
  });

  it('처음부터 앱 위에 겹쳐 있던 창은 밀어도 치지 않는다', () => {
    expect(stepAppEntry(true, true).entered).toBe(false);
  });

  it('나갔다 다시 들어오면 또 친다 — 한 손짓 안에서 몇 번이든 오간다', () => {
    let inside = true;
    expect(stepAppEntry(inside, false).entered).toBe(false);
    inside = false;
    expect(stepAppEntry(inside, true).entered).toBe(true);
  });

  it('밖에 머무는 동안은 조용하다', () => {
    expect(stepAppEntry(false, false)).toEqual({ inside: false, entered: false });
  });
});
