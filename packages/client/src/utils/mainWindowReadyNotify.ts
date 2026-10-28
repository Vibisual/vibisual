/**
 * §3.7 · §9 「시작 화면(스플래시)」 — main 에 "본체 창이 첫 화면을 다 그렸다"를 보내는 한 줄.
 * 앱 스토어를 부르지 않는 따로 선 모듈이다 — 오류 경계(`AppErrorBoundary`)도 불러 복구 화면이 스플래시 뒤에 숨지 않게 한다. 언제 보낼지는 `mainWindowReady.ts` 가 정한다.
 * 본체 창이 아니거나 이미 보인 뒤면 main 이 무시한다. 웹 모드·구버전 preload 에서는 아무것도 하지 않는다.
 */
export function sendMainWindowReady(): void {
  try {
    void window.api?.lifecycle?.mainReady?.().catch(() => { /* 구버전 main — 그쪽 상한이 창을 보인다 */ });
  } catch { /* 웹 모드·구버전 preload */ }
}
