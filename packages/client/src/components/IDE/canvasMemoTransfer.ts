import type { SessionMemo } from '@vibisual/shared';
import type { MemoRect } from './sessionMemo.js';

export const CANVAS_MEMO_DROP_EVENT = 'vibisual:canvas-memo-drop';
export const CANVAS_MEMO_DRAG = {
  EXIT_RATIO: 1 / 3,
  READY_OUTLINE: '2px solid #34D399',
  READY_BORDER: '#34D399',
  READY_BACKGROUND: 'rgba(52,211,153,0.22)',
  READY_TEXT: '#D1FAE5',
  PREVIEW_BORDER: '#38BDF8',
  PREVIEW_BACKGROUND: 'rgba(56,189,248,0.10)',
  PREVIEW_TEXT: '#E0F2FE',
};
export interface CanvasMemoExit {
  card: MemoRect;
  bounds: MemoRect;
  /** 원래 IDE의 모달 배경막은 캔버스 이동을 막지 않는다. */
  backdrop?: EventTarget;
}
export interface CanvasMemoDestination {
  project: string;
  folderId: string | null;
  x: number;
  y: number;
}
export interface CanvasMemoDropRequest {
  pointer: { x: number; y: number };
  position: { x: number; y: number };
  exit?: CanvasMemoExit;
  destination: CanvasMemoDestination | null;
}

/** IDE 밖으로 나온 조각과 캔버스가 겹치는 지점으로 찾는다. 커서는 IDE 안에 남을 수 있다. */
export function canvasMemoExitPoint({ card, bounds }: CanvasMemoExit, canvas: MemoRect): { x: number; y: number } | null {
  if (card.w <= 0 || card.h <= 0 || bounds.w <= 0 || bounds.h <= 0) return null;
  const right = card.x + card.w;
  const bottom = card.y + card.h;
  const boundRight = bounds.x + bounds.w;
  const boundBottom = bounds.y + bounds.h;
  const sides = [
    { ratio: (bounds.x - card.x) / card.w, x: card.x, y: card.y, right: Math.min(right, bounds.x), bottom },
    { ratio: (right - boundRight) / card.w, x: Math.max(card.x, boundRight), y: card.y, right, bottom },
    { ratio: (bounds.y - card.y) / card.h, x: card.x, y: card.y, right, bottom: Math.min(bottom, bounds.y) },
    { ratio: (bottom - boundBottom) / card.h, x: card.x, y: Math.max(card.y, boundBottom), right, bottom },
  ];
  for (const side of sides) {
    if (side.ratio < CANVAS_MEMO_DRAG.EXIT_RATIO) continue;
    const x = Math.max(side.x, canvas.x);
    const y = Math.max(side.y, canvas.y);
    const endX = Math.min(side.right, canvas.x + canvas.w);
    const endY = Math.min(side.bottom, canvas.y + canvas.h);
    if (endX > x && endY > y) return { x: (x + endX) / 2, y: (y + endY) / 2 };
  }
  return null;
}

export function canvasMemoDestination(pointer: { x: number; y: number }, position: { x: number; y: number }, exit?: CanvasMemoExit): CanvasMemoDestination | null {
  const detail: CanvasMemoDropRequest = { pointer, position, ...(exit ? { exit } : {}), destination: null };
  window.dispatchEvent(new CustomEvent<CanvasMemoDropRequest>(CANVAS_MEMO_DROP_EVENT, { detail }));
  return detail.destination;
}

export async function postCanvasMemo(action: 'move' | 'save' | 'return' | 'delete', input: object): Promise<SessionMemo[] | null> {
  try {
    const response = await fetch(`/api/canvas-memos/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!response.ok) return null;
    const data: { ok?: boolean; memos?: SessionMemo[] } = await response.json();
    return data.ok && Array.isArray(data.memos) ? data.memos : null;
  } catch {
    return null;
  }
}
