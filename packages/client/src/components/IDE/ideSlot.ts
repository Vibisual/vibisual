// §5.5 #17-34 — 이 화면이 그리는 IDE 창의 슬롯 키를 답하는 한 곳(`ideOverlays` 키 = 팬 키 `<projectId>::ide-N`, 분할도 그대로 쓴다). 창 축이 넓어지면 여기만 바꾼다.

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
