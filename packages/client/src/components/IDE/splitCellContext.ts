// §5.5 #17-34 — 칸이 자기 자신을 밝히는 통로.
//
// `IDEMainArea` 는 "이 창의 활성 세션" 하나를 보고 그린다. 창을 여러 칸으로 나누면 그 문장이 거짓이
// 된다 — 같은 창 안에서 칸마다 다른 세션을 봐야 하기 때문이다. 그렇다고 3,500줄짜리 본문에 세션을
// 프롭으로 꿰면 중간의 모든 컴포넌트가 그 프롭을 나르게 되므로, **칸이 자기 값을 컨텍스트로 깔고
// 본문은 그걸 읽는다.**
//
// 이 파일은 스토어를 **모른다**(수입 0). 창 값(창의 활성 세션)은 부르는 쪽이 넘겨 준다 —
// 창 축(#17-1 확장의 팬 컨텍스트)이 어떻게 바뀌든 이 파일은 그대로다.

import { createContext, useContext } from 'react';

export interface IDESplitCellValue {
  cellId: string;
  /** 이 칸이 보여 주는 세션. `null` = 메인 탭(에이전트 전체 합본). */
  sessionId: string | null;
  /** 이 칸이 지금 초점을 갖고 있는가 — 창 단위 단축키의 임자를 가른다. */
  focused: boolean;
}

export const IDESplitCellContext = createContext<IDESplitCellValue | null>(null);

/**
 * 이 자리가 보여 줄 세션.
 * @param windowSession 분할이 없을 때 쓸 값 = 이 **창**의 활성 세션.
 *   칸의 세션은 `null`(메인 탭)일 수 있으므로 `??` 로 접지 않고 칸의 유무로 가른다.
 */
export function useSplitCellSession(windowSession: string | null): string | null {
  const cell = useContext(IDESplitCellContext);
  return cell ? cell.sessionId : windowSession;
}

/**
 * 창 단위 단축키(Ctrl+F 검색·Ctrl±/휠 배율)를 이 자리가 받아도 되는가.
 * 분할 중에는 **초점 칸만** 받는다 — 칸마다 같은 `window` 리스너를 달아 두면 한 번 누른 확대가
 * 칸 수만큼 적용돼 배율이 서너 단씩 튄다.
 */
export function useSplitCellFocused(): boolean {
  const cell = useContext(IDESplitCellContext);
  return cell ? cell.focused : true;
}
