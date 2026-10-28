/** §5.5 #17-27 ①-1 — 편집창 자리를 내려 창을 오른쪽으로 넓히고 닫히면 되돌린다(가로만). 떠 있는 창(클라)과 OS 창(main)이 이 규칙 하나를 쓴다. */

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

/** `span` 을 오른쪽으로 `dx` 넓힌다 — 벽을 넘으면 왼쪽으로 물러서고, 그래도 모자라면 폭을 `area` 까지만(타이틀바가 화면 밖으로 가지 않게). `dx` 가 0 이하·비수면 그대로. */
export function growSpanRight(span: HSpan, dx: number, area: HSpan): HSpan {
  if (!(dx > 0) || !Number.isFinite(dx)) return { x: span.x, w: span.w };
  const areaW = Math.max(0, area.w);
  const w = Math.round(Math.min(span.w + dx, Math.max(span.w, areaW)));
  const right = area.x + areaW;
  const x = Math.round(Math.max(area.x, Math.min(span.x, right - w)));
  return { x, w };
}

/**
 * 닫힐 때 되돌릴 자리 — 폭을 사용자가 바꿨으면 `null`(정한 크기를 지우지 않는다), 자리만 옮겼으면 그 자리에서 폭만, 그대로면 원래 자리.
 * 1px 여유를 둔다 — OS 창은 분수 배율에서 쓸 때·읽을 때 따로 반올림한다(§17-6 (H-19)).
 */
export function shrinkSpanBack(current: HSpan, growth: SpanGrowth): HSpan | null {
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
  if (!near(current.w, growth.after.w)) return null;
  if (near(current.x, growth.after.x)) return { x: growth.before.x, w: growth.before.w };
  return { x: current.x, w: growth.before.w };
}
