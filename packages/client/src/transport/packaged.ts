// Transport adapter — SCENARIO.md §3.7. 패키지 앱(Electron 셸)인가를 묻는 **부작용 없는** 판단.
//
// `./index.ts` 는 전역 전송 패치(`installPackagedTransport` — 실리는 순간 `window.WebSocket` 을 읽는다)를 함께 내보낸다. 소재 주소처럼
// 작은 모듈이 판단 하나 때문에 그 패치까지 끌어오지 않도록(노드 시험 환경에서는 실리는 순간 깨진다) 판단만 여기 둔다. `./index.ts` 도
// 이 함수를 쓴다(한 벌).
import type { PackagedApi } from './install-packaged-transport.js';

export function packagedApi(): PackagedApi | null {
  if (typeof window === 'undefined') return null;
  return window.api ?? null;
}

/** True when running inside our packaged Electron shell. */
export const isPackagedDesktop = (): boolean => packagedApi() !== null;
