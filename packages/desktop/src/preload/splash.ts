// SCENARIO.md §3.7 · §9 「시작 화면(스플래시)」 — 스플래시 창 전용 preload. 하는 일은 하나다: main 이 넘겨 주는
// 메시지 포트를 받아 문서에 진척을 흘려보낸다.
//
// 왜 포트인가 — 본체가 프로젝트를 복원하는 동안 main 의 메인 스레드는 붙잡혀 있다. 그동안 `executeJavaScript` 로
// 보낸 갱신은 붙잡힘이 풀릴 때 **한꺼번에** 닿았고(실측: 1.5초 동안 보낸 다섯 칸이 전부 +1500ms 에 도착), 메시지
// 포트로 보낸 것은 **보낸 그 순간** 닿았다(0·300·600·900·1200ms). 그래서 스플래시는 포트로만 받는다.
//
// 샌드박스 preload 라 'electron' 밖의 모듈을 부를 수 없다 — 이 파일은 아무것도 더 import 하지 않는 한 덩어리여야 한다.
// 채널 이름 정본은 main 의 `splashWindow.ts`(`SPLASH_PORT_CHANNEL`) — 바꾸면 양쪽을 함께 고친다(시험이 지킨다).

import { contextBridge, ipcRenderer } from 'electron';

type SplashListener = (view: unknown) => void;

/** 문서가 듣기 시작하기 전에 온 소식(첫 칠 직후의 몇 칸). 오래된 것부터 버린다 — 마지막 장면이 이긴다. */
const BACKLOG_MAX = 32;
const backlog: unknown[] = [];
let listener: SplashListener | null = null;

ipcRenderer.once('vibisual:splash:port', (event) => {
  const port = event.ports[0];
  if (!port) return;
  port.onmessage = (message: MessageEvent): void => {
    if (listener) {
      listener(message.data);
      return;
    }
    backlog.push(message.data);
    if (backlog.length > BACKLOG_MAX) backlog.shift();
  };
  port.start();
});

contextBridge.exposeInMainWorld('vibSplash', {
  /** 한 번만 건다 — 두 번째 부름은 무시한다(문서 하나에 듣는 쪽은 하나다). */
  onUpdate(cb: SplashListener): void {
    if (typeof cb !== 'function' || listener) return;
    listener = cb;
    for (const view of backlog.splice(0)) cb(view);
  },
});
