// §4 v3.33 — 임베디드 터미널 transport 선택기.
//
// 데스크톱(패키지/preview Electron) = `window.api.terminal` (IPC). 모바일 웹 접속(§4 v3.16,
// `window.api` 부재) = `/ws` 브리지 폴백. 둘 다 없으면(dev 웹 standalone 등) null → 뷰가 안내만.
//
// IDETerminalView 는 `window.api?.terminal` 직접참조 대신 이 함수를 써 데스크톱/모바일을 한 코드로.

import type { PackagedTerminalApi } from './install-packaged-transport.js';
import { getWsTerminalTransport } from './mobileTerminalBridge.js';

export function getTerminalTransport(): PackagedTerminalApi | null {
  if (typeof window === 'undefined') return null;
  // 데스크톱 — Electron preload 가 노출한 IPC 터미널 우선.
  if (window.api?.terminal) return window.api.terminal;
  // 모바일 웹(window.api 자체가 없음) — /ws 브리지 폴백. 서버(mobileAccess)가 지원하면 동작하고,
  // 미지원 환경(dev 웹)에선 create 가 타임아웃으로 소프트 실패한다.
  if (!window.api) return getWsTerminalTransport();
  return null;
}
