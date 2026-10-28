/** §5.5 #17-9 ④(b) — 가로 스크롤 밖 실행 중 세션 탭 찾기(가려지면 안 도는 화면과 구별이 안 된다). DOM 좌표·스크롤 위치만 받는 순수 함수. */

/** 탭 하나의 가로 범위 — 스크롤 컨테이너 콘텐츠 좌표계(`offsetLeft` 기준). */
export interface TabBox {
  id: string;
  left: number;
  right: number;
}

/** 가려진 실행 중 탭 — 각 목록은 **가까운 순**이라 `[0]` 이 곧 "그 방향으로 처음 만나는 탭". */
export interface HiddenRunningTabs {
  left: string[];
  right: string[];
}

/** 아무것도 가려지지 않았을 때 돌려주는 고정 참조(매번 새 객체를 만들지 않는다). */
const NONE: HiddenRunningTabs = { left: [], right: [] };

/** 경계에 1px 걸친 것을 "가려졌다"고 말하지 않기 위한 여유. */
const EPSILON = 2;

/** 가려진 것이 하나도 없으면 고정 참조를 돌려준다 — 호출부의 불필요한 DOM 갱신을 막는다. */
export function noHiddenRunningTabs(): HiddenRunningTabs {
  return NONE;
}

/** 보이는 창 완전히 밖의 실행 중 탭을 방향별로 모은다 — 걸친 탭은 상태점이 보여 알아보므로 세지 않는다. */
export function findHiddenRunningTabs(
  boxes: readonly TabBox[],
  runningIds: ReadonlySet<string>,
  scrollLeft: number,
  clientWidth: number,
): HiddenRunningTabs {
  if (boxes.length === 0 || runningIds.size === 0 || clientWidth <= 0) return NONE;
  const viewLeft = scrollLeft;
  const viewRight = scrollLeft + clientWidth;
  const left: string[] = [];
  const right: string[] = [];
  for (const box of boxes) {
    if (!runningIds.has(box.id)) continue;
    if (box.right <= viewLeft + EPSILON) left.push(box.id);
    else if (box.left >= viewRight - EPSILON) right.push(box.id);
  }
  if (left.length === 0 && right.length === 0) return NONE;
  // 왼쪽 목록은 화면에서 먼 것부터 담겼으니 뒤집어 **가까운 순**으로 맞춘다(오른쪽은 이미 가까운 순).
  left.reverse();
  return { left, right };
}

/** 두 판정 결과가 같은 내용인가 — 같으면 DOM 을 건드리지 않는다(스크롤마다 쓰기 방지). */
export function sameHiddenRunningTabs(a: HiddenRunningTabs, b: HiddenRunningTabs): boolean {
  if (a === b) return true;
  if (a.left.length !== b.left.length || a.right.length !== b.right.length) return false;
  return a.left.every((id, i) => id === b.left[i]) && a.right.every((id, i) => id === b.right[i]);
}
