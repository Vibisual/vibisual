/**
 * (판올림 번호 발급 대기) **누른 색의 여운** — 들어간 순간 색이 꺼져 알아볼 수 없던 것.
 *
 * 실제 사고 재현: [창과 버블] 목록에서 주황 줄을 눌러 그 세션에 들어가면, **서는 그 순간 주황이
 * 걷혔다.** 누름 = 확인이라 `setIDEActiveSession` 이 `acknowledgeUsageLimit` 과
 * `acknowledgedSubAgents` 를 함께 찍기 때문이다(§17-47). 규약으로는 옳지만 화면에서는 누른 색이
 * 도착과 동시에 사라져, 방금 무슨 색을 눌러 들어왔는지 알아볼 수가 없었다(사용자 보고 — "바로
 * idle로 바뀌는게 아니라 한동안 색을 유지해줘야지 … 지금은 알아보기 어려워").
 *
 * 여기서 못 박는 것은 둘이다.
 *  · **표식은 걷고 표시만 남긴다** — 여운은 순수한 화면 층이라 `done` 위에만 덮인다.
 *  · **실제로 무슨 일이 생기면 그쪽이 이긴다** — "10초 안에 액션을 취하면 그 액션 색"이 조건문
 *    하나 없이 성립하는지.
 */
import { describe, expect, it, vi, afterEach, beforeAll } from 'vitest';
import type { SessionRunState } from '@vibisual/shared';

import {
  SESSION_FOCUS_GLOW_MS,
  SESSION_STATUS_DOT,
  SESSION_STATUS_DOT_BG,
  resolveSessionDot,
  sessionDotClass,
  type SessionFocusGlow,
} from './sessionStatus.js';

const NOW = 1_757_000_000_000;

function glow(state: SessionRunState, agoMs = 0): SessionFocusGlow {
  return { state, at: NOW - agoMs };
}

describe('resolveSessionDot — 여운과 실제 상태를 합친다', () => {
  it('자국이 없으면 실제 색 그대로 — 여운은 없던 색을 만들지 않는다', () => {
    expect(resolveSessionDot('done', undefined, NOW)).toEqual({ state: 'done', glowing: false });
    expect(resolveSessionDot('running', undefined, NOW)).toEqual({ state: 'running', glowing: false });
  });

  // 원증상: 주황을 눌러 들어가면 그 자리가 곧바로 회색이 됐다.
  it('조용한 자리는 누른 색이 덮는다 — 주황을 눌러 들어가면 10초간 주황이다', () => {
    expect(resolveSessionDot('done', glow('limited'), NOW)).toEqual({ state: 'limited', glowing: true });
  });

  it('초록(끝났는데 안 봄)도 같다 — 확인으로 회색이 돼도 그 색이 남는다', () => {
    expect(resolveSessionDot('done', glow('doneUnseen'), NOW)).toEqual({ state: 'doneUnseen', glowing: true });
  });

  it('10초가 지나면 여운은 끝난다 — 실제 색으로 돌아간다', () => {
    expect(resolveSessionDot('done', glow('limited', SESSION_FOCUS_GLOW_MS - 1), NOW))
      .toEqual({ state: 'limited', glowing: true });
    expect(resolveSessionDot('done', glow('limited', SESSION_FOCUS_GLOW_MS), NOW))
      .toEqual({ state: 'done', glowing: false });
  });

  // 사용자 지시 — "10초안에 뭔가 액션을 취하면 당연히 그 액션 뭐 파란불이라던가".
  it('여운 중이라도 실제로 일이 생기면 그 색이 이긴다 — 명령을 보내면 파랑', () => {
    expect(resolveSessionDot('running', glow('limited'), NOW))
      .toEqual({ state: 'running', glowing: false });
  });

  it('실패도 여운을 밀어낸다 — 조용하지 않은 자리는 전부 실제가 이긴다', () => {
    expect(resolveSessionDot('error', glow('doneUnseen'), NOW))
      .toEqual({ state: 'error', glowing: false });
  });

  it('누른 색과 실제 색이 같으면 그 색이 뛴다 — 빨강을 눌러도 알아볼 수 있어야 한다', () => {
    expect(resolveSessionDot('error', glow('error'), NOW)).toEqual({ state: 'error', glowing: true });
  });

  it('파랑을 눌러 들어가도 뛴다 — 여운은 평소 뛰는 색에도 자기 몸짓을 입힌다', () => {
    expect(resolveSessionDot('running', glow('running'), NOW))
      .toEqual({ state: 'running', glowing: true });
  });
});

describe('sessionDotClass — 한 요소에 애니메이션은 한 벌뿐', () => {
  it('여운 중에는 색표의 animate-pulse 를 떼고 제 몸짓만 입는다', () => {
    const cls = sessionDotClass('done', glow('limited'), NOW);
    expect(cls).toBe(`${SESSION_STATUS_DOT_BG.limited} animate-session-glow`);
    // 두 벌이 걸리면 CSS 선언 순서가 어느 쪽이 이길지 정해 버린다 — 그 자리를 없앤다.
    expect(cls).not.toContain('animate-pulse');
  });

  it('여운이 아니면 종전 색표 그대로 — 이 함수로 갈아도 화면은 한 픽셀도 안 바뀐다', () => {
    for (const s of ['running', 'error', 'limited', 'doneUnseen', 'done'] as SessionRunState[]) {
      expect(sessionDotClass(s, undefined, NOW)).toBe(SESSION_STATUS_DOT[s]);
    }
  });

  it('종전 색표는 색 + 몸짓의 조합이다 — 도는 것과 멈춘 것만 스스로 뛴다', () => {
    expect(SESSION_STATUS_DOT.running).toBe(`${SESSION_STATUS_DOT_BG.running} animate-pulse`);
    expect(SESSION_STATUS_DOT.limited).toBe(`${SESSION_STATUS_DOT_BG.limited} animate-pulse`);
    expect(SESSION_STATUS_DOT.error).toBe(SESSION_STATUS_DOT_BG.error);
    expect(SESSION_STATUS_DOT.doneUnseen).toBe(SESSION_STATUS_DOT_BG.doneUnseen);
    expect(SESSION_STATUS_DOT.done).toBe(SESSION_STATUS_DOT_BG.done);
  });
});

describe('markSessionFocusGlow — 자국을 찍고 10초 뒤 스스로 걷는다', () => {
  // graphStore 는 모듈 그래프가 커서 **첫 import** 가 무겁다 — 단독으로는 1초가 안 걸리지만
  // `pnpm test` 전체 실행의 부하에서는 시험 몸통의 5초 제한을 넘겨 시간 초과로 떨어졌다.
  // 준비 비용만 넉넉한 제한의 훅으로 옮긴다. 가짜 시계를 거는 시점은 그대로 각 시험 안이고,
  // 스토어는 `setTimeout`·`Date.now()` 를 부르는 순간에 읽으므로 판정은 달라지지 않는다.
  let useGraphStore: typeof import('../stores/graphStore.js').useGraphStore;
  beforeAll(async () => {
    ({ useGraphStore } = await import('../stores/graphStore.js'));
  }, 60_000);

  afterEach(() => {
    vi.useRealTimers();
  });

  it('회색은 찍지 않는다 — 남겨도 화면이 종전과 다르지 않다', () => {
    useGraphStore.getState().markSessionFocusGlow('sub-quiet', 'done');
    expect(useGraphStore.getState().sessionFocusGlow['sub-quiet']).toBeUndefined();
  });

  it('찍은 자국은 10초를 채우고 나서야 걷힌다 — 걷힐 때 스토어가 바뀌어야 화면이 돌아온다', () => {
    vi.useFakeTimers();
    useGraphStore.getState().markSessionFocusGlow('sub-a', 'limited');
    expect(useGraphStore.getState().sessionFocusGlow['sub-a']).toMatchObject({ state: 'limited' });

    vi.advanceTimersByTime(SESSION_FOCUS_GLOW_MS - 1);
    expect(useGraphStore.getState().sessionFocusGlow['sub-a']).toBeDefined();

    vi.advanceTimersByTime(1);
    expect(useGraphStore.getState().sessionFocusGlow['sub-a']).toBeUndefined();
  });

  it('같은 세션을 다시 누르면 시계를 새로 건다 — 옛 예약이 10초를 잘라먹지 않게', () => {
    vi.useFakeTimers();
    useGraphStore.getState().markSessionFocusGlow('sub-b', 'error');
    vi.advanceTimersByTime(SESSION_FOCUS_GLOW_MS - 100);
    useGraphStore.getState().markSessionFocusGlow('sub-b', 'doneUnseen');

    // 첫 예약이 살아 있었다면 여기서 걷혔을 시점.
    vi.advanceTimersByTime(200);
    expect(useGraphStore.getState().sessionFocusGlow['sub-b']).toMatchObject({ state: 'doneUnseen' });

    vi.advanceTimersByTime(SESSION_FOCUS_GLOW_MS);
    expect(useGraphStore.getState().sessionFocusGlow['sub-b']).toBeUndefined();
  });
});
