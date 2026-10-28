/** §5.5 #17-20 ⑩ — 디버그 REST 응답 모양만 여기 적는다 — 서버 서비스를 import 하면 클라 번들에 `node:child_process` 가 딸려 온다. */
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
