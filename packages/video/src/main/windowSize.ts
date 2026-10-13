/**
 * §5.13 (W) 38-1 — 숨은 창을 **화면보다 크게** 세운다(main 몫).
 *
 * 실측(Electron 31 · Windows · 작업 영역 1707×912 DIP): `new BrowserWindow({ width: 1920, height: 1080, useContentSize })` 는
 * 1707×912 로 줄어들고, `enableLargerThanScreen`·`offscreen:true` 로도 같았다. 그 창을 찍어 문서 크기로 늘이면 가로 영상은 오른쪽·
 * 아래가 잘리고 9:16 은 위 47% 만 남는다. **최대 크기를 연 뒤(`setMaximumSize`) 내용 크기를 다시 주면(`setContentSize`)** 청한
 * 크기 그대로 선다(1920×1080 · 1080×1920 모두 실측).
 *
 * mac 은 `enableLargerThanScreen` 이 같은 일을 한다(창을 만들 때 준다). 그래도 창 관리자가 거절하면(일부 리눅스 창 관리자 —
 * 실기 미확인) 실제 크기를 재서 **맞춤 배율**을 돌려준다 — 렌더 화면이 무대를 그 배율로 줄여 세우므로 잘리지는 않는다.
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
