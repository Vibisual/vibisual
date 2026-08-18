/**
 * §5.5 #17-20 ⑩ v4.94 — Chrome DevTools Protocol 클라이언트(Node 계열 전용).
 *
 * Node 는 **런타임 자체가 인스펙터를 갖고 있다**(`--inspect-brk`). 그래서 이 백엔드만은
 * 사용자가 설치할 것이 하나도 없고, 라이선스 위험도 없다 — 우리가 하는 일은 이미 열려 있는
 * 인스펙터 포트에 WebSocket 으로 붙는 것뿐이다.
 *
 * 붙는 절차: `GET /json/list` 로 대상 목록을 받아 `webSocketDebuggerUrl` 을 얻고 그리로 연결.
 * (인스펙터는 `--inspect-brk` 로 **멈춰 서 있는 동안에도** 이 HTTP 창구를 연다 — 그래서
 * "붙기 전에 목록부터 확인" 이 가능하다.)
 */
import http from 'node:http';

import { DEBUG_REQUEST_TIMEOUT_MS } from '@vibisual/shared';
import { WebSocket } from 'ws';

import { logger } from '../../logger.js';

/** 인스펙터가 보낸 이벤트 한 건(`Debugger.paused` 등). */
export interface CdpEvent {
  method: string;
  params?: Record<string, unknown>;
}

interface PendingCall {
  resolve: (result: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** `/json/list` 응답 한 줄에서 우리가 쓰는 것만. */
interface InspectorTarget {
  webSocketDebuggerUrl?: string;
  type?: string;
}

/** 인스펙터 HTTP 창구에서 붙을 WebSocket 주소를 얻는다. 못 얻으면 null. */
export function fetchInspectorWebSocketUrl(port: number, timeoutMs = 3_000): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/json/list', timeout: timeoutMs },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          body += c;
          // 인스펙터 목록이 이만큼 클 리 없다 — 이상한 응답으로 메모리를 먹지 않게 끊는다.
          if (body.length > 256 * 1024) req.destroy();
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body) as InspectorTarget[];
            const target = parsed.find((t) => typeof t.webSocketDebuggerUrl === 'string');
            resolve(target?.webSocketDebuggerUrl ?? null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

export class CdpClient {
  private id = 1;
  private readonly pending = new Map<number, PendingCall>();
  private socket: WebSocket | null = null;
  private disposed = false;

  constructor(
    private readonly onEvent: (event: CdpEvent) => void,
    private readonly onClosed: (reason: string) => void,
  ) {}

  /** 인스펙터 포트에 붙는다. 실패 사유는 그대로 던져 화면이 적게 한다. */
  async connect(port: number): Promise<void> {
    const url = await fetchInspectorWebSocketUrl(port);
    if (!url) throw new Error('inspector-not-listening');
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url, { maxPayload: 64 * 1024 * 1024 });
      const failEarly = (err: Error): void => {
        socket.removeAllListeners();
        try { socket.close(); } catch { /* 이미 닫힘 */ }
        reject(err);
      };
      socket.once('open', () => {
        this.socket = socket;
        socket.on('message', (data) => this.handleMessage(String(data)));
        socket.on('close', () => this.handleClosed('inspector-closed'));
        socket.on('error', (err) => {
          logger.warn(`[cdp] socket error: ${err instanceof Error ? err.message : String(err)}`);
          this.handleClosed('inspector-error');
        });
        resolve();
      });
      socket.once('error', (err) => failEarly(err instanceof Error ? err : new Error(String(err))));
    });
  }

  /** 메서드 한 건 호출. 인스펙터가 error 로 답하면 그 메시지로 reject. */
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const socket = this.socket;
    if (this.disposed || !socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('inspector disconnected'));
    }
    const id = this.id++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`inspector timeout: ${method}`));
      }, DEBUG_REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, ...(params ? { params } : {}) }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  dispose(reason: string): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      try { socket.close(); } catch { /* 이미 닫힘 */ }
    }
  }

  private handleClosed(reason: string): void {
    if (this.disposed) return;
    this.dispose(reason);
    this.onClosed(reason);
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const msg = parsed as {
      id?: number;
      result?: Record<string, unknown>;
      error?: { message?: string };
      method?: string;
      params?: Record<string, unknown>;
    };

    if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? 'inspector returned error'));
      else p.resolve(msg.result ?? {});
      return;
    }

    if (typeof msg.method === 'string') {
      this.onEvent({ method: msg.method, ...(msg.params ? { params: msg.params } : {}) });
    }
  }
}

/**
 * §5.5 #17-20 ⑫ — **붙지 않고 그냥 진행시킨다.**
 *
 * `--inspect-brk` 는 "누가 붙을 때까지 첫 줄에서 정지" 라, 디버깅할 생각이 없는데 그렇게 뜬
 * 프로세스는 사용자 눈에 "켰는데 아무 일도 안 일어남" 으로 보인다. 종전에는 죽였다 다시 켜는
 * 수밖에 없었다. 붙었다가 한 마디만 하고 끊으면 프로세스는 그대로 달린다.
 */
export async function releaseWaitingNodeProcess(port: number): Promise<{ ok: boolean; error?: string }> {
  const client = new CdpClient(() => { /* 이벤트는 볼 필요가 없다 */ }, () => { /* 곧 끊는다 */ });
  try {
    await client.connect(port);
    await client.send('Runtime.runIfWaitingForDebugger');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    client.dispose('released');
  }
}
