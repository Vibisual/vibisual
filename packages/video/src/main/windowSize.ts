/**
 * §5.13 (W) 38-1 — 숨은 창을 화면보다 크게 세운다(main). 실측(Electron 31·Windows): 1920×1080 을 청하면 작업 영역 1707×912 로 줄고
 * `enableLargerThanScreen`·`offscreen:true` 로도 같다. `setMaximumSize` 뒤 `setContentSize` 를 다시 주면 청한 크기로 선다(1920×1080·1080×1920 실측).
 * mac 은 `enableLargerThanScreen` 이 같은 일을 한다. 창 관리자가 거절하면(일부 리눅스, 실기 미확인) 맞춤 배율을 돌려줘 줄여 세운다(잘리지 않게).
 */
import type { BrowserWindow } from 'electron';

/** 이 크기로 세우고, 실제로 선 내용 크기와 맞춤 배율(1 이하)을 돌려준다. */
export function growWindowToContent(win: BrowserWindow, width: number, height: number, maxEdge: number): { width: number; height: number; fit: number } {
  try {
    win.setMaximumSize(maxEdge, maxEdge);
    win.setContentSize(width, height);
  } catch {
    // 창이 이미 닫혔으면 아래에서 0 으로 잰다.
  }
  const [cw = 0, ch = 0] = win.isDestroyed() ? [0, 0] : win.getContentSize();
  return { width: cw, height: ch, fit: fitScale(width, height, cw, ch) };
}

/** 청한 크기 대비 실제 크기의 맞춤 배율(순수). 둘 다 넉넉하면 1. 잴 수 없으면 1(종전과 같게). */
export function fitScale(wantW: number, wantH: number, gotW: number, gotH: number): number {
  if (!(wantW > 0) || !(wantH > 0) || !(gotW > 0) || !(gotH > 0)) return 1;
  const s = Math.min(1, gotW / wantW, gotH / wantH);
  // 반올림 한 픽셀(1921 처럼 넘치거나 1919 처럼 모자란 것)은 맞춤으로 보지 않는다.
  return s > 1 - 2 / Math.max(wantW, wantH) ? 1 : Math.floor(s * 10_000) / 10_000;
}
