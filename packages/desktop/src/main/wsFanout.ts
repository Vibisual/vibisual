/**
 * `setBroadcastSink` 창 팬아웃의 electron 쪽(창 열거·`postMessage`·능력 신고 수신). 판정은 전부 `snapshotWire.ts` — 실기 없이 시험하려고 갈랐다.
 * 모든 창(메인·별창·오버레이·지휘통제실)이 `BrowserWindow.getAllWindows()` 한 벌로 같은 길을 탄다.
 */
import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import { isVerificationWindow } from './verificationWindows';
import {
  WS_BUFFER_CHANNEL,
  WS_BUFFER_READY_CHANNEL,
  WS_OBJECT_CHANNEL,
  fanoutWire,
  type WireTarget,
} from './snapshotWire';

/**
 * 바이트 채널을 안다고 신고한 webContents id. 신고가 없으면 바이트를 보내지 않는다 — `postMessage` 는 리스너가 없어도 조용히 사라져
 * 실패를 감지할 수 없다(`snapshotWire.ts` `WS_BUFFER_READY_CHANNEL`).
 */
/**
 * §9 — 바이트(ArrayBuffer) 팬아웃 스위치. **기본 `false` — 켜지 마라, 이미 재봤다.** ① Electron `postMessage` 의 transfer 는 `MessagePortMain[]` 뿐
 * (31.7.7 `electron.d.ts:16180`)이라 버퍼는 복사된다. ② 바이트엔 `JSON.stringify` 가 드는데 구조화 클론보다 비싸다 — 실측(2026-09-02 · 733KB · V8 12.4/12.6):
 * stringify 2.39ms · v8.serialize(obj) 1.41ms → 객체 1.41ms vs 바이트 3.0ms. Electron 이 버퍼 transfer 를 열면 이 한 줄로 되살린다 — 그때의 V8 로 다시 재라.
 */
const BYTE_FANOUT_ENABLED = false;

const bufferCapable = new Set<number>();

let registered = false;

/**
 * 능력 신고 수신을 연다 — 창이 생기기 전에 불러야 한다(preload 는 로드되자마자 신고해, 늦게 붙으면 그 창은 영영 바이트 경로를 못 탄다).
 * `bootBackend()` 가 `createWindow()` 보다 먼저 await 되므로 거기서 부른다.
 */
export function initWsFanout(): void {
  if (registered) return;
  registered = true;
  ipcMain.on(WS_BUFFER_READY_CHANNEL, (event) => {
    const wc = event.sender;
    if (wc.isDestroyed()) return;
    bufferCapable.add(wc.id);
    // 창이 죽으면 id 를 지운다 — webContents id 는 재사용되므로 남겨 두면 새 창이 신고도 없이
    // "바이트를 아는 창"으로 오인될 수 있다.
    wc.once('destroyed', () => {
      bufferCapable.delete(wc.id);
    });
  });
}

function targetFor(wc: WebContents): WireTarget {
  return {
    id: wc.id,
    canPost: BYTE_FANOUT_ENABLED && bufferCapable.has(wc.id),
    post: (buffer) => {
      wc.postMessage(WS_BUFFER_CHANNEL, buffer);
    },
    send: (payload) => {
      wc.send(WS_OBJECT_CHANNEL, payload);
    },
  };
}

/**
 * 살아 있는 모든 창에 메시지를 팬아웃한다.
 *
 * @returns 이번 팬아웃에서 만든 JSON 문자열(창이 0개거나 인코딩 실패면 null).
 *   모바일 LAN 팬아웃이 이 값을 그대로 재사용해 **스냅샷을 두 번 직렬화하지 않는다.**
 */
export function broadcastToWindows(msg: unknown): string | null {
  const targets: WireTarget[] = [];
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const wc = win.webContents;
    // 창은 살아 있는데 webContents 만 먼저 죽는 찰나가 있다 — 거기서 send 는 던진다.
    if (!wc || wc.isDestroyed() || isVerificationWindow(wc.id)) continue;
    targets.push(targetFor(wc));
  }
  return fanoutWire(msg, targets).json;
}
