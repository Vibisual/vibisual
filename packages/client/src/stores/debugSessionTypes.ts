/**
 * §5.5 #17-20 ⑩ v4.94 — 클라이언트가 보는 디버그 REST 응답 모양.
 *
 * `DebugAdapterAvailability` 는 서버가 조회해서 만드는 것이라 shared 타입이 아니다(브라우저는
 * PATH 를 훑을 수 없다). 그래서 전선 모양만 여기에 적어 둔다 — 서버 서비스를 import 하면
 * 클라 번들에 `node:child_process` 가 딸려 들어온다.
 */
import type { DebugBackendKind, RunRuntime } from '@vibisual/shared';

/** `GET /api/debug/adapters` 의 한 줄. */
export interface DebugAdapterAvailabilityWire {
  runtime: RunRuntime;
  backend: DebugBackendKind;
  available: boolean;
  execPath?: string;
  licence: string;
  installKey: string;
  docsUrl: string;
}

/** `POST /api/debug/control` 이 받는 조작. */
export type DebugControlActionWire = 'continue' | 'pause' | 'stepOver' | 'stepIn' | 'stepOut';
