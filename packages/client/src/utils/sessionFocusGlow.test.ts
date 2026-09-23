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
import { describe, expect, it, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import type { SessionRunState, SubAgent } from '@vibisual/shared';

import {
  SESSION_ACK_GLOW_MS,
  SESSION_FOCUS_GLOW_MS,
  SESSION_STATUS_DOT,
  SESSION_STATUS_DOT_BG,
  resolveSessionDot,
  sessionDotClass,
  sessionGlowLifespan,
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

/* ────────────────────────────────────────────────────────────────────────────
 * (판올림 번호 발급 대기) **확인한 자리의 5초 여운.**
 *
 * 위 여운은 "내가 **무슨 색**을 눌러 들어왔나"를 알려 주는 것이라 [창과 버블] 목록의 줄에만
 * 찍혔고, 세션 탭은 **일부러** 빠져 있었다("이미 그 탭을 보고 있는 손이라 알려 줄 것이 없다").
 * 그런데 화면에서는 그 자리가 가장 허전했다 — 완료 알림을 보고 들어와 탭을 누르면 초록이
 * **한 프레임 만에** 회색이 되어, 방금 무엇을 확인한 것인지 되짚을 수가 없었다(사용자 지시 —
 * "컴플릿(확인해줘) 이 상태에서 확인하면 회색으로 변하는데 이때 확인 했음을 5초동안 깜빡이게").
 *
 * 그래서 같은 인프라에 **수명**을 열었다. 이 시험이 못 박는 것 셋:
 *  · 확인 여운은 5초를 살고, 누른 색의 10초를 **덮지도 잘라먹지도** 않는다.
 *  · 남길 색이 있는 자리에만 찍힌다(이미 확인됨·도는 중·실패에는 찍을 것이 없다).
 *  · 확인(ack)을 찍는 **두 창구 모두** 이 자국을 지나간다 — 한쪽만 배선하면 "어디서 누르면
 *    깜빡이고 어디서 누르면 안 깜빡이는" 화면이 된다(§2.4 주황불 배선과 같은 규율).
 * ──────────────────────────────────────────────────────────────────────────── */

describe('markSessionAckGlow — 확인해서 회색이 되는 그 자리에 5초를 남긴다', () => {
  let useGraphStore: typeof import('../stores/graphStore.js').useGraphStore;
  beforeAll(async () => {
    ({ useGraphStore } = await import('../stores/graphStore.js'));
  }, 60_000);

  const AGENT = 'agent-ack';
  const ORIGINAL_FETCH = globalThis.fetch;

  // 초록(완료·미확인)은 status==='idle' 이다 — 'completed' 는 판정에서 곧바로 회색으로 간다
  //   (`resolveSessionRunState` — `idle && !acknowledged` 하나만 doneUnseen 이다).
  function sub(id: string, status: 'idle' | 'active' | 'completed' | 'error'): SubAgent {
    return {
      id, sessionId: id, label: id, parentAgentId: AGENT, status,
      createdAt: 0, lastActivityAt: 0,
    };
  }

  function seed(subs: SubAgent[], acked: Record<string, true> = {}): void {
    useGraphStore.setState({
      subAgents: { [AGENT]: subs },
      acknowledgedSubAgents: acked,
      sessionFocusGlow: {},
      runningSubagentTasks: {},
    });
  }

  beforeEach(() => {
    // 확인은 주황불 걷기(서버 왕복)를 함께 부른다 — 시험에서 진짜 fetch 가 나가지 않게 막는다.
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, cleared: [] }) } as unknown as Response)) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.useRealTimers();
  });

  // 원증상: 완료 알림을 보고 들어와 탭을 누르면 초록이 한 프레임 만에 회색이 됐다.
  it('끝났는데 안 본 세션을 확인하면 그 초록이 자국으로 남는다', () => {
    seed([sub('sub-done', 'idle')]);
    useGraphStore.getState().markSessionAckGlow('sub-done');
    expect(useGraphStore.getState().sessionFocusGlow['sub-done'])
      .toMatchObject({ state: 'doneUnseen', ms: SESSION_ACK_GLOW_MS });
  });

  it('그 자국은 5초만 산다 — 누른 색의 10초를 빌려 쓰지 않는다', () => {
    vi.useFakeTimers();
    seed([sub('sub-done', 'idle')]);
    useGraphStore.getState().markSessionAckGlow('sub-done');

    vi.advanceTimersByTime(SESSION_ACK_GLOW_MS - 1);
    expect(useGraphStore.getState().sessionFocusGlow['sub-done']).toBeDefined();

    vi.advanceTimersByTime(1);
    expect(useGraphStore.getState().sessionFocusGlow['sub-done']).toBeUndefined();
  });

  // [창과 버블] 목록의 줄은 제 색으로 10초를 찍은 **직후** 이 확인을 부른다(#17-1).
  it('이미 자국이 있으면 건드리지 않는다 — 10초가 5초로 잘리지 않게', () => {
    vi.useFakeTimers();
    seed([sub('sub-done', 'idle')]);
    useGraphStore.getState().markSessionFocusGlow('sub-done', 'doneUnseen');
    useGraphStore.getState().markSessionAckGlow('sub-done');

    expect(useGraphStore.getState().sessionFocusGlow['sub-done']?.ms).toBeUndefined();
    vi.advanceTimersByTime(SESSION_ACK_GLOW_MS + 100);
    expect(useGraphStore.getState().sessionFocusGlow['sub-done']).toBeDefined();
    vi.advanceTimersByTime(SESSION_FOCUS_GLOW_MS);
    expect(useGraphStore.getState().sessionFocusGlow['sub-done']).toBeUndefined();
  });

  it('이미 확인된 세션에는 찍지 않는다 — 본문 클릭·타이핑이 같은 세션에 수없이 들어온다', () => {
    seed([sub('sub-done', 'idle')], { 'sub-done': true });
    useGraphStore.getState().markSessionAckGlow('sub-done');
    expect(useGraphStore.getState().sessionFocusGlow['sub-done']).toBeUndefined();
  });

  it('도는 세션·실패한 세션에는 찍지 않는다 — 확인해도 그 색은 걷히지 않는다', () => {
    seed([sub('sub-run', 'active'), sub('sub-err', 'error')]);
    useGraphStore.getState().markSessionAckGlow('sub-run');
    useGraphStore.getState().markSessionAckGlow('sub-err');
    expect(useGraphStore.getState().sessionFocusGlow['sub-run']).toBeUndefined();
    expect(useGraphStore.getState().sessionFocusGlow['sub-err']).toBeUndefined();
  });

  it('없는 세션을 확인해도 조용히 지나간다', () => {
    seed([sub('sub-done', 'idle')]);
    useGraphStore.getState().markSessionAckGlow('sub-ghost');
    expect(useGraphStore.getState().sessionFocusGlow['sub-ghost']).toBeUndefined();
  });

  // 배선 — 확인을 찍는 창구는 둘이고, 둘 다 이 자국을 지나가야 한다.
  it('본문 클릭·타이핑(markSubAcknowledged)도 자국을 남긴다', () => {
    seed([sub('sub-done', 'idle')]);
    useGraphStore.getState().markSubAcknowledged('sub-done');
    expect(useGraphStore.getState().sessionFocusGlow['sub-done'])
      .toMatchObject({ state: 'doneUnseen', ms: SESSION_ACK_GLOW_MS });
    // 확인 자체는 종전 그대로 찍힌다(여운은 표시 층일 뿐 표식을 붙잡지 않는다).
    expect(useGraphStore.getState().acknowledgedSubAgents['sub-done']).toBe(true);
  });

  it('세션을 앞으로 세우는 길(setIDEActiveSession)도 자국을 남긴다', () => {
    seed([sub('sub-done', 'idle')]);
    useGraphStore.getState().setIDEActiveSession('sub-done', null);
    expect(useGraphStore.getState().sessionFocusGlow['sub-done'])
      .toMatchObject({ state: 'doneUnseen', ms: SESSION_ACK_GLOW_MS });
  });
});

describe('확인 여운의 몸짓 — 5초짜리는 5번 뛴다', () => {
  it('수명은 자국이 정한다 — 담긴 값이 없으면 기본 10초', () => {
    expect(sessionGlowLifespan({ state: 'doneUnseen', at: NOW })).toBe(SESSION_FOCUS_GLOW_MS);
    expect(sessionGlowLifespan({ state: 'doneUnseen', at: NOW, ms: SESSION_ACK_GLOW_MS }))
      .toBe(SESSION_ACK_GLOW_MS);
  });

  // 한 요소에 animation 은 한 벌뿐이다 — 길이가 다르면 유틸리티도 달라야 한다.
  it('확인 여운은 짧은 몸짓을, 누른 색은 종전 몸짓을 입는다', () => {
    const ack: SessionFocusGlow = { state: 'doneUnseen', at: NOW, ms: SESSION_ACK_GLOW_MS };
    expect(sessionDotClass('done', ack, NOW))
      .toBe(`${SESSION_STATUS_DOT_BG.doneUnseen} animate-session-glow-brief`);
    expect(sessionDotClass('done', glow('doneUnseen'), NOW))
      .toBe(`${SESSION_STATUS_DOT_BG.doneUnseen} animate-session-glow`);
  });

  it('5초가 지나면 그림도 제 색으로 — 타이머를 놓친 프레임이 옛 색을 그리지 않게', () => {
    const ack: SessionFocusGlow = { state: 'doneUnseen', at: NOW - SESSION_ACK_GLOW_MS, ms: SESSION_ACK_GLOW_MS };
    expect(resolveSessionDot('done', ack, NOW)).toEqual({ state: 'done', glowing: false });
  });

  it('5초 안에 명령이 나가면 그 색이 이긴다 — 여운은 조용한 자리만 덮는다', () => {
    const ack: SessionFocusGlow = { state: 'doneUnseen', at: NOW, ms: SESSION_ACK_GLOW_MS };
    expect(resolveSessionDot('running', ack, NOW)).toEqual({ state: 'running', glowing: false });
  });
});
