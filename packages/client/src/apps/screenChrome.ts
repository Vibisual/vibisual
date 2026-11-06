/**
 * §5.4 #36 (G)(J) — 앱 화면의 테두리·머리줄·조작줄 치수(px) 한 벌. 노드가 그리는 자리(`AppBubbleNode`)·조작줄(`FaceBar`)·
 * 크기 판정(`appNodeForm`)이 같은 값을 읽는다 — 갈리면 결과 칸 비율이 몇 px 씩 어긋난다.
 */

/** 머리줄 높이 — `AppBubbleNode` 머리줄의 `h-[22px]` 와 같은 값. */
export const SCREEN_HEADER_HEIGHT = 22;
/** 화면 테두리 두께 — 좌우·위아래로 한 번씩 빠진다. */
export const SCREEN_BORDER = 1;
/** 조작줄 높이 — `FaceBar` 의 `h-6` 과 같은 값. */
export const FACE_BAR_HEIGHT = 24;

/** 결과 칸 밖의 몫(폭 = 테두리 둘 · 높이 = 테두리 둘 + 머리줄 + 조작줄). */
export const SCREEN_CHROME = {
  width: SCREEN_BORDER * 2,
  height: SCREEN_BORDER * 2 + SCREEN_HEADER_HEIGHT + FACE_BAR_HEIGHT,
} as const;
