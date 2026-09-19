import { describe, expect, it } from 'vitest';

import type { SubAgentStreamEvent } from '@vibisual/shared';
import { hasRecentEventId, RECENT_EVENT_ID_SCAN, spliceMissingInServerOrder } from './streamGapFill.js';

/**
 * 재연결 뒤 서버 창을 버퍼에 **제자리로** 끼우는 규칙을 못 박는다.
 *
 * 폰 화면을 끈 사이 끊긴 줄은 다시 붙은 뒤 서버에서 다시 받아 온다. 그 줄이 버퍼 끝에 붙으면 다시 붙은 뒤에
 * 온 줄보다 아래에 그려져 글이 뒤섞이고, 끊겨 있던 사이가 빈 채로 남으면 글이 중간에서 끊긴 것처럼 읽힌다.
 */

function evt(n: number): SubAgentStreamEvent {
  return {
    id: `e-${n}`,
    subAgentId: 'sub',
    parentAgentId: 'agent',
    timestamp: 1_700_000_000_000 + n,
    eventType: 'text',
    content: `line ${n}`,
  };
}

function range(from: number, to: number): SubAgentStreamEvent[] {
  const out: SubAgentStreamEvent[] = [];
  for (let n = from; n <= to; n++) out.push(evt(n));
  return out;
}

const ids = (events: readonly SubAgentStreamEvent[] | null): string[] => (events ?? []).map((e) => e.id);

describe('spliceMissingInServerOrder — 끊겨 있던 사이를 제자리에', () => {
  it('가운데 빈 줄을 끊기기 전 줄 바로 뒤에 끼운다', () => {
    // 끊기기 전 0~4 → 다시 붙은 뒤 10~12. 서버는 0~12 를 다 갖고 있다.
    const prev = [...range(0, 4), ...range(10, 12)];
    const out = spliceMissingInServerOrder(prev, range(0, 12));
    expect(ids(out)).toEqual(ids(range(0, 12)));
  });

  it('서버 창이 버퍼보다 뒤에서 시작해도 앞의 줄은 그대로 두고 가운데만 메운다', () => {
    // 버퍼는 깊은 창(0~) · 서버는 얕은 창(3~). 버퍼 앞부분은 줄지 않는다.
    const prev = [...range(0, 5), ...range(9, 11)];
    const out = spliceMissingInServerOrder(prev, range(3, 11));
    expect(ids(out)).toEqual(ids(range(0, 11)));
  });

  it('서버 창 머리의 빠진 줄은 버퍼와 겹치는 첫 줄 앞에 선다', () => {
    const prev = range(5, 8);
    const out = spliceMissingInServerOrder(prev, range(2, 8));
    expect(ids(out)).toEqual(ids(range(2, 8)));
  });

  it('겹치는 줄이 전혀 없으면 버퍼 끝에 붙인다', () => {
    const prev = range(0, 2);
    const out = spliceMissingInServerOrder(prev, range(10, 11));
    expect(ids(out)).toEqual(ids([...range(0, 2), ...range(10, 11)]));
  });

  it('버퍼에 이미 다 있으면 null — 호출부가 버퍼를 그대로 둔다', () => {
    const prev = range(0, 9);
    expect(spliceMissingInServerOrder(prev, range(3, 9))).toBeNull();
  });

  it('버퍼에만 있는 줄(요청이 오가는 사이 WS 로 온 꼬리)은 빼거나 옮기지 않는다', () => {
    const prev = [...range(0, 2), ...range(6, 9)];
    const out = spliceMissingInServerOrder(prev, range(0, 7));
    expect(ids(out)).toEqual(ids(range(0, 9)));
  });

  it('서버 창이 같은 줄을 두 번 실어 와도 한 번만 끼운다', () => {
    const prev = [evt(0), evt(3)];
    const out = spliceMissingInServerOrder(prev, [evt(0), evt(1), evt(1), evt(2), evt(3)]);
    expect(ids(out)).toEqual(ids(range(0, 3)));
  });

  it('빈 틈이 여럿이어도 각자 제자리에 선다', () => {
    const prev = [evt(0), evt(3), evt(6)];
    const out = spliceMissingInServerOrder(prev, range(0, 7));
    expect(ids(out)).toEqual(ids(range(0, 7)));
  });

  it('입력 배열을 고치지 않는다', () => {
    const prev = [evt(0), evt(2)];
    const before = ids(prev);
    spliceMissingInServerOrder(prev, range(0, 2));
    expect(ids(prev)).toEqual(before);
  });
});

describe('hasRecentEventId — 겹쳐 온 라이브 줄 거르기', () => {
  it('버퍼 끝 가까이 있는 id 를 찾는다', () => {
    const buf = range(0, 9);
    expect(hasRecentEventId(buf, 'e-9')).toBe(true);
    expect(hasRecentEventId(buf, 'e-0')).toBe(true);
    expect(hasRecentEventId(buf, 'e-10')).toBe(false);
  });

  it('빈 버퍼에서는 없다', () => {
    expect(hasRecentEventId([], 'e-0')).toBe(false);
  });

  it(`끝에서 ${RECENT_EVENT_ID_SCAN} 칸만 본다 — 긴 버퍼를 매 줄마다 다 훑지 않는다`, () => {
    const buf = range(0, RECENT_EVENT_ID_SCAN + 9);
    expect(hasRecentEventId(buf, `e-${RECENT_EVENT_ID_SCAN + 9}`)).toBe(true);
    expect(hasRecentEventId(buf, 'e-10')).toBe(true);
    expect(hasRecentEventId(buf, 'e-9')).toBe(false);
  });
});
