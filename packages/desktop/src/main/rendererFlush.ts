/**
 * rendererFlush.ts — 종료 직전 렌더러 초안 flush 의 **electron 배선부**.
 * 판정·상한·회차 규약은 전부 `rendererFlushPlan.ts`(순수)에 있다 — 여기는 창 목록·IPC·세션만 맡는다.
 *
 * 순서가 중요하다:
 *   ① 모든 창에 flush 요청 → ② 응답을 (상한 안에서) 모음 → ③ `session.flushStorageData()`
 *
 * ③ 이 빠지면 반쪽이다. 렌더러의 `localStorage.setItem` 은 JS 관점에서만 동기이고 Chromium 은
 * 실제 디스크 커밋을 **뒤로 미룬다**. 우리 종료는 `app.exit(0)` 이라 그 커밋을 기다려 주지 않으므로,
 * 창이 "썼다"고 답한 뒤에도 디스크에는 없을 수 있다. `flushStorageData()` 가 그 미완의 DOMStorage 를
 * 지금 디스크에 앉힌다. 모든 창이 `session.defaultSession` 하나를 쓰므로(커스텀 partition ❌)
 * 이 한 번으로 별창·오버레이·지휘통제실·내부 앱 창까지 전부 덮인다.
 */
import { BrowserWindow, ipcMain, session } from 'electron';
import {
  FLUSH_DRAFTS_REQUEST_CHANNEL,
  FLUSH_DRAFTS_DONE_CHANNEL,
  FLUSH_DRAFTS_TIMEOUT_MS,
  collectFlushAcks,
  type FlushAckResult,
  type FlushAckTarget,
} from './rendererFlushPlan';

/** 회차 번호(규약 2) — 지난 회차의 늦은 응답이 이번 회차를 앞당겨 끝내지 못하게. */
let requestSeq = 0;

/** 지금 살아 있어 요청을 받을 수 있는 창들. */
function liveTargets(): FlushAckTarget[] {
  const out: FlushAckTarget[] = [];
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const wc = win.webContents;
    if (wc.isDestroyed() || wc.isCrashed()) continue;
    out.push({
      id: wc.id,
      send: (requestId: number) => wc.send(FLUSH_DRAFTS_REQUEST_CHANNEL, { requestId }),
    });
  }
  return out;
}

/**
 * 열려 있는 모든 창에 "지금 초안을 밀어라"를 보내고 응답을 기다린 뒤, DOMStorage 를 디스크에 앉힌다.
 *
 * **종료를 막지 않는다** — 상한(`FLUSH_DRAFTS_TIMEOUT_MS`)을 넘기면 받은 만큼만 들고 나가고,
 * 어떤 실패에서도 reject 하지 않는다(호출부의 `Promise.all` 이 이 하나 때문에 끊기면 안 된다).
 */
export async function flushRendererDrafts(timeoutMs = FLUSH_DRAFTS_TIMEOUT_MS): Promise<FlushAckResult> {
  const requestId = (requestSeq += 1);
  let result: FlushAckResult = { requested: 0, acked: 0, failed: 0, timedOut: false };

  try {
    result = await collectFlushAcks({
      targets: liveTargets(),
      requestId,
      timeoutMs,
      subscribe: (onAck) => {
        const listener = (event: Electron.IpcMainEvent, payload: unknown): void => {
          // payload 는 숫자 하나(회차 번호). 모양이 다르면 무시한다 — 남의 메시지를 답으로 세지 않는다.
          if (typeof payload !== 'number') return;
          onAck(event.sender.id, payload);
        };
        ipcMain.on(FLUSH_DRAFTS_DONE_CHANNEL, listener);
        return () => ipcMain.removeListener(FLUSH_DRAFTS_DONE_CHANNEL, listener);
      },
    });
  } catch (err) {
    console.warn('[main] flushRendererDrafts: ack collection failed:', err);
  }

  // ③ 렌더러가 쓴 DOMStorage 를 지금 디스크에 앉힌다. app.exit(0) 은 기다려 주지 않는다.
  try {
    session.defaultSession.flushStorageData();
  } catch (err) {
    console.warn('[main] flushRendererDrafts: flushStorageData failed:', err);
  }

  if (result.timedOut) {
    console.warn(
      `[main] flushRendererDrafts: ${result.acked}/${result.requested} window(s) acked within ${timeoutMs}ms — exiting anyway`,
    );
  }
  return result;
}
