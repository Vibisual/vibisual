import { randomUUID } from 'node:crypto';
import type { PermissionRequest, PermissionDecision, WSMessage } from '@vibisual/shared';
import { broadcast } from '../broadcastBus.js';
import { logger } from '../logger.js';

export type PermissionResolvedHook = (request: PermissionRequest, decision: PermissionDecision) => void;

/** §5.3 #12-1 v1.43 — 권한 승인 타임아웃 (훅 HTTP 요청도 이 값을 넘지 않도록 맞춤) */
const PERMISSION_REQUEST_TIMEOUT_MS = 60_000;

interface Pending {
  request: PermissionRequest;
  resolve: (decision: PermissionDecision) => void;
  timer: NodeJS.Timeout;
}

/**
 * PermissionBroker — PreToolUse 훅이 서버에 문의하면 여기로 요청을 넣고,
 * WS 로 클라이언트에 브로드캐스트한 뒤 클라 응답을 기다린다.
 * 타임아웃 시 `deny` (safe default).
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
   * 반환 Promise 는 클라 응답 또는 타임아웃 시 resolve 된다.
   */
  /** §5.3 #12-1 v1.90 — `timeoutPolicy`: 60초 무응답 시 자동 결정. 기본 `'allow'`(undefined=allow). */
  request(
    input: Omit<PermissionRequest, 'requestId' | 'createdAt' | 'expiresAt'>,
    timeoutPolicy: 'allow' | 'deny' = 'allow',
  ): Promise<PermissionDecision> {
    const requestId = randomUUID();
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

      this.pending.set(requestId, { request: req, resolve, timer });

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
    this.resolveInternal(decision.requestId, decision);
    return true;
  }

  /** 현재 대기 중인 요청 목록 (디버그 / 재전송용) */
  listPending(): PermissionRequest[] {
    return Array.from(this.pending.values()).map((p) => p.request);
  }

  private resolveInternal(requestId: string, decision: PermissionDecision): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
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

export const permissionBroker = new PermissionBroker();
