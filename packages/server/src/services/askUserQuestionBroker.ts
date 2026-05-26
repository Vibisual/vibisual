import { randomUUID } from 'node:crypto';
import {
  ASK_USER_QUESTION_TIMEOUT_MS,
  type AskUserQuestionRequest,
  type AskUserQuestionDecision,
  type WSMessage,
} from '@vibisual/shared';
import { broadcast } from '../broadcastBus.js';
import { logger } from '../logger.js';

interface Pending {
  request: AskUserQuestionRequest;
  resolve: (decision: AskUserQuestionDecision) => void;
  timer: NodeJS.Timeout;
}

/**
 * §5.3 #12-2 v2.26 — AskUserQuestionBroker.
 *
 * PermissionBroker 평행 패턴: PreToolUse 훅이 `tool_name === 'AskUserQuestion'` 분기로
 * 동기 hold 하면 여기 큐잉, WS push, 사용자 응답 또는 60s 타임아웃까지 대기.
 *
 * 타임아웃 시 빈 `selectedLabels` + `reason:'timeout'` 로 resolve — 훅이 그 의미를
 * `permissionDecisionReason` 으로 합성해 모델 transcript 에 도달시킨다.
 */
export class AskUserQuestionBroker {
  private pending = new Map<string, Pending>();

  request(
    input: Omit<AskUserQuestionRequest, 'requestId' | 'createdAt' | 'expiresAt'>,
  ): Promise<AskUserQuestionDecision> {
    const requestId = randomUUID();
    const now = Date.now();
    const req: AskUserQuestionRequest = {
      ...input,
      requestId,
      createdAt: now,
      expiresAt: now + ASK_USER_QUESTION_TIMEOUT_MS,
    };

    return new Promise<AskUserQuestionDecision>((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(requestId)) return;
        logger.warn('[AskUserQuestionBroker] request timed out', {
          requestId,
          agentId: req.agentId,
        });
        this.resolveInternal(requestId, {
          requestId,
          answers: [],
          reason: 'timeout',
        });
      }, ASK_USER_QUESTION_TIMEOUT_MS);

      this.pending.set(requestId, { request: req, resolve, timer });

      const msg: WSMessage = {
        type: 'ask_user_question',
        timestamp: now,
        payload: req,
      };
      broadcast(msg);
    });
  }

  resolve(decision: AskUserQuestionDecision): boolean {
    if (!this.pending.has(decision.requestId)) return false;
    this.resolveInternal(decision.requestId, decision);
    return true;
  }

  listPending(): AskUserQuestionRequest[] {
    return Array.from(this.pending.values()).map((p) => p.request);
  }

  private resolveInternal(requestId: string, decision: AskUserQuestionDecision): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(decision);

    const msg: WSMessage = {
      type: 'ask_user_question_resolved',
      timestamp: Date.now(),
      payload: decision,
    };
    broadcast(msg);
  }
}

export const askUserQuestionBroker = new AskUserQuestionBroker();
