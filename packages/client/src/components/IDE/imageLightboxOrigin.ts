// §5.5 #17-25 — 라이트박스는 연 자리 하나에만. 호스트(`ImageLightboxHost`)가 본문마다 있어 전역 하나를 다 보면 겹쳐 뜨고 [저장]이 엉뚱한 곳으로 간다 — 여는 쪽이 자리(슬롯 + 칸)를 적는다.

import { useCallback, useContext, useMemo } from 'react';
import type { ImageLightboxOrigin } from '../../stores/graphStore.js';
import { readIDEPane, useIDEPaneKey } from './idePane.js';
import { ideSlotKey, useIDESlotKey } from './ideSlot.js';
import { IDESplitCellContext, useSplitCellFocused } from './splitCellContext.js';

/** 여는 자리를 만드는 함수 — 누르는 순간 불러 `openImageLightbox` 에 넘긴다(칸 밖이면 `cell` null). 렌더 중엔 스토어를 안 읽는다(슬롯 키는 누를 때 — 썸네일마다 구독을 늘리지 않게). */
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
