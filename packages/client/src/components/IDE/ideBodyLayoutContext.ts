// 창 안 반응형 판정(`ideResponsive.ts`)을 흘리는 통로. 재는 곳은 `AgentIDEOverlay` 하나 — 조각마다 재면 같은 창에서 답이 갈린다. 스토어를 모른다.

import { createContext, useContext } from 'react';
import { IDE_EDITOR_WIDTH } from '@vibisual/shared';
import type { IDEBodyLayout } from './ideResponsive.js';

export interface IDEBodyLayoutValue extends IDEBodyLayout {
  /** 서랍(활동바·사이드바)이 펼쳐져 있나(서랍 모드에서만 뜻). 폰과 창 폭 접힘이 같은 손잡이다. */
  navOpen: boolean;
  /** 서랍을 펴고 닫는다. 활동바가 자리에 남아 있는 상태에서 항목을 누르면 여기로 편다. */
  setNavOpen: (open: boolean) => void;
}

/** 컨텍스트 밖(테스트·미리보기) 폴백 — 아무것도 접지 않는다. */
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
