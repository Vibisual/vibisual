import { describe, it, expect } from 'vitest';
import { LIFTED_LANGUAGE_Z, LIFTED_LANGUAGE_MENU_Z, liftedSlotPosition } from './headerLanguageLift.js';

// 온보딩 창들이 쓰는 z — 이 값들보다 위여야 전환기가 백드롭 위에서 눌린다.
const SETUP_GATE_Z = 100_700;
const LOGIN_GATE_Z = 100_600;
const FOLDER_GATE_Z = 100_500;
/** 창 카드 안(카드 헤더)의 전환기 목록이 쓰는 z — 설치 창 기준 가장 높은 값. */
const IN_CARD_MENU_Z = SETUP_GATE_Z + 100;

describe('headerLanguageLift', () => {
  it('띄운 전환기는 온보딩 창 전부보다 위에 있다', () => {
    for (const z of [SETUP_GATE_Z, LOGIN_GATE_Z, FOLDER_GATE_Z, IN_CARD_MENU_Z]) {
      expect(LIFTED_LANGUAGE_Z).toBeGreaterThan(z);
    }
    // 목록은 자기 버튼보다 위 — 아니면 버튼이 목록을 가린다.
    expect(LIFTED_LANGUAGE_MENU_Z).toBeGreaterThan(LIFTED_LANGUAGE_Z);
  });

  it('그려진 자리의 좌표를 그대로 쓴다', () => {
    expect(liftedSlotPosition({ width: 86, height: 24, top: 8, left: 1_300 })).toEqual({ top: 8, left: 1_300 });
  });

  it('자리가 접혀 있으면(폰 · 0×0) 띄우지 않는다', () => {
    // 0×0 을 그대로 띄우면 화면 왼쪽 위에 유령 버튼이 하나 생긴다.
    expect(liftedSlotPosition({ width: 0, height: 0, top: 0, left: 0 })).toBeNull();
    expect(liftedSlotPosition({ width: 86, height: 0, top: 8, left: 1_300 })).toBeNull();
    expect(liftedSlotPosition(null)).toBeNull();
  });

  it('화면 왼쪽 끝(0)도 유효한 자리다', () => {
    // 좌표 0 을 "없음"으로 접으면 창이 좁을 때 전환기가 사라진다.
    expect(liftedSlotPosition({ width: 86, height: 24, top: 0, left: 0 })).toEqual({ top: 0, left: 0 });
  });
});
