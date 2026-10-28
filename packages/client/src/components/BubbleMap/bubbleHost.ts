import { createContext, useContext } from 'react';

/**
 * 캔버스 버블(`BubbleNode`)을 IDE 세션 버블 지도(§5.5 #17-50)에 빌려 그릴 때 손짓을 받는 자리.
 * 고르기·확인 dismiss·우클릭 메뉴는 캔버스 전역을 건드리므로 지도 안 버블은 이 판에 알린다. 없으면(캔버스) 평소대로.
 */
export interface BubbleHost {
  /** 선택 링 — 뗀 즉시 켜고 2타가 보류를 접으면 끈다. 링은 판이 노드 데이터(`BUBBLE_HOST_RING`)로 실어 옮겨 갈 때 두 버블만 다시 그린다. */
  intent: (nodeId: string, active: boolean) => void;
  /** 실제 고르기 — 2타를 기다린 뒤(더블클릭 동작이 없는 버블은 곧바로). 판이 정보를 띄운다. */
  select: (nodeId: string) => void;
  /** 우클릭(터치 길게 누르기 포함) — 무엇을 할지는 판이 정한다. 캔버스 메뉴로는 새지 않는다. */
  menu: (nodeId: string, screenX: number, screenY: number) => void;
}

export const BubbleHostContext = createContext<BubbleHost | null>(null);

/** 이 버블을 그리는 판의 손잡이. 캔버스에서는 `null`. */
export function useBubbleHost(): BubbleHost | null {
  return useContext(BubbleHostContext);
}

/** 판이 링을 켠 노드의 데이터 표식(`true`). 캔버스 링(`selectIntentId`)과 섞이지 않게 판마다 따로 싣는다. */
export const BUBBLE_HOST_RING = '_hostRing';
