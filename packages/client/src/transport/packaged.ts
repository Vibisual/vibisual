// §3.7 — 패키지 앱(Electron 셸)인가를 묻는 **부작용 없는** 판단. `./index.ts` 는 실리는 순간 `window.WebSocket` 을 읽는 전역 패치를 함께 내보내
// 노드 시험에서 깨지므로, 판단만 여기 둔다(`./index.ts` 도 이것을 쓴다).
import type { PackagedApi } from './install-packaged-transport.js';

export function packagedApi(): PackagedApi | null {
  if (typeof window === 'undefined') return null;
  return window.api ?? null;
}

/** True when running inside our packaged Electron shell. */
export const isPackagedDesktop = (): boolean => packagedApi() !== null;
