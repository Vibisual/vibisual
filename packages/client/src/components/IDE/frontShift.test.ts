import { describe, it, expect } from 'vitest';
import { countRemovedFromFront, advanceFrontShift, shiftAroundView, type FrontShiftState } from './frontShift.js';

/**
 * 가상 리스트 앞쪽 절단(shift) 카운트 회귀 테스트 (v3.13).
 * 재현하는 핵심 버그: 긴 세션에서 스트림 버퍼가 상한을 넘어 앞쪽이 일괄 절단되면, virtuoso 의 인덱스 기반
 * 측정 모델이 통째로 밀려 스크롤이 "위로 말려 올라갔다". countRemovedFromFront 가 제거 수를 정확히 세어
 * firstItemIndex 로 신고해야 virtuoso 가 shift 보정을 한다.
 */
const ids = (...xs: string[]): string[] => xs;

describe('countRemovedFromFront', () => {
  it('변화 없음 / 순수 append 는 0 — shift 아님', () => {
    expect(countRemovedFromFront(ids('a', 'b'), ids('a', 'b'))).toBe(0);
    expect(countRemovedFromFront(ids('a', 'b'), ids('a', 'b', 'c'))).toBe(0);
  });

  it('[회귀] 버퍼 앞쪽 절단 — 선두 K개가 사라지면 K 를 반환한다', () => {
    expect(countRemovedFromFront(ids('a', 'b', 'c', 'd'), ids('c', 'd'))).toBe(2);
    expect(countRemovedFromFront(ids('a', 'b', 'c', 'd'), ids('c', 'd', 'e', 'f'))).toBe(2);
  });

  it('부분 절단으로 첫 항목 id 가 바뀐 경우(옛 id 소멸)도 함께 센다', () => {
    // a,b 절단 + c 가 반토막나 c2 로 재생성 → 옛 선두 a,b,c 세 개가 새 리스트에 없음.
    expect(countRemovedFromFront(ids('a', 'b', 'c', 'd'), ids('c2', 'd', 'e'))).toBe(3);
  });

  it('전량 교체(교집합 0 — 리하이드레이트)는 shift 가 아니다 → 0', () => {
    expect(countRemovedFromFront(ids('a', 'b', 'c'), ids('x', 'y'))).toBe(0);
  });

  it('빈 목록 경계 — 첫 렌더/전부 비움은 0', () => {
    expect(countRemovedFromFront(ids(), ids('a'))).toBe(0);
    expect(countRemovedFromFront(ids('a'), ids())).toBe(0);
  });

  it('중간/끝 제거는 세지 않는다(선두 연속 소멸만 shift)', () => {
    expect(countRemovedFromFront(ids('a', 'b', 'c'), ids('a', 'c'))).toBe(0);
  });
});

/**
 * §5.5 #17-12 — 표시 밀도 전환은 선두 항목의 id 를 통째로 갈아치운다(`e1` → `toolgroup-e1`).
 * 그걸 절단으로 오인하면 있지도 않은 제거분만큼 스크롤이 보정돼 화면이 튄다 — resetKey 로 그 렌더만 건너뛴다.
 */
describe('advanceFrontShift — 밀도 전환(resetKey)', () => {
  const start = (items: string[], key?: string): FrontShiftState => ({ base: 0, prevIds: items, prevKey: key });

  it('[회귀] resetKey 가 바뀐 렌더는 선두 id 가 전부 갈려도 shift 를 더하지 않는다', () => {
    let st = start(['a', 'b', 'c', 'd'], 'standard');
    // 밀도 전환 — 앞쪽 두 항목이 묶음 하나로 바뀐다(옛 id 소멸).
    st = advanceFrontShift(st, ['group-a', 'c', 'd'], 'compact');
    expect(st.base).toBe(0);
    // 전환 이후의 진짜 앞쪽 절단은 그대로 잡힌다.
    st = advanceFrontShift(st, ['c', 'd'], 'compact');
    expect(st.base).toBe(1);
  });

  it('키가 그대로면 종전처럼 앞쪽 절단을 누적한다', () => {
    let st = start(['a', 'b', 'c', 'd'], 'standard');
    st = advanceFrontShift(st, ['c', 'd'], 'standard');
    expect(st.base).toBe(2);
    st = advanceFrontShift(st, ['d'], 'standard');
    expect(st.base).toBe(3);
  });

  it('키를 쓰지 않는 호출부(undefined 고정)는 종전 동작 그대로다', () => {
    let st: FrontShiftState = { base: 0, prevIds: ['a', 'b', 'c'] };
    st = advanceFrontShift(st, ['b', 'c']);
    expect(st.base).toBe(1);
  });
});

/**
 * §5.5 #17-12 — 복원 창 위쪽 과거를 불러와 **앞에 붙이면** 기준값을 그만큼 줄여 신고해야 보던 줄이 제자리에 남는다.
 * 붙는 자리는 맨 앞이 아닐 수 있다 — 창 밖 턴의 명령 블록(저장된 답 폴백)이 맨 위에 서 있고 과거는 그 사이로 끼어든다.
 */
describe('shiftAroundView — 보고 있는 자리 기준 신고', () => {
  it('꼬리에만 붙는 스트리밍은 0 — 색인을 만들지 않는 빠른 길', () => {
    expect(shiftAroundView(ids('a', 'b', 'c'), ids('a', 'b', 'c', 'd'), 1)).toBe(0);
  });

  it('맨 앞에 K개가 붙으면 +K', () => {
    expect(shiftAroundView(ids('c', 'd', 'e'), ids('a', 'b', 'c', 'd', 'e'), 1)).toBe(2);
  });

  it('[회귀] 맨 위 폴백 명령 블록 사이로 끼어들어도 보는 자리 앞의 증가분을 센다', () => {
    // 창 밖 턴 cmd-1·cmd-2 는 저장된 답으로만 서 있다가, 과거를 불러오자 그 턴의 본문(t2a·t2b)이 사이에 들어온다.
    const prev = ids('cmd-1', 'cmd-2', 'cmd-3', 'x1', 'x2', 'x3');
    const next = ids('cmd-1', 'cmd-2', 't2a', 't2b', 'cmd-3', 'x1', 'x2', 'x3');
    // 맨 앞 기준(종전)으로는 0 — 화면이 불러온 분량만큼 튄다.
    expect(countRemovedFromFront(prev, next)).toBe(0);
    // 그려져 있던 첫 항목(x1) 기준으로는 +2.
    expect(shiftAroundView(prev, next, 3)).toBe(2);
  });

  it('앞쪽 절단은 종전과 같은 양(−K)', () => {
    expect(shiftAroundView(ids('a', 'b', 'c', 'd'), ids('c', 'd', 'e'), 3)).toBe(-2);
    // 보던 항목이 절단에 함께 사라져도 아래로 내려가 남은 첫 항목으로 잰다.
    expect(shiftAroundView(ids('a', 'b', 'c', 'd'), ids('c', 'd'), 0)).toBe(-2);
  });

  it('보던 자리 아래가 전부 사라졌으면 위로 거슬러 잰다', () => {
    expect(shiftAroundView(ids('a', 'b', 'c'), ids('z', 'a', 'b'), 2)).toBe(1);
  });

  it('겹치는 항목이 없으면(전량 교체) 0, 순번이 목록 밖이면 끝으로 붙인다', () => {
    expect(shiftAroundView(ids('a', 'b'), ids('x', 'y'), 1)).toBe(0);
    expect(shiftAroundView(ids('a', 'b'), ids('z', 'a', 'b'), 99)).toBe(1);
    expect(shiftAroundView(ids(), ids('a'), 0)).toBe(0);
  });
});

describe('advanceFrontShift — 보고 있는 자리(viewIndex)', () => {
  it('앞에 붙으면 기준값이 줄고, 앞이 잘리면 는다', () => {
    let st: FrontShiftState = { base: 1000, prevIds: ids('c', 'd', 'e') };
    st = advanceFrontShift(st, ids('a', 'b', 'c', 'd', 'e'), undefined, 0);
    expect(st.base).toBe(998);
    st = advanceFrontShift(st, ids('c', 'd', 'e', 'f'), undefined, 3);
    expect(st.base).toBe(1000);
  });

  it('밀도 전환(resetKey) 렌더는 보는 자리가 있어도 세지 않는다', () => {
    let st: FrontShiftState = { base: 1000, prevIds: ids('a', 'b', 'c'), prevKey: 'standard' };
    st = advanceFrontShift(st, ids('group-a', 'c'), 'compact', 2);
    expect(st.base).toBe(1000);
  });
});
