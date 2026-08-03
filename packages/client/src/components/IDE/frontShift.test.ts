import { describe, it, expect } from 'vitest';
import { countRemovedFromFront, advanceFrontShift, type FrontShiftState } from './frontShift.js';

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
