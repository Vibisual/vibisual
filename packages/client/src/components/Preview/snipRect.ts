import { PREVIEW_SNIP_MIN_PX, type PreviewSnipRect } from '@vibisual/shared';

/**
 * §5.17 (B) — 드래그 두 점에서 캡처할 사각형 한 개.
 *
 * 화면 없이 시험할 수 있게 순수 함수로 떼어 둔다(§5.16 `reviewRejectPrompt` 와 같은 골격).
 * - 어느 방향으로 끌어도(오른쪽↓ · 왼쪽↑) 같은 사각형이 나온다.
 * - `bounds` 를 주면 프리뷰 밖으로 나간 부분을 잘라 낸다 — 옆 패널이나 캔버스 배경이 함께
 *   찍히면 "이 화면의 이 부분" 이라는 말이 어긋난다.
 * - `PREVIEW_SNIP_MIN_PX` 보다 작으면 **오조작으로 보고 null** — 캡처 모드에서 무심코 누른
 *   클릭과 "여기를 찍겠다" 를 가르는 선이다.
 *
 * 좌표는 `getBoundingClientRect()` 와 같은 CSS px(창 문서 좌상단 기준)이며, Electron
 * `capturePage(rect)` 가 받는 좌표계와 같아 변환이 없다. 정수로 반올림해 돌려준다.
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
