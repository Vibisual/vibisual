import { randomUUID } from 'node:crypto';
import type { PermissionRequest, PermissionDecision, PermissionCancelReason, WSMessage } from '@vibisual/shared';
import { broadcast } from '../broadcastBus.js';
import { logger } from '../logger.js';

export type PermissionResolvedHook = (request: PermissionRequest, decision: PermissionDecision) => void;

/** §5.3 #12-1 v1.43 — 권한 승인 타임아웃 (훅 HTTP 요청도 이 값을 넘지 않도록 맞춤) */
const PERMISSION_REQUEST_TIMEOUT_MS = 60_000;

/** §5.3 #12-1-B — 취소로 풀린 결정의 `reason` 마커(훅·원장·스트림 줄이 이 낱말로 가른다). */
export const PERMISSION_CANCELLED_REASON = 'cancelled';

interface Pending {
  request: PermissionRequest;
  resolve: (decision: PermissionDecision) => void;
  timer: NodeJS.Timeout;
  /** 요청 연결의 abort 구독을 푼다(풀린 뒤에도 매달려 있으면 신호가 죽은 요청을 다시 부른다). */
  detach: () => void;
}

export interface PermissionRequestOptions {
  /**
   * §5.3 #12-1-B — 카드를 기다리는 쪽이 사라졌음을 알리는 신호(요청 연결의 `close`).
   * 울리면 카드는 `caller-gone` 취소로 닫힌다 — 60초를 채워 타임아웃 정책으로 풀리지 않는다.
   */
  signal?: AbortSignal;
}

/**
 * PermissionBroker — PreToolUse 훅이 서버에 문의하면 여기로 요청을 넣고,
 * WS 로 클라이언트에 브로드캐스트한 뒤 클라 응답을 기다린다.
 *
 * 풀리는 길은 셋이다:
 * - 사람의 답(`resolve`)
 * - 60초 무응답 → 호출부가 넘긴 `timeoutPolicy`(§5.3 #12-1 v1.90 — 훅 경로 기본 `allow`, 계획 승인·코덱스 도구는 `deny`)
 * - 답할 곳이 사라짐 → `cancel`(§5.3 #12-1-B — 에이전트 중지·요청 연결 끊김). 결정은 `deny` + `cancelled`.
 */
export class PermissionBroker {
  private pending = new Map<string, Pending>();

  /**
   * §5.3 #12-1 v1.96 — resolve 직후 호출되는 후크. 서버 부트스트랩이 wiring 해서
   * 사용자의 Allow/Deny 결정을 해당 sub 의 stream 에 합성 한 줄로 띄우는 데 쓴다.
   * 클라이언트에 별도 WS broadcast 가 아닌, 정규 sub_agent_stream 경로를 타게 해서
   * 새로고침/체크포인트 복원 후에도 결정이 stream 에 남아 있도록 한다.
   */
  onResolved: PermissionResolvedHook | null = null;

  /**
   * 새 권한 요청 등록.
   * 반환 Promise 는 클라 응답 · 타임아웃 · 취소 중 먼저 온 것으로 resolve 된다.
   * `timeoutPolicy`: 60초 무응답 시 자동 결정(§5.3 #12-1 v1.90). 기본 `'allow'`.
   */
  request(
    input: Omit<PermissionRequest, 'requestId' | 'createdAt' | 'expiresAt'>,
    timeoutPolicy: 'allow' | 'deny' = 'allow',
    options: PermissionRequestOptions = {},
  ): Promise<PermissionDecision> {
    const requestId = randomUUID();
    const { signal } = options;
    // 이미 끊긴 연결이면 카드를 띄우지 않는다 — 떴다가 곧바로 사라지는 깜빡임만 남는다.
    if (signal?.aborted) {
      return Promise.resolve(cancelledDecision(requestId, 'caller-gone'));
    }
    const now = Date.now();
    const req: PermissionRequest = {
      ...input,
      requestId,
      createdAt: now,
      expiresAt: now + PERMISSION_REQUEST_TIMEOUT_MS,
    };

    return new Promise<PermissionDecision>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(requestId)) return;
        logger.warn(`[PermissionBroker] request timed out — policy=${timeoutPolicy}`, {
          requestId,
          agentId: req.agentId,
          toolName: req.toolName,
        });
        this.resolveInternal(requestId, { requestId, decision: timeoutPolicy, reason: 'timeout' });
      }, PERMISSION_REQUEST_TIMEOUT_MS);

      let detach = (): void => {};
      if (signal) {
        const onAbort = (): void => { this.cancel(requestId, 'caller-gone'); };
        signal.addEventListener('abort', onAbort, { once: true });
        detach = () => signal.removeEventListener('abort', onAbort);
      }

      this.pending.set(requestId, { request: req, resolve, timer, detach });

      const msg: WSMessage = {
        type: 'permission_request',
        timestamp: now,
        payload: req,
      };
      broadcast(msg);
    });
  }

  /** 클라이언트의 결정을 적용. 알려지지 않은 requestId 는 무시. */
  resolve(decision: PermissionDecision): boolean {
    if (!this.pending.has(decision.requestId)) return false;
    // 취소 표식은 서버만 싣는다 — 창구가 보낸 값으로 "아무도 안 눌렀다"를 꾸미지 못하게.
    const { cancelled: _ignored, ...rest } = decision;
    this.resolveInternal(decision.requestId, rest);
    return true;
  }

  /** §5.3 #12-1-B — 대기 중인 요청 한 건(결정 창구가 "항상" 범위를 서버 쪽 값으로 확인한다). */
  get(requestId: string): PermissionRequest | undefined {
    return this.pending.get(requestId)?.request;
  }

  /** §5.3 #12-1-B — 답할 곳이 사라진 카드 한 장을 닫는다. 이미 풀렸으면 `false`. */
  cancel(requestId: string, cause: PermissionCancelReason): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    logger.info(`[PermissionBroker] request cancelled — ${cause}`, {
      requestId,
      agentId: entry.request.agentId,
      toolName: entry.request.toolName,
    });
    this.resolveInternal(requestId, cancelledDecision(requestId, cause));
    return true;
  }

  /**
   * §5.3 #12-1-B — 그 세션(sub)의 대기 카드를 전부 닫는다(사용자 [중지]).
   * 닫은 장수를 돌려준다.
   */
  cancelForSubAgent(subAgentId: string, cause: PermissionCancelReason): number {
    const ids = [...this.pending.values()]
      .filter((p) => p.request.subAgentId === subAgentId)
      .map((p) => p.request.requestId);
    for (const id of ids) this.cancel(id, cause);
    return ids.length;
  }

  /**
   * §5.3 #12-1-B — 그 에이전트 버블의 대기 카드를 전부 닫는다(세션 전체 중지).
   * 세션 id 없이 도착한 카드(레거시 훅 env)도 여기서 함께 닫힌다.
   */
  cancelForAgent(agentId: string, cause: PermissionCancelReason): number {
    const ids = [...this.pending.values()]
      .filter((p) => p.request.agentId === agentId)
      .map((p) => p.request.requestId);
    for (const id of ids) this.cancel(id, cause);
    return ids.length;
  }

  /** 현재 대기 중인 요청 목록 (디버그 / 재전송용) */
  listPending(): PermissionRequest[] {
    return Array.from(this.pending.values()).map((p) => p.request);
  }

  private resolveInternal(requestId: string, decision: PermissionDecision): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.detach();
    this.pending.delete(requestId);
    entry.resolve(decision);

    const msg: WSMessage = {
      type: 'permission_resolved',
      timestamp: Date.now(),
      payload: decision,
    };
    broadcast(msg);

    // §5.3 #12-1 v1.96 — 결정을 sub stream 에 합성 한 줄로 남기는 hook 호출.
    // 후크 실패가 broker 상태를 깨면 안 되므로 try/catch 로 격리.
    try {
      this.onResolved?.(entry.request, decision);
    } catch (err) {
      logger.error('[PermissionBroker] onResolved hook threw', err);
    }
  }
}

function cancelledDecision(requestId: string, cause: PermissionCancelReason): PermissionDecision {
  return { requestId, decision: 'deny', reason: PERMISSION_CANCELLED_REASON, cancelled: cause };
}

export const permissionBroker = new PermissionBroker();
