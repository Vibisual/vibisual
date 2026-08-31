// 창 안 반응형 판정(`ideResponsive.ts`)을 IDE 컴포넌트 나무에 흘리는 통로.
//
// 재는 곳은 `AgentIDEOverlay`(창의 뿌리) 하나뿐이다. 활동바·사이드바·편집창은 자기 폭을 스스로
// 재지 않고 여기서 읽는다 — 각자 재면 같은 창을 두고 서로 다른 답을 내(활동바는 접혔다고 보는데
// 사이드바는 안 접혔다고 보는) 층이 어긋난다.
//
// 이 파일은 스토어를 **모른다**(수입은 순수 판정 모듈 하나). `splitCellContext` 와 같은 결.

import { createContext, useContext } from 'react';
import { IDE_EDITOR_WIDTH } from '@vibisual/shared';
import type { IDEBodyLayout } from './ideResponsive.js';

export interface IDEBodyLayoutValue extends IDEBodyLayout {
  /**
   * 서랍(활동바·사이드바)이 지금 펼쳐져 있나. 서랍 모드가 아닐 때는 뜻이 없다.
   * 폰의 `mobileNavOpen` 이 그대로 이 자리로 왔다 — 창 폭으로 접힐 때도 같은 손잡이를 쓴다.
   */
  navOpen: boolean;
  /** 서랍을 펴고 닫는다. 활동바가 자리에 남아 있는 상태에서 항목을 누르면 여기로 편다. */
  setNavOpen: (open: boolean) => void;
}

/**
 * 컨텍스트 밖 폴백 — 창 밖에서 IDE 조각을 그리는 자리(테스트·미리보기)에서는 **아무것도 접지 않는다**.
 * 옛 화면과 한 픽셀도 다르지 않게.
 */
const FALLBACK: IDEBodyLayoutValue = {
  measured: false,
  navDrawer: false,
  sidebarDrawer: false,
  editorDrawer: false,
  editorWidth: IDE_EDITOR_WIDTH.DEFAULT,
  editorMaxWidth: IDE_EDITOR_WIDTH.MAX,
  streamWidth: 0,
  titleBarNarrow: false,
  navOpen: false,
  setNavOpen: () => { /* 창 밖에는 펼 서랍이 없다 */ },
};

export const IDEBodyLayoutContext = createContext<IDEBodyLayoutValue>(FALLBACK);

/** 이 창의 반응형 판정 — 무엇이 접혔고 편집창이 몇 px 인가. */
export function useIDEBodyLayout(): IDEBodyLayoutValue {
  return useContext(IDEBodyLayoutContext);
}
