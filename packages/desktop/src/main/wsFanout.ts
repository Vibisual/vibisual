/**
 * wsFanout.ts — `setBroadcastSink` 의 창 팬아웃 **집행부**(electron 에 닿는 쪽).
 *
 * 판정(1회 인코딩 · detach 방지 버퍼 확보 · 폴백)은 전부 `snapshotWire.ts` 에 있다.
 * 여기 남는 건 electron 에만 있는 세 가지다 — 창 열거, `webContents.postMessage`, 능력 신고 수신.
 * 이렇게 갈라야 판정을 실기 없이 단위 테스트로 고정할 수 있다(`chat/policy.ts` 와 같은 이유).
 *
 * 창 종류를 가리지 않는다: 메인 창·별창(`windowManager.ts`)·버블 오버레이·지휘통제실이 전부
 * `BrowserWindow.getAllWindows()` 한 벌로 같은 길을 탄다.
 */
import { BrowserWindow, ipcMain, type WebContents } from 'electron';
import {
  WS_BUFFER_CHANNEL,
  WS_BUFFER_READY_CHANNEL,
  WS_OBJECT_CHANNEL,
  fanoutWire,
  type WireTarget,
} from './snapshotWire';

/**
 * 바이트 채널을 안다고 **신고한** webContents 의 id 집합.
 *
 * 신고가 없으면 그 창엔 종전 경로로 보낸다. 낙관적으로 쏘지 않는 이유는 `snapshotWire.ts` 의
 * `WS_BUFFER_READY_CHANNEL` 주석에 적어 두었다 — `postMessage` 는 리스너가 없어도 던지지 않고
 * 조용히 사라지므로, 그 실패는 감지할 방법이 없다.
 */
/**
 * §9 — **바이트(ArrayBuffer) 팬아웃의 스위치. 기본 `false` 다 — 켜지 마라, 이미 재봤다.**
 *
 * 이 경로는 "대용량 IPC 는 `postMessage` + Transferable 로 옮겨 복사를 없애라"는 2026 Electron
 * 권고를 따라 지었다. 그런데 **우리 자리에서는 그 권고가 성립하지 않는다.** 근거 둘 다 실측·소스다:
 *
 * ① **ArrayBuffer 는 Electron 에서 transfer 대상이 아니다.** `webContents.postMessage` 의 서명이
 *    `transfer?: MessagePortMain[]`(electron 31.7.7 `electron.d.ts:16180`) 라 버퍼는 넘길 수 없고,
 *    결국 *복사*된다. 무복사라는 이 경로의 존재 이유 자체가 없다. (그 권고는 브라우저의
 *    `Worker.postMessage`/`window.postMessage` 얘기다 — 거긴 ArrayBuffer 를 정말 넘긴다.)
 *
 * ② **바이트를 만들려면 `JSON.stringify` 를 한 번 부르는데, 그게 구조화 클론보다 비싸다.**
 *    실측(2026-09-02 · 살아 있는 checkpoint 의 733KB 스냅샷 · node 22 = V8 12.4, Electron 31 = V8 12.6):
 *
 *      JSON.stringify(obj)   2.39 ms      v8.serialize(obj)     1.41 ms
 *      v8.serialize(string)  0.25 ms      v8.serialize(buffer)  0.13 ms
 *
 *    깊은 객체의 `v8::ValueSerializer` 는 이진 포맷이라 문자열 이스케이프·숫자 포맷팅이 없다.
 *    그래서 메인 스레드 비용이 **객체 1.41ms vs 바이트 3.0ms** 로 뒤집힌다 — `stringify` 를 한 번
 *    부르는 순간 진 싸움이고, 뒤에 무엇을 얹어도(TextEncoder·slice·postMessage) 만회가 안 된다.
 *    "깊은 클론은 비싸고 문자열은 memcpy" 라던 §9 v3.40 주석의 전제는 지금 V8 에서는 틀렸다.
 *
 * 그래서 코드는 남기되 **끈다.** 남기는 이유는 Electron 이 나중에 버퍼 transfer 를 열면 ①이
 * 사라지고, 그때 이 스위치 한 줄로 되살릴 수 있기 때문이다. 지우면 다음 사람이 같은 권고를 읽고
 * 처음부터 다시 짓는다 — 그 하루를 아끼려고 이 주석이 있다.
 *
 * ⚠ 다시 켤 생각이면 **위 표를 그때의 V8 로 다시 재라.** 숫자가 뒤집히지 않는 한 답은 그대로다.
 */
const BYTE_FANOUT_ENABLED = false;

const bufferCapable = new Set<number>();

let registered = false;

/**
 * 능력 신고 수신을 연다. **창이 하나라도 생기기 전에** 불러야 한다 — preload 는 로드되자마자
 * 신고하므로, 리스너가 늦게 붙으면 그 신고를 놓쳐 그 창은 영영 종전 경로로만 다닌다.
 * (`bootBackend()` 가 `createWindow()` 보다 먼저 await 되므로 거기서 부른다.)
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
    if (!wc || wc.isDestroyed()) continue;
    targets.push(targetFor(wc));
  }
  return fanoutWire(msg, targets).json;
}
