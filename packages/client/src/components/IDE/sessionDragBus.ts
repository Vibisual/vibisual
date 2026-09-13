// §5.5 #17-34 / §5.4 #14-2 — **포인터로 끄는 세션이 어디에 떨어지는가.**
//
// 세션 탭은 종전에 HTML5 네이티브 DnD 였고, 그래서 "본문 위에 떨구면 화면이 갈라진다"도 그
// 엔진(`dragover`/`drop`)이 공짜로 날라 줬다. 탭의 손맛을 §5.5 #16-1 (E) 활동바와 같은 **꾹 눌러
// 집어 들기**로 바꾸면서 그 엔진이 사라지므로, 같은 일을 하는 최소한의 배선을 여기 둔다.
//
// 짐의 값을 숨길 이유가 없다는 점이 네이티브와 다르다 — `dragover` 중에는 MIME 종류만 보여서
// `splitDrop.ts` 가 `sessionOwnerMime`·`sessionIdMime` 같은 **종류로 값을 흉내 내는** 우회로를
// 만들어야 했지만, 포인터 경로에서는 끌고 있는 것이 무엇인지 그냥 들고 있으면 된다.
//
// **떨어질 자리는 하나다.** 칸은 서로 겹쳐 있고(칸 안에 본문, 본문 안에 또 칸) 네이티브에서는
// `stopPropagation` 으로 가장 안쪽이 이겼다. 여기서는 등록된 자리들을 좌표로 훑어 **다른 자리를
// 품지 않는 것**(=가장 깊은 것) 하나만 고른다 — 둘이 동시에 파란 박스를 띄우면 어디에 앉을지가
// 화면에서 갈린다(#17-34 가 "판정과 미리보기는 같은 표"라고 못박은 것과 같은 이유).

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
