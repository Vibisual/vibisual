// §5.5 #17-25 — 라이트박스는 **연 자리 하나**에만 선다.
//
// 라이트박스를 그리는 호스트(`ImageLightboxHost`)는 대화 본문(`IDEMainArea`)마다 하나씩 있다 — 창이 여럿이거나
// 한 창을 칸으로 나누면(#17-34) 호스트도 여럿이 된다. 종전에는 모두가 전역 `imageLightbox` 하나를 보고 저마다
// 그렸다: 한 번 연 그림이 창·칸 수만큼 겹쳐 떴고, 맨 위에 선 것은 마지막에 그려진 호스트의 것이라 [저장]이
// **누른 곳이 아닌** 창·세션의 입력창으로 갔다. 그래서 여는 쪽이 자기 자리(창 슬롯 + 분할 칸)를 함께 적고,
// 호스트는 제 자리와 맞을 때만 그린다. 판정은 순수 함수(`lightboxHostMatches`)라 화면 없이 시험한다.

import { useCallback, useContext, useMemo } from 'react';
import type { ImageLightboxOrigin } from '../../stores/graphStore.js';
import { readIDEPane, useIDEPaneKey } from './idePane.js';
import { ideSlotKey, useIDESlotKey } from './ideSlot.js';
import { IDESplitCellContext, useSplitCellFocused } from './splitCellContext.js';

/**
 * 이 자리를 만드는 함수 — 여는 쪽이 누르는 순간 불러 `openImageLightbox` 에 함께 넘긴다. 분할 칸 밖(편집창·사이드바)이면
 * `cell` 은 null. 렌더 중에는 스토어를 읽지 않는다(창 슬롯 키는 누를 때 한 번 읽는다 — 썸네일마다 구독을 늘리지 않는다).
 */
export function useImageLightboxOrigin(): () => ImageLightboxOrigin {
  const paneKey = useIDEPaneKey();
  const cell = useContext(IDESplitCellContext)?.cellId ?? null;
  return useCallback(() => ({ slot: ideSlotKey(readIDEPane(paneKey)), cell }), [paneKey, cell]);
}

/** 호스트 쪽 자리 — 여는 자리에 "분할 중 초점 칸인가"가 더해진다(분할이 없으면 참). */
export interface ImageLightboxHostSpot extends ImageLightboxOrigin {
  focused: boolean;
}

export function useImageLightboxHostSpot(): ImageLightboxHostSpot {
  const slot = useIDESlotKey();
  const cell = useContext(IDESplitCellContext)?.cellId ?? null;
  const focused = useSplitCellFocused();
  return useMemo(() => ({ slot, cell, focused }), [slot, cell, focused]);
}

/**
 * 그 라이트박스를 이 호스트가 그리는가. 같은 창이어야 하고, 칸에서 열었으면 **그 칸만**, 칸 밖(편집창·사이드바)에서
 * 열었으면 그 창의 **초점 칸**(분할이 없으면 하나뿐인 본문)이 그린다 — 어느 경우든 그리는 호스트는 하나다.
 */
export function lightboxHostMatches(origin: ImageLightboxOrigin, host: ImageLightboxHostSpot): boolean {
  if (origin.slot !== host.slot) return false;
  if (origin.cell !== null) return host.cell === origin.cell;
  return host.cell === null || host.focused;
}
