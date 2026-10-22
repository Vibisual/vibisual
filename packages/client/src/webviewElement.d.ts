/**
 * §5.23 「더블클릭」 — Electron `<webview>` 태그를 JSX 에 알린다.
 *
 * 인터넷 페이지는 본체 렌더러의 iframe 에 싣지 않고 격리 웹뷰로 띄운다(`PreviewFrames` 의 `web`). 렌더러가 적는 속성은
 * 처음 열 주소(`src`)와 세션 이름(`partition`)뿐이고, 손님 설정(샌드박스·preload 없음·권한 거절)은 main 의
 * `will-attach-webview` 가 다시 쓴다(`desktop/src/main/webPageView.ts`) — 여기서 그 밖의 속성을 열어 두지 않는다.
 */
declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string;
      partition?: string;
    };
  }
}
