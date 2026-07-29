// §4 v3.33 — 모바일 웹 접속 임베디드 터미널 브리지.
//
// 데스크톱은 `window.api.terminal` (Electron IPC)로 PTY 에 붙지만, 모바일 브라우저엔 그 API 가
// 없다. 대신 앱이 이미 열어둔 `/ws` WebSocket(useWebSocket)에 터미널 프레임을 다중화해 나른다.
// 이 싱글턴이 (a) useWebSocket 이 등록한 sender 로 제어 프레임(term_create/write/resize/kill)을
// 보내고, (b) 서버가 보낸 term_data/term_exit/term_ack/term_unavailable 프레임을 리스너로 분배한다.
//
// `getWsTerminalTransport()` 는 `PackagedTerminalApi` 와 같은 모양이라 IDETerminalView 가
// 데스크톱 IPC 와 동일한 인터페이스로 사용한다(호출부 분기 최소화).

import type { PackagedTerminalApi } from './install-packaged-transport.js';

interface WireFrame {
  type: string;
  payload: unknown;
  timestamp: number;
}

/** create 응답(ack/unavailable) 타임아웃 — 서버가 이 소켓을 지원하지 않으면(dev 웹 등) 소프트 실패. */
const CREATE_TIMEOUT_MS = 8000;

let sender: ((frame: WireFrame) => void) | null = null;
const dataListeners = new Set<(p: { termId: string; data: string }) => void>();
const exitListeners = new Set<(p: { termId: string; exitCode: number }) => void>();
const createWaiters = new Map<string, (r: { ok: boolean; error?: string }) => void>();

/** useWebSocket 이 open 시 등록, close 시 null 로 해제한다. */
export function registerTerminalWsSender(fn: ((frame: WireFrame) => void) | null): void {
  sender = fn;
}

/** useWebSocket onmessage 가 `term_*` 프레임을 이리로 넘긴다. 처리했으면 true. */
export function dispatchTerminalFrame(msg: { type: string; payload?: unknown }): boolean {
  switch (msg.type) {
    case 'term_data': {
      const p = msg.payload as { termId: string; data: string };
      if (p && typeof p.termId === 'string') dataListeners.forEach((l) => l(p));
      return true;
    }
    case 'term_exit': {
      const p = msg.payload as { termId: string; exitCode: number };
      if (p && typeof p.termId === 'string') exitListeners.forEach((l) => l(p));
      return true;
    }
    case 'term_ack': {
      const p = msg.payload as { termId: string; ok: boolean; error?: string };
      settleCreate(p?.termId, { ok: !!p?.ok, error: p?.error });
      return true;
    }
    case 'term_unavailable': {
      const p = msg.payload as { termId: string; reason: string };
      // 외부(인터넷) 접속 — 셸 차단. create 를 external-blocked 로 실패 확정(뷰가 안내 표시).
      settleCreate(p?.termId, { ok: false, error: 'external-blocked' });
      return true;
    }
    default:
      return false;
  }
}

function settleCreate(termId: string | undefined, result: { ok: boolean; error?: string }): void {
  if (!termId) return;
  const w = createWaiters.get(termId);
  if (w) { createWaiters.delete(termId); w(result); }
}

function send(type: string, payload: unknown): void {
  sender?.({ type, payload, timestamp: Date.now() });
}

export function getWsTerminalTransport(): PackagedTerminalApi {
  return {
    create: (spec) =>
      new Promise((resolve) => {
        if (!sender) { resolve({ ok: false, error: 'no-connection' }); return; }
        createWaiters.set(spec.termId, resolve);
        send('term_create', spec);
        setTimeout(() => {
          if (createWaiters.has(spec.termId)) {
            createWaiters.delete(spec.termId);
            resolve({ ok: false, error: 'timeout' });
          }
        }, CREATE_TIMEOUT_MS);
      }),
    write: (termId, data) => { send('term_write', { termId, data }); return Promise.resolve(); },
    resize: (termId, cols, rows) => { send('term_resize', { termId, cols, rows }); return Promise.resolve(); },
    kill: (termId) => { send('term_kill', { termId }); return Promise.resolve(); },
    onData: (cb) => { dataListeners.add(cb); return () => { dataListeners.delete(cb); }; },
    onExit: (cb) => { exitListeners.add(cb); return () => { exitListeners.delete(cb); }; },
  };
}
