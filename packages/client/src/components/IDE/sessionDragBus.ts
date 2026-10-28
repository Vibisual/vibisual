// §5.5 #17-34 / §5.4 #14-2 — 포인터로 끄는 세션이 어디에 떨어지는가(탭이 꾹 눌러 집기라 HTML5 DnD 대신 쓰는 최소 배선). 짐은 값을 그대로 든다.
// 떨어질 자리는 하나 — 겹친 등록 자리 중 다른 자리를 품지 않는 가장 깊은 것만(둘이 파란 박스를 띄우면 앉을 자리가 갈린다).

/** 지금 손에 들려 있는 세션. `sessionId: null` 은 훅 에이전트의 메인 탭(전체 합본)이다. */
export interface PointerSessionDrag {
  sessionId: string | null;
  /** 이 세션의 주인 — 옆 창이 남의 세션을 받지 않게 하는 기준(`dragOwnerMatches` 와 같은 판정). */
  agentId: string;
  /** 출처 칸. 칸을 **옮기는** 중이면 총 칸 수가 늘지 않으므로 상한 판정이 달라진다. */
  fromCellId: string | null;
}

export interface SessionDropTarget {
  /** 이 자리의 DOM. 좌표 판정과 깊이 판정이 전부 이것으로 돈다. */
  el: HTMLElement;
  /** 커서가 이 자리 안에 있다. 매 움직임마다. */
  onOver: (drag: PointerSessionDrag, x: number, y: number) => void;
  /** 커서가 이 자리를 떠났거나 끌기가 끝났다. */
  onLeave: () => void;
  /** 이 자리에서 손을 뗐다. */
  onDrop: (drag: PointerSessionDrag, x: number, y: number) => void;
}

const targets = new Set<SessionDropTarget>();
let active: PointerSessionDrag | null = null;
let hovered: SessionDropTarget | null = null;

/** 드롭 자리 등록 — 반환값을 부르면 해제된다(`useEffect` 정리에 그대로 넘긴다). */
export function registerSessionDropTarget(target: SessionDropTarget): () => void {
  targets.add(target);
  return () => {
    targets.delete(target);
    if (hovered === target) hovered = null;
  };
}

/** 지금 포인터로 끌고 있는 세션(없으면 `null`). 미리보기 훅이 자기가 반응할지 정할 때 본다. */
export function activePointerSessionDrag(): PointerSessionDrag | null {
  return active;
}

/** 좌표를 품은 자리 중 **가장 깊은** 하나. 겹친 자리에서 안쪽이 이긴다. */
function hitTest(x: number, y: number): SessionDropTarget | null {
  const inside: SessionDropTarget[] = [];
  for (const target of targets) {
    if (!target.el.isConnected) continue;
    const r = target.el.getBoundingClientRect();
    if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) inside.push(target);
  }
  if (inside.length === 0) return null;
  return inside.find((t) => !inside.some((o) => o !== t && t.el.contains(o.el))) ?? inside[0] ?? null;
}

export function beginPointerSessionDrag(drag: PointerSessionDrag): void {
  active = drag;
  hovered = null;
}

export function movePointerSessionDrag(x: number, y: number): void {
  if (!active) return;
  const next = hitTest(x, y);
  if (hovered && hovered !== next) hovered.onLeave();
  hovered = next;
  if (next) next.onOver(active, x, y);
}

/** 손을 뗐다 — 자리 위였으면 그 자리가 받는다. 받았는지를 돌려준다. */
export function endPointerSessionDrag(x: number, y: number): boolean {
  const drag = active;
  if (!drag) return false;
  const target = hitTest(x, y);
  if (hovered && hovered !== target) hovered.onLeave();
  hovered = null;
  active = null;
  if (!target) return false;
  target.onLeave();
  target.onDrop(drag, x, y);
  return true;
}

/** `Esc`·창 포커스 상실 — 아무 일도 없었던 것으로. */
export function cancelPointerSessionDrag(): void {
  if (!active) return;
  active = null;
  const was = hovered;
  hovered = null;
  was?.onLeave();
}
