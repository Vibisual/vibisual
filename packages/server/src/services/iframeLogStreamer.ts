/**
 * IframeLogStreamer — §7.11 v1.44 / v2.5 iframe 버블의 dev server 로그 라이브 스트리밍.
 *
 * Lazy pub/sub 모델: `(shellId, port)` 구독자가 0→1 될 때만 매칭 ServerEntry.outputFile 을
 * 1500ms 주기 tail 하고 ring buffer(200줄) + 50ms 마이크로배치로 push.
 * 구독자 1→0 이면 타이머 해제 + 버퍼 폐기 → 메모리 0.
 *
 * 스트림 식별자는 `port` 단독이 아니라 `(shellId, port)` (§7.11 v2.5) — 다른 프로젝트의
 * dev server 가 같은 포트(Vite 기본 5173 등)를 써도 셸이 다르면 스트림이 분리된다.
 * `shellId` 없는 레거시 위성은 `port` 단독 키로 후방호환.
 *
 * BackgroundShellWatcher 와 같은 파일을 읽지만 목적이 다름(포트 탐지 vs 라인 스트리밍)
 * 이므로 별도 tail 루프를 돌리고 결과를 공유하지 않는다. 스트리머는 "사용자가 보고 있을 때만" 동작.
 */
import fs from 'node:fs';
import type { WebSocket } from 'ws';
import {
  IFRAME_LOG_SERVER_BUFFER_MAX,
  IFRAME_LOG_POLL_INTERVAL_MS,
  IFRAME_LOG_BATCH_MS,
  IFRAME_LOG_TAIL_BYTES,
} from '@vibisual/shared';
import type {
  IframeLogLine,
  IframeLogInitPayload,
  IframeLogAppendPayload,
  IframeLogLevel,
  WSMessage,
} from '@vibisual/shared';
import { stripAnsi } from './backgroundShellWatcher.js';
import { logger } from '../logger.js';

/** WebSocket.OPEN = 1 (ws 모듈 상수를 import 하지 않기 위해 리터럴 사용) */
const WS_OPEN = 1 as const;

/** 구독 식별자 `(port, shellId)` → 안정 Map 키. shellId 없으면 port 단독. */
function streamKey(port: number, shellId?: string): string {
  return shellId ? `${shellId}#${port}` : `#${port}`;
}

/** (port, shellId) → 매칭 ServerEntry 의 outputFile. 매칭 실패 시 null. */
type OutputFileResolver = (port: number, shellId?: string) => string | null;

interface PortStream {
  port: number;
  /** 구독 식별자의 셸 — payload echo + resolve 에 사용. 레거시 위성은 undefined. */
  shellId: string | undefined;
  /** 스트림 Map 키 (streamKey 결과) */
  key: string;
  subscribers: Set<WebSocket>;
  /** 구독 시점에 resolve 된 outputFile. null 이면 tail 불가. */
  outputFile: string | null;
  /** 마지막으로 읽은 바이트 오프셋 */
  lastSize: number;
  /** 링 버퍼 — 최근 IFRAME_LOG_SERVER_BUFFER_MAX 줄 */
  buffer: IframeLogLine[];
  /** 배치 전송 대기 줄 */
  pendingDelta: IframeLogLine[];
  /** monotonic seq — 클라 dedupe/정렬 보조 */
  seq: number;
  pollTimer: NodeJS.Timeout | null;
  batchTimer: NodeJS.Timeout | null;
  /** 미완결 라인(마지막 조각이 \n 으로 안 끝난 경우) carry over */
  tailCarry: string;
}

/** 로그 라인에서 level 추론 — 실패 시 undefined */
function inferLevel(text: string): IframeLogLevel | undefined {
  const s = text.toLowerCase();
  if (/\berror\b|\[error\]|error:/.test(s)) return 'error';
  if (/\bwarn(ing)?\b|\[warn\]|warning:/.test(s)) return 'warn';
  if (/\binfo\b|\[info\]/.test(s)) return 'info';
  return undefined;
}

export class IframeLogStreamer {
  private streams = new Map<string, PortStream>();
  private resolveOutputFile: OutputFileResolver;

  constructor(resolveOutputFile: OutputFileResolver) {
    this.resolveOutputFile = resolveOutputFile;
  }

  /** `(port, shellId)` 구독. 구독자 0→1 전환 시 tail 시작. 현재 버퍼를 init 메시지로 즉시 전송. */
  subscribe(port: number, shellId: string | undefined, ws: WebSocket): void {
    const key = streamKey(port, shellId);
    let s = this.streams.get(key);
    if (!s) {
      s = this.createStream(port, shellId, key);
      this.streams.set(key, s);
    }
    s.subscribers.add(ws);
    this.sendInit(ws, s);
  }

  /** 구독 해제. 1→0 되면 tail 해제 + 버퍼 폐기. */
  unsubscribe(port: number, shellId: string | undefined, ws: WebSocket): void {
    const s = this.streams.get(streamKey(port, shellId));
    if (!s) return;
    s.subscribers.delete(ws);
    if (s.subscribers.size === 0) this.teardown(s.key);
  }

  /** WS 연결 종료 시 호출 — 해당 ws 가 걸린 모든 스트림 구독을 정리. */
  unsubscribeAll(ws: WebSocket): void {
    for (const key of [...this.streams.keys()]) {
      const s = this.streams.get(key);
      if (!s) continue;
      if (!s.subscribers.has(ws)) continue;
      s.subscribers.delete(ws);
      if (s.subscribers.size === 0) this.teardown(key);
    }
  }

  /** 프로세스 종료 시 모든 타이머 해제 */
  shutdown(): void {
    for (const key of [...this.streams.keys()]) this.teardown(key);
  }

  private createStream(port: number, shellId: string | undefined, key: string): PortStream {
    const outputFile = this.resolveOutputFile(port, shellId);
    const s: PortStream = {
      port,
      shellId,
      key,
      subscribers: new Set(),
      outputFile,
      lastSize: 0,
      buffer: [],
      pendingDelta: [],
      seq: 0,
      pollTimer: null,
      batchTimer: null,
      tailCarry: '',
    };

    if (!outputFile) {
      logger.info(`IframeLogStreamer: ${key} no matching ServerEntry — init-only`);
      return s;
    }

    // 초기 전체 tail — 파일의 마지막 IFRAME_LOG_TAIL_BYTES 만 읽어 ring 구성
    try {
      const stat = fs.statSync(outputFile);
      const readFrom = Math.max(0, stat.size - IFRAME_LOG_TAIL_BYTES);
      const length = stat.size - readFrom;
      if (length > 0) {
        const fd = fs.openSync(outputFile, 'r');
        try {
          const buf = Buffer.alloc(length);
          fs.readSync(fd, buf, 0, length, readFrom);
          const text = buf.toString('utf8');
          const lines = this.parseLines(s, text, true);
          for (const line of lines) this.appendToBuffer(s, line);
        } finally {
          fs.closeSync(fd);
        }
      }
      s.lastSize = stat.size;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        logger.warn(`IframeLogStreamer: init read failed ${key}: ${String(err)}`);
      }
    }

    s.pollTimer = setInterval(() => this.tick(key), IFRAME_LOG_POLL_INTERVAL_MS);
    logger.info(`IframeLogStreamer: ${key} started file=${outputFile}`);
    return s;
  }

  private tick(key: string): void {
    const s = this.streams.get(key);
    if (!s || !s.outputFile) return;
    try {
      const stat = fs.statSync(s.outputFile);
      // log rotation / truncate 탐지 — 크기 감소 시 리셋
      if (stat.size < s.lastSize) {
        s.lastSize = 0;
        s.tailCarry = '';
      }
      if (stat.size <= s.lastSize) return;

      const readFrom = s.lastSize;
      const length = stat.size - readFrom;
      const fd = fs.openSync(s.outputFile, 'r');
      try {
        const buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, readFrom);
        const text = buf.toString('utf8');
        const lines = this.parseLines(s, text);
        for (const line of lines) {
          this.appendToBuffer(s, line);
          s.pendingDelta.push(line);
        }
      } finally {
        fs.closeSync(fd);
      }
      s.lastSize = stat.size;
      this.scheduleBatch(s);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      logger.warn(`IframeLogStreamer: tick failed ${key}: ${String(err)}`);
    }
  }

  /**
   * text 를 라인으로 쪼개 IframeLogLine 배열 반환.
   * @param historic true 이면 과거 라인(팝업 open 전에 이미 기록된 내용) — `ts: 0` sentinel 로 "실제 시각 알 수 없음" 표시.
   *   false(live tick) 이면 `Date.now()` (실제 생성 시각에 tail 지연 ~1.5s 오차 이내).
   */
  private parseLines(s: PortStream, text: string, historic: boolean = false): IframeLogLine[] {
    const combined = s.tailCarry + text;
    const parts = combined.split(/\r?\n/);
    // 마지막 조각이 미완결이면 다음 tick 으로 carry
    s.tailCarry = parts.pop() ?? '';
    const out: IframeLogLine[] = [];
    for (const raw of parts) {
      if (!raw) continue;
      const clean = stripAnsi(raw);
      if (!clean) continue;
      const level = inferLevel(clean);
      const line: IframeLogLine = {
        seq: s.seq++,
        ts: historic ? 0 : Date.now(),
        text: clean,
      };
      if (level) line.level = level;
      out.push(line);
    }
    return out;
  }

  private appendToBuffer(s: PortStream, line: IframeLogLine): void {
    s.buffer.push(line);
    const overflow = s.buffer.length - IFRAME_LOG_SERVER_BUFFER_MAX;
    if (overflow > 0) s.buffer.splice(0, overflow);
  }

  private scheduleBatch(s: PortStream): void {
    if (s.batchTimer !== null) return;
    if (s.pendingDelta.length === 0) return;
    s.batchTimer = setTimeout(() => {
      s.batchTimer = null;
      this.flushBatch(s);
    }, IFRAME_LOG_BATCH_MS);
  }

  private flushBatch(s: PortStream): void {
    if (s.pendingDelta.length === 0) return;
    const payload: IframeLogAppendPayload = { port: s.port, lines: s.pendingDelta };
    if (s.shellId) payload.shellId = s.shellId;
    s.pendingDelta = [];
    const msg: WSMessage = {
      type: 'iframe_log_append',
      timestamp: Date.now(),
      payload,
    };
    const data = JSON.stringify(msg);
    for (const ws of s.subscribers) this.safeSend(ws, data);
  }

  private sendInit(ws: WebSocket, s: PortStream): void {
    const payload: IframeLogInitPayload = { port: s.port, lines: [...s.buffer] };
    if (s.shellId) payload.shellId = s.shellId;
    if (!s.outputFile) payload.unavailable = 'no-server-entry';
    const msg: WSMessage = {
      type: 'iframe_log_init',
      timestamp: Date.now(),
      payload,
    };
    this.safeSend(ws, JSON.stringify(msg));
  }

  private safeSend(ws: WebSocket, data: string): void {
    try {
      if ((ws as unknown as { readyState: number }).readyState === WS_OPEN) {
        ws.send(data);
      }
    } catch {
      /* ignore — 연결이 죽으면 close 핸들러가 unsubscribeAll 처리 */
    }
  }

  private teardown(key: string): void {
    const s = this.streams.get(key);
    if (!s) return;
    if (s.pollTimer) clearInterval(s.pollTimer);
    if (s.batchTimer) clearTimeout(s.batchTimer);
    this.streams.delete(key);
    logger.info(`IframeLogStreamer: ${key} torn down`);
  }
}
