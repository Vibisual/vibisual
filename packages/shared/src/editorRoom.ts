/**
 * §5.5 #17-27 ①-1 — 편집창 자리를 내려고 **창을 오른쪽으로 넓히고**, 판이 닫히면 되돌린다.
 *
 * 앱 안의 떠 있는 창(클라)과 독립 OS 창(main)이 같은 규칙 하나를 쓴다 — 둘이 따로 계산하면
 * 같은 동작이 창 종류에 따라 다른 자리로 간다. 세로(자리·높이)는 건드리지 않으므로 가로 한 줄만 다룬다.
 */

/** 창 하나의 가로 자리 — 왼쪽 변(x)과 폭(w). */
export interface HSpan {
  x: number;
  w: number;
}

/** 넓히기 한 번의 기억 — 되돌릴 때 "그 사이 사용자가 손댔나"를 이것과 대조한다. */
export interface SpanGrowth {
  before: HSpan;
  after: HSpan;
}

/**
 * `span` 을 오른쪽으로 `dx` 만큼 넓힌 자리. 오른쪽 벽(`area` 의 오른쪽 끝)을 넘으면 넘친 만큼
 * **왼쪽으로 물러서고**, 그래도 모자라면 폭을 `area` 폭까지만 쓴다(창이 화면 밖으로 나가 타이틀바를
 * 잃지 않게). `dx` 가 0 이하이거나 수가 아니면 그대로 돌려준다.
 */
export function growSpanRight(span: HSpan, dx: number, area: HSpan): HSpan {
  if (!(dx > 0) || !Number.isFinite(dx)) return { x: span.x, w: span.w };
  const areaW = Math.max(0, area.w);
  const w = Math.round(Math.min(span.w + dx, Math.max(span.w, areaW)));
  const right = area.x + areaW;
  const x = Math.round(Math.max(area.x, Math.min(span.x, right - w)));
  return { x, w };
}

/**
 * 판이 닫힐 때 되돌릴 자리 — 넓힌 뒤 **폭**을 사용자가 바꿨으면 `null`(손대지 않는다: 사용자가
 * 정한 크기를 앱이 지우지 않는다). 폭은 그대로인데 자리만 옮겼으면 **그 자리에서 폭만** 되돌린다.
 * 둘 다 그대로면 넓히기 전 자리 그대로다.
 *
 * 비교에 1px 여유를 둔다 — OS 창은 분수 배율에서 쓸 때와 읽을 때 따로 반올림한다(§17-6 (H-19)).
 */
export function shrinkSpanBack(current: HSpan, growth: SpanGrowth): HSpan | null {
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
  if (!near(current.w, growth.after.w)) return null;
  if (near(current.x, growth.after.x)) return { x: growth.before.x, w: growth.before.w };
  return { x: current.x, w: growth.before.w };
}
