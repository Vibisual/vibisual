// SCENARIO.md §5.5 #17-6 (H-15) — 선 걷기 부탁은 판이 다시 돌아도 살아남는다. 효과 cleanup 에 매지 마라 — 두 프레임 안에 효과가 다시 돌면(`agent` 는 스냅샷마다 새 객체)
// 예약이 취소되고 짐(`takePaneDragResume`)은 이미 비어 윤곽선이 커서에 남는다. 늦게 걷기는 안전하지만 안 걷기는 아니다.

/**
 * 두 프레임 뒤 윤곽선 걷기를 부탁한다(취소 불가) — 직전에 옮긴 창이 그려지기 전에 걷으면 한 프레임이 빈다.
 * 여러 번 불러도 안전하다(`hidePopOutGhost` 는 없는 선을 지나친다). 오버레이 IPC 가 없으면 아무 일도 안 한다.
 */
export function scheduleGhostHide(): void {
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      void window.api?.overlay?.ghostHide?.();
    });
  });
}
