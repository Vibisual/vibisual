import { WEB_OPEN_TARGETS, WEB_OPEN_TARGET_DEFAULT } from './constants.js';
import type { WebOpenTarget } from './types.js';

/**
 * §5.23 「더블클릭」 — 저장·전송된 "여는 곳" 값을 정규화한다. 모르는 값·빠진 값은 기본(바깥 브라우저).
 * 서버 저장(`AppState.webOpenTarget`)·PUT 본문·WS 방송·클라 스토어가 이 한 곳을 지난다.
 */
export function normalizeWebOpenTarget(raw: unknown): WebOpenTarget {
  return WEB_OPEN_TARGETS.find((target) => target === raw) ?? WEB_OPEN_TARGET_DEFAULT;
}
