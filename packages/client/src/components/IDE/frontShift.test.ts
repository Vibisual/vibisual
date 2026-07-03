import { describe, it, expect } from 'vitest';
import { countRemovedFromFront } from './frontShift.js';

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
