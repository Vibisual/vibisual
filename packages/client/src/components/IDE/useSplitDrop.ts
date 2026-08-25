// §5.5 #17-34 — "여기에 떨어뜨릴 수 있다"를 담당하는 손.
//
// 칸(과 아직 안 나뉜 창 전체)이 이 훅 하나를 쓴다. `dragover` 중에는 짐의 **값**을 읽을 수 없고
// 종류만 보이므로, 판정은 전용 MIME 으로 하고 값은 손을 뗄 때 읽는다. 자리 계산은 전부
// `splitDrop` 순수 함수가 하고 여기서는 이벤트만 받는다.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { useGraphStore } from '../../stores/graphStore.js';
import { canSplit, cellIdForSession } from './splitLayout.js';
import {
  SESSION_DRAG_MIME,
  SPLIT_CELL_DRAG_MIME,
  decodeSessionDrag,
  dragHasSession,
  dragIsSession,
  dragOwnerMatches,
  dropPreviewBox,
  fitsSplit,
  resolveDropSide,
  type DropPreviewBox,
  type SplitDropBlock,
  type SplitDropSide,
} from './splitDrop.js';
import { useIDEPaneActions } from './idePane.js';

export interface SplitDropState {
  /** 지금 손을 떼면 앉을 자리. `null` 이면 이 자리 위에 세션 드래그가 없다. */
  side: SplitDropSide | null;
  /** 떨굴 수 없는 이유(상한·남의 세션·너무 좁음). 미리보기가 색과 말로 그 사실을 말한다. */
  blocked: SplitDropBlock;
  box: DropPreviewBox | null;
}

const IDLE: SplitDropState = { side: null, blocked: null, box: null };

export interface SplitDropHandlers {
  onDragEnter: (e: DragEvent<HTMLElement>) => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

/**
 * @param slotKey 이 IDE 창의 슬롯 키.
 * @param cellId  대상 칸. `null` = 아직 안 나뉜 창 전체(첫 분할).
 * @param agentId 이 창이 보고 있는 에이전트 — **남의 창 세션**을 걸러내는 기준.
 * @param cellSessionId 이 자리가 지금 보여 주는 세션 — 같은 것을 또 떨구는 헛손질을 미리 알린다.
 */
export function useSplitDrop(
  slotKey: string,
  cellId: string | null,
  agentId: string,
  cellSessionId: string | null,
): {
  state: SplitDropState;
  handlers: SplitDropHandlers;
} {
  const [state, setState] = useState<SplitDropState>(IDLE);
  // 자식 위를 지날 때마다 leave 가 나므로 깊이를 세어 **정말 나갔을 때만** 미리보기를 걷는다.
  const depth = useRef(0);
  const layout = useGraphStore((s) => s.ideSplits[slotKey]?.layout ?? null);
  const drop = useGraphStore((s) => s.dropSessionOnIDECell);
  const { setSession } = useIDEPaneActions();

  const reset = useCallback(() => {
    depth.current = 0;
    setState((prev) => (prev.side === null ? prev : IDLE));
  }, []);

  const onDragEnter = useCallback((e: DragEvent<HTMLElement>) => {
    if (!dragHasSession(e.dataTransfer.types)) return;
    e.preventDefault();
    depth.current += 1;
  }, []);

  const onDragOver = useCallback((e: DragEvent<HTMLElement>) => {
    if (!dragHasSession(e.dataTransfer.types)) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const side = resolveDropSide(rect, e.clientX, e.clientY);
    // 칸을 **옮기는** 중이면 총 칸 수가 늘지 않으므로 상한과 무관하다.
    const moving = e.dataTransfer.types.includes(SPLIT_CELL_DRAG_MIME);
    // 막는 이유는 셋. 순서가 곧 우선순위다 — 남의 세션이면 크기도 상한도 물을 필요가 없다.
    let blocked: SplitDropBlock = null;
    if (!dragOwnerMatches(e.dataTransfer.types, agentId)) blocked = 'foreign';
    // 이 자리가 이미 그 세션을 보여 주고 있으면 어느 변이든 결과가 없다 — 파란 박스를 띄우지 않는다.
    else if (dragIsSession(e.dataTransfer.types, cellSessionId)) blocked = 'same';
    else if (side !== 'center') {
      if (!fitsSplit(rect, side)) blocked = 'tooSmall';
      else if (!moving && !canSplit(layout)) blocked = 'limit';
    }
    // 색·문구와 함께 커서도 같은 말을 하게 한다(막힌 자리에서는 금지 커서).
    e.dataTransfer.dropEffect = blocked ? 'none' : 'move';
    setState((prev) => (
      prev.side === side && prev.blocked === blocked ? prev : { side, blocked, box: dropPreviewBox(side) }
    ));
  }, [layout, agentId, cellSessionId]);

  // 드래그가 **여기서 끝나지 않고** 사라지는 길이 있다 — Esc 취소, 창 밖 드롭, 금지 커서에서 놓기.
  //   그때 `dragleave` 가 오지 않으면 파란 박스가 화면에 그대로 얼어붙는다(사용자에겐 "고장").
  //   드래그의 끝은 어디서 끝나든 window 까지 올라오므로 그 신호로 반드시 걷는다.
  useEffect(() => {
    if (state.side === null) return;
    const clear = (): void => { reset(); };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, [state.side, reset]);

  const onDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    if (!dragHasSession(e.dataTransfer.types)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) reset();
  }, [reset]);

  const onDrop = useCallback((e: DragEvent<HTMLElement>) => {
    if (!dragHasSession(e.dataTransfer.types)) return;
    e.preventDefault();
    e.stopPropagation();
    const side = state.side;
    const blocked = state.blocked;
    reset();
    if (!side || blocked) return;
    const payload = decodeSessionDrag(e.dataTransfer.getData(SESSION_DRAG_MIME));
    if (!payload) return;
    const from = e.dataTransfer.getData(SPLIT_CELL_DRAG_MIME) || null;
    drop(slotKey, cellId, side, payload.sessionId, from);
    // 탭바·사이드바·상태바가 방금 앉힌 칸을 따라보게 한다(선택의 창구는 종전 그대로 하나다).
    setSession(payload.sessionId);
  }, [state.side, state.blocked, reset, drop, setSession, slotKey, cellId]);

  return { state, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

/** 미리보기 박스 위치·크기(%) → 인라인 스타일. 비율 값이라 Tailwind 로는 표현할 수 없다. */
export function previewBoxStyle(box: DropPreviewBox): CSSProperties {
  return {
    left: `${String(box.leftPct)}%`,
    top: `${String(box.topPct)}%`,
    width: `${String(box.widthPct)}%`,
    height: `${String(box.heightPct)}%`,
  };
}

/**
 * 탭을 눌렀을 때 무엇이 일어나는가 — 분할이 없으면 종전 그대로 창의 활성 세션만 바뀐다.
 *
 * 분할 중이면 한 걸음 더 간다: 그 세션이 **이미 떠 있는 칸**이 있으면 그 칸으로 초점을 옮기고,
 * 없으면 **초점 칸의 내용**을 그 세션으로 갈아 끼운다. 이게 없으면 탭바 강조는 X 를 가리키는데
 * 화면의 칸들은 전부 다른 세션을 보여 주는 상태가 된다(같은 화면이 두 가지를 말한다).
 */
export function useSelectSessionInSplit(slotKey: string): (sessionId: string | null) => void {
  const { setSession } = useIDEPaneActions();
  const focusCell = useGraphStore((s) => s.focusIDESplitCell);
  const drop = useGraphStore((s) => s.dropSessionOnIDECell);
  return useCallback((sessionId: string | null) => {
    const split = useGraphStore.getState().ideSplits[slotKey];
    if (split) {
      const already = cellIdForSession(split.layout, sessionId);
      if (already) focusCell(slotKey, already);
      else if (split.focusedCellId) drop(slotKey, split.focusedCellId, 'center', sessionId);
    }
    setSession(sessionId);
  }, [slotKey, setSession, focusCell, drop]);
}
