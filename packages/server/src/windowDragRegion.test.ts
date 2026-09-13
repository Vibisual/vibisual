import { describe, it, expect } from 'vitest';
import {
  DETACHED_REDOCK_INSET_PX,
  REDOCK_DWELL_MS,
  isCursorDeepInside,
  isCursorOutsideRect,
  stepAppEntry,
  stepRedockDwell,
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

// (판올림 번호 발급 대기) §5.5 #17-6 (H-8) — **밖으로 나갔다**를 화면 좌표로도 잰다.
//
// 밖에서 끌던 손을 이어받은 판(H-4 ③)은 그 창에서 mousedown 이 일어난 적이 없어 마우스 캡처가
// 없다 — 커서가 창을 벗어나는 순간 렌더러에 이벤트가 끊겨 창 안 좌표로는 이탈을 영영 못 본다
// (사용자 보고 — "되돌린 뒤 다시 밖으로 빼려는데 막힌다"). 그때는 main 이 커서를 대신 보는데,
// 판정이 두 벌이 되면 두 눈이 서로 다른 자리에서 다른 말을 하므로 규칙을 여기 한 곳에 둔다.
describe('isCursorOutsideRect — 앱 밖으로 "나갔다"의 문턱', () => {
  const M = 24; // 렌더러 POP_OUT_MARGIN 과 같은 값

  it('창 안이면 나간 것이 아니다', () => {
    expect(isCursorOutsideRect({ x: 600, y: 500 }, APP, M)).toBe(false);
  });

  it('경계에 딱 붙어 있어도 아직 아니다 — 창을 화면 끝까지 끄는 평범한 손짓', () => {
    expect(isCursorOutsideRect({ x: APP.x + APP.width, y: 500 }, APP, M)).toBe(false);
    expect(isCursorOutsideRect({ x: APP.x, y: 500 }, APP, M)).toBe(false);
    expect(isCursorOutsideRect({ x: 600, y: APP.y }, APP, M)).toBe(false);
    expect(isCursorOutsideRect({ x: 600, y: APP.y + APP.height }, APP, M)).toBe(false);
  });

  it('여백 안까지는 참는다 — 스쳐 지나간 손이 창을 던지지 않게', () => {
    expect(isCursorOutsideRect({ x: APP.x + APP.width + M, y: 500 }, APP, M)).toBe(false);
    expect(isCursorOutsideRect({ x: APP.x + APP.width + M + 1, y: 500 }, APP, M)).toBe(true);
  });

  it('네 방향 어디로 나가도 잡는다', () => {
    expect(isCursorOutsideRect({ x: APP.x - M - 1, y: 500 }, APP, M)).toBe(true);
    expect(isCursorOutsideRect({ x: APP.x + APP.width + M + 1, y: 500 }, APP, M)).toBe(true);
    expect(isCursorOutsideRect({ x: 600, y: APP.y - M - 1 }, APP, M)).toBe(true);
    expect(isCursorOutsideRect({ x: 600, y: APP.y + APP.height + M + 1 }, APP, M)).toBe(true);
  });

  it('되돌리기 문턱과 사이가 넓다 — 한 손짓이 두 판정을 동시에 만족하지 않는다', () => {
    // 나갔다고 읽히는 자리는 "깊숙이 들어왔다"가 될 수 없다(무한 왕복 ❌).
    const out = { x: APP.x + APP.width + M + 1, y: 500 };
    expect(isCursorOutsideRect(out, APP, M)).toBe(true);
    expect(isCursorDeepInside(out, APP, DETACHED_REDOCK_INSET_PX)).toBe(false);
    // 반대도 같다 — 48px 안쪽까지 들어온 손은 "나갔다"로 읽히지 않는다.
    const deep = { x: APP.x + APP.width - DETACHED_REDOCK_INSET_PX, y: 500 };
    expect(isCursorDeepInside(deep, APP, DETACHED_REDOCK_INSET_PX)).toBe(true);
    expect(isCursorOutsideRect(deep, APP, M)).toBe(false);
  });
});

// §5.5 #17-6 (H-12)+(H-17) — **들어오는 길에도 구간이 있다.** 들어온 순간에는 창이 윤곽선으로
// 바뀌기만 하고, 그대로 버티면 그 선이 **밝아진다**(무장). 실제로 합치는 일은 이 함수가 하지
// 않는다 — 손을 뗄 때 `finishOverlayFollow` 한 곳에서만 일어난다(사용자 지시 — "마우스 놓기
// 전까지 가상의 창 그대로 유지해"). 셋(`start`·`cancel`·`arm`)이 한 틱에 겹치면 화면에는 선이
// 뜨자마자 밝아진 것으로만 보여 구간을 만든 뜻이 없어지므로, 그 배타성을 여기서 고정한다.
describe('stepRedockDwell — 들어오기: 선으로 바뀜 · 버팀 · 무장', () => {
  const idle = { wasInside: false, isInside: false, dwelling: false, elapsedMs: 0 };

  it('밖 → 안 전이에서 **선으로 바뀌기만** 한다 — 그 틱에 무장하지 않는다', () => {
    const step = stepRedockDwell({ ...idle, isInside: true });
    expect(step.start).toBe(true);
    expect(step.dwelling).toBe(true);
    expect(step.arm).toBe(false);
    expect(step.cancel).toBe(false);
  });

  it('원래 안에 있던 창은 아무 일도 일어나지 않는다 — (H-4) 의 전이 규칙 그대로', () => {
    const step = stepRedockDwell({ ...idle, wasInside: true, isInside: true });
    expect(step.start).toBe(false);
    expect(step.dwelling).toBe(false);
    expect(step.arm).toBe(false);
  });

  it('버티는 동안은 아직 아무것도 아니다', () => {
    const step = stepRedockDwell({ wasInside: true, isInside: true, dwelling: true, elapsedMs: 10 });
    expect(step.dwelling).toBe(true);
    expect(step.start).toBe(false);
    expect(step.cancel).toBe(false);
    expect(step.arm).toBe(false);
  });

  it('(H-17) 다 버티면 **무장만** 한다 — 가상 창은 그대로 남는다(합치는 것은 뗌의 일)', () => {
    const step = stepRedockDwell({
      wasInside: true, isInside: true, dwelling: true, elapsedMs: REDOCK_DWELL_MS,
    });
    expect(step.arm).toBe(true);
    // 종전에는 여기서 `dwelling` 이 거짓이 되며 그 틱에 합쳐졌다. 이제는 참으로 남아야 한다 —
    //   그 한 비트가 "지금 화면에 있는 것은 가상 창"이고, 뗄 때 합칠지를 그것으로 가른다.
    expect(step.dwelling).toBe(true);
    expect(step.start).toBe(false);
    expect(step.cancel).toBe(false);
  });

  it('(H-17) 무장한 뒤로도 계속 무장으로 남는다 — 다 버틴 손이 멎어 있어도 선이 꺼지지 않게', () => {
    const step = stepRedockDwell({
      wasInside: true, isInside: true, dwelling: true, elapsedMs: REDOCK_DWELL_MS * 10,
    });
    expect(step.arm).toBe(true);
    expect(step.dwelling).toBe(true);
  });

  it('버티다 다시 나가면 **즉시** 풀린다 — (H-3) "가장자리를 떠나면 즉시 풀린다"와 같은 규율', () => {
    const step = stepRedockDwell({
      wasInside: true, isInside: false, dwelling: true, elapsedMs: REDOCK_DWELL_MS + 999,
    });
    expect(step.cancel).toBe(true);
    expect(step.arm).toBe(false);
    expect(step.dwelling).toBe(false);
  });

  it('(H-17) 다 버틴 뒤에 나가도 풀린다 — 무장은 관문이 아니라 표시다', () => {
    const armed = stepRedockDwell({
      wasInside: true, isInside: true, dwelling: true, elapsedMs: REDOCK_DWELL_MS,
    });
    expect(armed.arm).toBe(true);
    const out = stepRedockDwell({
      wasInside: armed.inside, isInside: false, dwelling: armed.dwelling, elapsedMs: REDOCK_DWELL_MS + 16,
    });
    expect(out.cancel).toBe(true);
    expect(out.dwelling).toBe(false);
  });

  it('풀린 뒤 다시 들어오면 **처음부터** 다시 버틴다(반쯤 찬 버팀이 남지 않는다)', () => {
    const out = stepRedockDwell({
      wasInside: true, isInside: false, dwelling: true, elapsedMs: REDOCK_DWELL_MS - 1,
    });
    expect(out.cancel).toBe(true);
    const back = stepRedockDwell({
      wasInside: out.inside, isInside: true, dwelling: out.dwelling, elapsedMs: 0,
    });
    expect(back.start).toBe(true);
    expect(back.arm).toBe(false);
  });

  it('버팀 0 을 넘겨도 최소 한 틱은 무장하지 않은 선으로 서 있는다', () => {
    const start = stepRedockDwell({ ...idle, isInside: true, dwellMs: 0 });
    expect(start.start).toBe(true);
    expect(start.arm).toBe(false);
    // 다음 틱(1ms 경과)에서야 밝아진다.
    expect(stepRedockDwell({
      wasInside: true, isInside: true, dwelling: true, elapsedMs: 1, dwellMs: 0,
    }).arm).toBe(true);
  });

  it('셋은 한 틱에 겹치지 않는다 — 어느 입력을 넣어도', () => {
    for (const wasInside of [false, true]) {
      for (const isInside of [false, true]) {
        for (const dwelling of [false, true]) {
          for (const elapsedMs of [0, REDOCK_DWELL_MS - 1, REDOCK_DWELL_MS, REDOCK_DWELL_MS * 10]) {
            const s = stepRedockDwell({ wasInside, isInside, dwelling, elapsedMs });
            const hot = [s.start, s.cancel, s.arm].filter(Boolean).length;
            expect(hot).toBeLessThanOrEqual(1);
            // 기억은 언제나 지금 실측 그대로 넘어간다(다음 틱이 같은 자리에서 견주게).
            expect(s.inside).toBe(isInside);
            // (H-17) 합치라는 말은 이 함수에서 **나오지 않는다** — 그 판단은 뗌 한 곳의 몫이다.
            expect('commit' in s).toBe(false);
          }
        }
      }
    }
  });

  it('버팀은 사람이 알아볼 만큼 짧다 — 구간은 보여 주기 위한 것이지 관문이 아니다', () => {
    expect(REDOCK_DWELL_MS).toBeGreaterThanOrEqual(200);
    expect(REDOCK_DWELL_MS).toBeLessThanOrEqual(1_000);
  });
});
