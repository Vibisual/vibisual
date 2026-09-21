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

import { DEBUG_ADAPTER_READY_TIMEOUT_MS, DEBUG_REQUEST_TIMEOUT_MS } from '@vibisual/shared';
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
export function fetchInspectorWebSocketUrl(port: number, timeoutMs = 3_000, signal?: AbortSignal): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const finish = (url: string | null): void => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      resolve(url);
    };
    const req = http.get(
      { host: '127.0.0.1', port, path: '/json/list', timeout: timeoutMs, signal },
      (res) => {
        // After headers arrive, reset/abort errors belong to IncomingMessage, not just req.
        res.on('error', () => finish(null));
        res.on('aborted', () => finish(null));
        res.on('close', () => finish(null));
        if (res.statusCode !== 200) {
          finish(null);
          // No target can be discovered from this response. Do not drain an unbounded
          // trickling error page after finish() has cleared the wall-clock deadline.
          req.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > 256 * 1024) {
            finish(null);
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (settled) return;
          try {
            const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const target = Array.isArray(parsed)
              ? parsed.find((t): t is InspectorTarget => t !== null && typeof t === 'object'
                && typeof t.webSocketDebuggerUrl === 'string') : undefined;
            finish(target?.webSocketDebuggerUrl ?? null);
          } catch {
            finish(null);
          }
        });
      },
    );
    const abort = (): void => { finish(null); req.destroy(); };
    req.on('timeout', abort);
    req.on('error', () => finish(null));
    // A trickling body must not keep discovery pending forever by resetting the idle timeout.
    deadline = setTimeout(abort, timeoutMs);
  });
}

export class CdpClient {
  private id = 1;
  private readonly pending = new Map<number, PendingCall>();
  private socket: WebSocket | null = null;
  private disposed = false;
  private discoveryAbort: AbortController | null = null;
  private rejectConnect: ((error: Error) => void) | null = null;

  constructor(
    private readonly onEvent: (event: CdpEvent) => void,
    private readonly onClosed: (reason: string) => void,
  ) {}

  /** 인스펙터 포트에 붙는다. 실패 사유는 그대로 던져 화면이 적게 한다. */
  async connect(port: number): Promise<void> {
    if (this.disposed) throw new Error('inspector disconnected');
    if (this.discoveryAbort || this.socket) throw new Error('inspector connection already started');
    this.discoveryAbort = new AbortController();
    let url: string | null;
    try {
      url = await fetchInspectorWebSocketUrl(port, 3_000, this.discoveryAbort.signal);
    } finally {
      this.discoveryAbort = null;
    }
    if (this.disposed) throw new Error('inspector disconnected');
    if (!url) throw new Error('inspector-not-listening');
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url, {
        maxPayload: 64 * 1024 * 1024,
        handshakeTimeout: DEBUG_ADAPTER_READY_TIMEOUT_MS,
      });
      this.socket = socket; // dispose must also own a socket whose handshake is still pending.
      this.rejectConnect = reject;
      let opened = false;
      socket.once('open', () => {
        if (this.disposed) return;
        opened = true;
        this.rejectConnect = null;
        resolve();
      });
      socket.on('message', (data) => {
        if (this.disposed) return;
        try { this.handleMessage(String(data)); } catch (err) {
          logger.warn('[cdp] message handler failed', err);
          this.handleClosed('inspector-message-error');
        }
      });
      socket.on('close', () => {
        if (opened) this.handleClosed('inspector-closed');
        else this.dispose('inspector-closed-before-open');
      });
      // Keep this listener through disposal: ws can emit a deferred error while aborting a handshake.
      socket.on('error', (err: Error) => {
        if (this.disposed) return;
        if (!opened) {
          this.rejectConnect?.(err);
          this.rejectConnect = null;
          this.dispose('inspector-error');
          return;
        }
        logger.warn(`[cdp] socket error: ${err.message}`);
        this.handleClosed('inspector-error');
      });
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
      const failed = (err: Error): void => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        reject(err);
      };
      try {
        socket.send(JSON.stringify({ id, method, ...(params ? { params } : {}) }), (err) => {
          if (err) failed(err);
        });
      } catch (err) {
        failed(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  dispose(reason: string): void {
    if (this.disposed) return;
    this.disposed = true;
    this.discoveryAbort?.abort();
    this.discoveryAbort = null;
    this.rejectConnect?.(new Error(reason));
    this.rejectConnect = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners('message');
      try { socket.close(); } catch { /* 이미 닫힘 */ }
    }
  }

  private handleClosed(reason: string): void {
    if (this.disposed) return;
    this.dispose(reason);
    try { this.onClosed(reason); } catch (err) { logger.warn('[cdp] close handler failed', err); }
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
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
