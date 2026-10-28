// 헤더 언어 전환기를 온보딩 창 위로 띄울지의 순수 판정(렌더는 HeaderLanguageSlot.tsx) — 백드롭이 헤더를 덮는 동안 같은 좌표로 다시 그린다(§4).

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

/** 자리가 실제로 그려져 있을 때만 좌표를 준다 — 폰에선 묶음이 접혀 0×0 이라 (0,0)에 유령 버튼이 생긴다(폰은 카드 헤더 전환기가 맡는다). */
export function liftedSlotPosition(box: SlotBox | null): { top: number; left: number } | null {
  if (!box) return null;
  if (box.width <= 0 || box.height <= 0) return null;
  return { top: box.top, left: box.left };
}
