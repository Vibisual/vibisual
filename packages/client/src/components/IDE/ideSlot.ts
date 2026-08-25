// §5.5 #17-34 — "지금 이 화면이 그리고 있는 IDE 창은 어느 슬롯인가"를 답하는 **한 곳**.
//
// IDE 창의 상태는 `ideOverlays[슬롯키]` 에 산다. 그 키는 종전 프로젝트명 하나였고 #17-1 확장이
// **팬 키**(`<projectId>::ide-N`)로 넓혔다. 분할(#17-34)은 창마다 따로 서므로 그 키를 그대로 쓴다 —
// 분할이 창 슬롯을 읽는 길을 이 파일 하나로 모아 두면, 창 축이 또 넓어져도 **여기 한 함수만**
// 바꾸면 된다. 열 군데에 흩어 두면 그날 절반만 옮겨 간다.

import { useIDEPaneValue } from './idePane.js';

/**
 * 그 창의 슬롯 키(= `ideOverlays` 의 키). 주 창은 프로젝트명과 같다.
 * 인자를 구조로만 받아(팬 컨텍스트가 넘겨 주는 값이 무엇이든) 이 함수가 그 축에 매이지 않게 한다.
 */
export function ideSlotKey(ide: { paneKey: string; projectId: string | null }): string {
  return ide.paneKey || ide.projectId || '';
}

/** 지금 그리고 있는 **이 창**의 슬롯 키. 창이 닫혀 있으면 빈 문자열. */
export function useIDESlotKey(): string {
  return useIDEPaneValue(ideSlotKey);
}
