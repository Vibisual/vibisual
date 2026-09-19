/**
 * 재연결 직후 **끊겨 있던 동안 놓친 것**을 다시 받는다 (`useWebSocket` 의 `onopen` 이 부른다).
 *
 * 새 연결이 받는 것은 ack + 전체 스냅샷뿐이다(서버 `buildConnectionMessages`). 그래프·상태는 그것으로
 * 돌아오지만, WS 로 한 번씩만 오는 두 가지는 다시 오지 않는다.
 *  ① 스트림 줄 — 버퍼 가운데가 빈 채 이어져 글이 중간에서 끊긴다(`components/IDE/streamResync.ts`).
 *  ② 권한 요청·질문 카드 — 끊긴 사이 걸린 카드가 없어 작업이 멈춘 것처럼 보인다(`utils/pendingPrompts.ts`).
 *
 * 부팅 첫 연결에는 부르지 않는다 — 그때는 창들이 마운트하면서 같은 것을 이미 받는다.
 */
import { resyncOpenStreams } from '../components/IDE/streamResync.js';
import { restorePendingPrompts } from '../utils/pendingPrompts.js';

export function resyncAfterReconnect(): void {
  restorePendingPrompts();
  resyncOpenStreams();
}
