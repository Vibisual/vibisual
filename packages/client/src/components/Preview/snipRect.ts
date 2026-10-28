import { PREVIEW_SNIP_MIN_PX, type PreviewSnipRect } from '@vibisual/shared';

/**
 * §5.17 (B) — 드래그 두 점 → 캡처 사각형(순수). 방향 무관 · `bounds` 밖은 자른다 · `PREVIEW_SNIP_MIN_PX` 미만은 오조작으로 `null`.
 * 좌표는 창 기준 CSS px(`capturePage(rect)` 와 같다), 정수로 반올림.
 */
export function normalizeSnipRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  bounds?: { x: number; y: number; width: number; height: number },
): PreviewSnipRect | null {
  let left = Math.min(start.x, end.x);
  let top = Math.min(start.y, end.y);
  let right = Math.max(start.x, end.x);
  let bottom = Math.max(start.y, end.y);

  if (bounds) {
    left = Math.max(left, bounds.x);
    top = Math.max(top, bounds.y);
    right = Math.min(right, bounds.x + bounds.width);
    bottom = Math.min(bottom, bounds.y + bounds.height);
  }

  const x = Math.round(left);
  const y = Math.round(top);
  const width = Math.round(right - left);
  const height = Math.round(bottom - top);

  if (width < PREVIEW_SNIP_MIN_PX || height < PREVIEW_SNIP_MIN_PX) return null;
  return { x, y, width, height };
}

/** 첨부 파일 이름 — 언제 찍은 것인지 파일명만 보고도 알 수 있게. */
export function snipFileName(now: number = Date.now()): string {
  const d = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `preview-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
}
