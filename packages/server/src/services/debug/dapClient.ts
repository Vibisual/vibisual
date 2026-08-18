/**
 * §5.5 #17-20 ⑩ v4.94 — Debug Adapter Protocol 클라이언트.
 *
 * DAP 는 규격 자체가 MIT 라 우리가 클라이언트를 직접 써도 되고, 그러면 **어댑터를 갈아 끼우는
 * 것만으로** 언어가 늘어난다(debugpy·Delve·CodeLLDB·netcoredbg …). 여기서 하는 일은 두 가지뿐:
 *
 *   1. `Content-Length: N\r\n\r\n<json>` 프레이밍을 읽고 쓴다.
 *   2. `seq` 로 요청과 응답을 짝지어 주고, 짝이 없는 것은 이벤트로 올린다.
 *
 * 전송로(stdio 인지 TCP 인지)는 **모른다** — 바이트를 넣어 주는 쪽(`feed`)과 내보내는 쪽
 * (`write`)을 생성자가 받는다. 그래야 같은 클래스가 두 transport 를 다 탄다.
 */
import { DEBUG_REQUEST_TIMEOUT_MS } from '@vibisual/shared';

import { logger } from '../../logger.js';

/** 어댑터가 보낸 이벤트 한 건(`stopped`·`output`·`terminated` 등). */
export interface DapEvent {
  event: string;
  body?: Record<string, unknown>;
}

interface PendingRequest {
  resolve: (body: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 헤더와 본문을 가르는 빈 줄. */
const HEADER_SEPARATOR = '\r\n\r\n';

export class DapClient {
  private seq = 1;
  private buffer = '';
  private readonly pending = new Map<number, PendingRequest>();
  private disposed = false;

  constructor(
    private readonly write: (payload: string) => void,
    private readonly onEvent: (event: DapEvent) => void,
  ) {}

  /** 전송로에서 온 바이트를 넣는다. 프레임이 완성될 때마다 꺼내 처리한다. */
  feed(chunk: string): void {
    if (this.disposed) return;
    this.buffer += chunk;
    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_SEPARATOR);
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        // 우리가 모르는 헤더 — 그 프레임만 버리고 다음으로 넘어간다(전체 스트림을 죽이지 않는다).
        this.buffer = this.buffer.slice(headerEnd + HEADER_SEPARATOR.length);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + HEADER_SEPARATOR.length;
      if (this.buffer.length < bodyStart + length) return; // 아직 덜 왔다
      const body = this.buffer.slice(bodyStart, bodyStart + length);
      this.buffer = this.buffer.slice(bodyStart + length);
      this.handleMessage(body);
    }
  }

  /** 요청 한 건. 응답이 오면 `body` 를, 어댑터가 실패로 답하면 그 메시지로 reject 한다. */
  request(command: string, args?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.disposed) return Promise.reject(new Error('adapter disconnected'));
    const seq = this.seq++;
    const payload = JSON.stringify({ seq, type: 'request', command, ...(args ? { arguments: args } : {}) });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`adapter timeout: ${command}`));
      }, DEBUG_REQUEST_TIMEOUT_MS);
      this.pending.set(seq, { resolve, reject, timer });
      try {
        this.write(`Content-Length: ${Buffer.byteLength(payload, 'utf8')}${HEADER_SEPARATOR}${payload}`);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(seq);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** 남은 요청을 전부 깨우고 더 이상 받지 않는다. */
  dispose(reason: string): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
    this.buffer = '';
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn('[dap] unparsable frame dropped');
      return;
    }
    const msg = parsed as {
      type?: string;
      request_seq?: number;
      success?: boolean;
      message?: string;
      body?: Record<string, unknown>;
      event?: string;
    };

    if (msg.type === 'response' && typeof msg.request_seq === 'number') {
      const p = this.pending.get(msg.request_seq);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.request_seq);
      if (msg.success === false) p.reject(new Error(msg.message ?? 'adapter returned failure'));
      else p.resolve(msg.body ?? {});
      return;
    }

    if (msg.type === 'event' && typeof msg.event === 'string') {
      this.onEvent({ event: msg.event, ...(msg.body ? { body: msg.body } : {}) });
    }
    // `type === 'request'`(역방향 요청 — runInTerminal 등)는 지원 대상이 아니다.
    // 우리는 이미 떠 있는 프로세스에 붙기만 하므로 어댑터가 프로세스를 띄울 일이 없다.
  }
}
