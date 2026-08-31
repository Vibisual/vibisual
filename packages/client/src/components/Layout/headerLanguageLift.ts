// 헤더(상단 탭) 언어 전환기를 온보딩 창 위로 띄울지 정하는 순수 판정 — 렌더는 HeaderLanguageSlot.tsx.
//
// §4 (첫 실행 온보딩) — 설치·로그인·폴더·버전 창은 `fixed inset-0` 백드롭으로 헤더까지 덮는다.
// 그 동안 전환기는 눈에 보이지만 눌리지 않으므로, 같은 자리 좌표로 창 위에 다시 그린다.

/** 띄운 전환기의 z — 온보딩 창들(설치 100_700 · 로그인 100_600 · 폴더/버전 100_500)보다 위여야 한다. */
export const LIFTED_LANGUAGE_Z = 100_900;

/** 띄운 전환기의 언어 목록 z — 자기 버튼보다 위(목록은 body 로 빠진다). */
export const LIFTED_LANGUAGE_MENU_Z = LIFTED_LANGUAGE_Z + 50;

export interface SlotBox {
  width: number;
  height: number;
  top: number;
  left: number;
}

/**
 * 띄울 좌표 — 자리가 **실제로 그려져 있을 때만** 돌려준다.
 *
 * 폰(max-md)에서는 헤더 우측 묶음이 접혀 있어(`display:none`) 이 자리가 0×0 이다. 그대로 띄우면
 * 화면 왼쪽 위(0,0)에 유령 버튼이 하나 생기므로 그때는 아무것도 띄우지 않는다 — 폰에서는 창 안
 * (카드 헤더)의 전환기가 그 몫을 한다.
 */
export function liftedSlotPosition(box: SlotBox | null): { top: number; left: number } | null {
  if (!box) return null;
  if (box.width <= 0 || box.height <= 0) return null;
  return { top: box.top, left: box.left };
}
