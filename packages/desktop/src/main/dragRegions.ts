/**
 * dragRegions.ts — **창이 돌아올 때 "여기를 잡으면 움직인다"를 다시 신고하게 만드는 계기.**
 *
 * OS 가 아는 드래그 영역(`-webkit-app-region: drag`)은 CSS 가 아니라 **렌더러가 신고한 사각형
 * 목록**이고, Chromium 은 그 목록이 **달라졌을 때만** 브라우저 프로세스로 보낸다. 창이 숨었다
 * 돌아오는 사이 그 신고를 한 번 놓치면 타이틀바는 정적이라 다시 신고할 계기가 영영 오지 않아,
 * CSS 는 그대로인데 **OS 만 모르는** 상태로 굳는다(사용자 보고 — "최소화하거나 앱이 새로 켜지면
 * 간헐적으로 헤더를 잡고 못 옮긴다").
 *
 * 그래서 main 이 창 상태 전이를 그 창에 알려 주고, 렌더러가 그때 영역을 한 번 흔들어 신고한다.
 * 실제 토글과 판정은 클라이언트가 갖는다(`utils/dragRegionRefresh.ts`) — 여기는 **언제 알릴지**만.
 *
 * ⚠ `move`·`resize` 는 일부러 목록에 없다.
 *   - `resize` 는 레이아웃이 실제로 바뀌므로 Chromium 이 알아서 새 목록을 보낸다.
 *   - `move` 는 **창을 끌고 있는 그 순간**에 쏟아진다 — 그때 영역을 흔들면 고치려는 바로 그
 *     손짓을 우리가 방해한다.
 */

import type { BrowserWindow } from 'electron';

/** main → renderer: "지금 드래그 영역을 다시 신고해라." payload 없음(계기 자체가 전부다). */
export const DRAG_REGIONS_REFRESH_CHANNEL = 'vibisual:window:drag-regions-refresh';

/**
 * 신고를 다시 시키는 창 상태 전이들.
 *
 * `restore` 가 이 목록의 이유다 — 최소화 복원은 창 크기가 그대로라 레이아웃이 바뀌지 않고,
 * 환경에 따라 렌더러의 `visibilitychange` 도 뜨지 않는다(그래서 렌더러 쪽 계기만으로는 부족하다).
 */
export const DRAG_REGION_WINDOW_EVENTS = [
  'show',
  'restore',
  'maximize',
  'unmaximize',
  'enter-full-screen',
  'leave-full-screen',
  'focus',
] as const;

export type DragRegionWindowEvent = (typeof DRAG_REGION_WINDOW_EVENTS)[number];

/** 이 배선이 창에게 실제로 묻는 것 — 테스트가 스텁 하나로 전체를 확인할 수 있게 좁혀 둔다. */
interface DragRegionWindowLike {
  isDestroyed(): boolean;
  on(event: string, listener: () => void): unknown;
  webContents: {
    isDestroyed(): boolean;
    send(channel: string): void;
  };
}

/**
 * 이 창의 상태 전이마다 렌더러에 재신고를 요청한다.
 *
 * **표시 전용이라 어떤 실패도 삼킨다** — 창이 죽는 중이거나 webContents 가 먼저 사라진 경우가
 * 정상 경로에 있고, 그때 던지면 창 정리가 그 예외로 끊긴다.
 */
export function keepDragRegionsFresh(win: BrowserWindow): void {
  const target = win as unknown as DragRegionWindowLike;
  const ping = (): void => {
    try {
      if (target.isDestroyed() || target.webContents.isDestroyed()) return;
      target.webContents.send(DRAG_REGIONS_REFRESH_CHANNEL);
    } catch { /* 죽는 중인 창 — 알릴 상대가 없다 */ }
  };
  for (const event of DRAG_REGION_WINDOW_EVENTS) {
    try {
      target.on(event, ping);
    } catch { /* 이 플랫폼에 없는 전이(전체화면 등) — 나머지 계기로 간다 */ }
  }
}
