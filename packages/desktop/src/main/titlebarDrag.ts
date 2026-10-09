// SCENARIO.md §3.7 · §5.5 #17-6 (H-19) — **헤더 로고 덮개의 끌기 문턱.**
//
// 덮개(`Header.tsx` 의 `app-nodrag` 덮개)는 OS 캡션이 아니라서 끌기도 더블클릭도 우리가 대신한다
// (`ipc.ts` 의 `vibisual:window:move-self` · `toggle-maximize-self`). OS 캡션에는 끌기 문턱이 있어
// 최대화된 창을 눌렀다 떼는 동안의 손떨림이 창을 풀지 않는다. 덮개에는 그 문턱이 없었다 — 첫 클릭의
// 1px 떨림이 `move` 한 번으로 창을 풀어 커서 밑으로 옮기고, 이어지는 더블클릭 토글이 "복원"이 아니라
// "다시 최대화"가 됐다.
//
// electron 에 붙어 있지 않다 — 좌표(DIP)만 받으므로 Windows 개발기에서 세 OS 를 단위 테스트로 함께 고정한다.

/**
 * 최대화된 창을 풀기 시작하는 끌기 거리(DIP). 누른 자리에서 가로나 세로로 이만큼 움직여야 끌기다.
 * Windows 기본 끌기 사각형(`SM_CXDRAG`·`SM_CYDRAG` = 4px)의 크기다 — 클릭하는 동안의 손떨림(1~2px)은
 * 넘지 못하고, 창을 끌려는 손은 첫 순간에 넘는다.
 */
export const TITLEBAR_RESTORE_DRAG_DIP = 4;

/** 누른 자리(`press`)에서 지금 커서(`cursor`)까지 문턱을 넘었는가 — 가로나 세로 어느 한쪽이면 된다. */
export function passedTitlebarDragThreshold(
  press: { x: number; y: number },
  cursor: { x: number; y: number },
  threshold = TITLEBAR_RESTORE_DRAG_DIP,
): boolean {
  return Math.abs(cursor.x - press.x) >= threshold || Math.abs(cursor.y - press.y) >= threshold;
}
