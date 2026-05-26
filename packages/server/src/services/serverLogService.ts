/**
 * ServerLogService — §7.7 v1.99 Vibisual 서버 코어 로그 라이브 스트리밍.
 *
 * `logger.ts` 가 **모든 레벨**(info/warn/error/debug)의 라인을 `record()` 로 흘려보내고,
 * 이 서비스는 ring buffer(`SERVER_LOG_BUFFER_MAX`)에 적재한다. 진단 서비스(§4 v1.98)는
 * error/warn 만 모으지만 이쪽은 전량 — "서버가 하는 일 전부" 가 보여야 하기 때문.
 *
 * Lazy pub/sub: 클라 `ServerLogPopup` 이 WS `subscribe_server_log` 로 구독하면 현재
 * 버퍼를 `server_log_init` 으로 즉시 받고, 이후 새 라인은 `SERVER_LOG_BATCH_MS`
 * 마이크로배치 `server_log_append` 로 받는다. 구독자가 0 이면 배치 타이머를 돌리지
 * 않는다 — 평상시 비용 0. `diagnosticService` 와 달리 GraphSnapshot 에 싣지 않아
 * 매 broadcast 를 부풀리지 않는다(§7.11 iframe 로그 선례).
 *
 * 영속화 ❌ (휘발성 런타임 로그). GraphSnapshot/ProjectCheckpoint 미관여.
 * **`logger` 를 import 하지 않는다** — `record()` 안에서 로깅하면 무한 재귀.
 */
import type { WebSocket } from 'ws';
import {
  SERVER_LOG_BUFFER_MAX,
  SERVER_LOG_BATCH_MS,
} from '@vibisual/shared';
import type {
  ServerLogEntry,
  ServerLogLevel,
  ServerLogCategory,
  ServerLogInitPayload,
  ServerLogAppendPayload,
  WSMessage,
} from '@vibisual/shared';

/** WebSocket.OPEN = 1 (ws 모듈 상수를 import 하지 않기 위해 리터럴 사용) */
const WS_OPEN = 1 as const;

/** 훅 수신·처리 관련 라인 식별 — Claude Code 훅 이벤트 이름/경로. */
const HOOK_LINE = /\bhooks?\b|HookEvent|PreToolUse|PostToolUse|UserPromptSubmit|PreCompact|\bSessionStart\b|\/api\/hook-event/i;

/**
 * §7.7 v2.3 — 로그 라인 분류. 캡처 시점 1회 판정 (로깅 호출부 무수정).
 *  - error / warn: `level` 승격.
 *  - hook: 훅 관련 라인.
 *  - event: 그 외 info/debug 전부.
 */
function classifyLogCategory(level: ServerLogLevel, message: string): ServerLogCategory {
  if (level === 'error') return 'error';
  if (level === 'warn') return 'warn';
  if (HOOK_LINE.test(message)) return 'hook';
  return 'event';
}

class ServerLogService {
  /** 링 버퍼 — 최근 SERVER_LOG_BUFFER_MAX 줄 */
  private buffer: ServerLogEntry[] = [];
  /** 현재 스트림을 보고 있는 구독자(팝업 열린 클라) */
  private subscribers = new Set<WebSocket>();
  /** 배치 전송 대기 줄 */
  private pendingDelta: ServerLogEntry[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  /** monotonic seq — 클라 dedupe/정렬 보조 */
  private seq = 0;

  /**
   * `logger.ts` 가 모든 레벨 라인을 흘려보내는 진입점.
   * ring buffer 적재는 항상, 구독자가 있을 때만 델타 배치를 예약한다.
   * 이 안에서는 절대 로깅하지 않는다(재귀 차단).
   */
  record(level: ServerLogLevel, message: string): void {
    const trimmed = message.slice(0, 4000);
    const entry: ServerLogEntry = {
      seq: this.seq++,
      ts: Date.now(),
      level,
      category: classifyLogCategory(level, trimmed),
      message: trimmed,
    };
    this.buffer.push(entry);
    const overflow = this.buffer.length - SERVER_LOG_BUFFER_MAX;
    if (overflow > 0) this.buffer.splice(0, overflow);

    if (this.subscribers.size === 0) return;
    this.pendingDelta.push(entry);
    this.scheduleBatch();
  }

  /** 구독 시작 — 현재 버퍼를 init 메시지로 즉시 전송. */
  subscribe(ws: WebSocket): void {
    this.subscribers.add(ws);
    const payload: ServerLogInitPayload = { lines: [...this.buffer] };
    const msg: WSMessage = { type: 'server_log_init', timestamp: Date.now(), payload };
    this.safeSend(ws, JSON.stringify(msg));
  }

  /** 구독 해제. 구독자 1→0 이면 대기 중 배치를 폐기. */
  unsubscribe(ws: WebSocket): void {
    this.subscribers.delete(ws);
    if (this.subscribers.size === 0) this.cancelBatch();
  }

  /** WS 연결 종료 시 호출 — 해당 ws 구독을 정리. */
  unsubscribeAll(ws: WebSocket): void {
    if (!this.subscribers.delete(ws)) return;
    if (this.subscribers.size === 0) this.cancelBatch();
  }

  /** 프로세스 종료 시 타이머·구독 정리. */
  shutdown(): void {
    this.cancelBatch();
    this.subscribers.clear();
  }

  private scheduleBatch(): void {
    if (this.batchTimer !== null) return;
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.flushBatch();
    }, SERVER_LOG_BATCH_MS);
  }

  private cancelBatch(): void {
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.pendingDelta = [];
  }

  private flushBatch(): void {
    if (this.pendingDelta.length === 0) return;
    if (this.subscribers.size === 0) {
      this.pendingDelta = [];
      return;
    }
    const payload: ServerLogAppendPayload = { lines: this.pendingDelta };
    this.pendingDelta = [];
    const msg: WSMessage = { type: 'server_log_append', timestamp: Date.now(), payload };
    const data = JSON.stringify(msg);
    for (const ws of this.subscribers) this.safeSend(ws, data);
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
}

export const serverLogService = new ServerLogService();
