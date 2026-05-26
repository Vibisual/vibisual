import type { WSMessage, AgentStatus } from '@vibisual/shared';
import { broadcast } from '../broadcastBus.js';
import { graphManager } from './projectGraphManager.js';
import { logger } from '../logger.js';

function broadcastSnapshot(): void {
  broadcast({
    type: 'graph_snapshot',
    timestamp: Date.now(),
    payload: graphManager.getSnapshot(),
  });
}

/**
 * 에이전트 상태: idle(대기) → active(파랑) → completed(빨강) → idle(60초 자동 or 클릭)
 * - hook event (PreToolUse/PostToolUse/Notification) → active
 * - Stop 훅 → 즉시 completed (빨강 글로우)
 * - PID 사망 → completed (빨강)
 * - 60초 경과 또는 클릭 → dismiss (idle 복귀 + 연결 노드 idle)
 *
 * 시스템-레벨 0↔1 전이는 v2.10 부터 micro-flap 보호. 같은 에이전트가 turn 사이 마이크로초
 * 동안 0 으로 떨어졌다가 즉시 다음 turn 으로 1 로 돌아오는 정상 흐름이 매번 "all completed →
 * active" 로 흘러나오던 버그 픽스. per-agent 의 빨강 글로우는 즉시 그대로.
 */
export class AgentTracker {
  private activeSessions = new Set<string>();
  // 시스템-레벨 broadcast/log 마이크로 플랩 보호 — 마지막으로 실제로 내보낸 상태와 보류 중인
  // 전이를 따로 보관. 보류 중 반대 전이가 오면 둘 다 취소(no-op).
  private lastBroadcastIsActive = false;
  private pendingTimer: NodeJS.Timeout | null = null;
  private pendingTarget: boolean | null = null;
  private static readonly STABILIZE_MS = 300;

  markActive(sessionId: string): void {
    const wasEmpty = this.activeSessions.size === 0;

    this.activeSessions.add(sessionId);

    if (wasEmpty) {
      this.scheduleStatus(true);
    }
  }

  /** Stop 훅 → 응답 완료. 즉시 completed (빨강), 새 이벤트 오면 active 복귀 */
  markStop(sessionId: string): void {
    this.activeSessions.delete(sessionId);

    graphManager.setAgentStatus(sessionId, 'completed');
    broadcastSnapshot();

    if (this.activeSessions.size === 0) {
      this.scheduleStatus(false);
    }

    logger.info(`Agent stop → completed (session: ${sessionId})`);
  }

  /** PID 사망 → completed (빨강) */
  markForceStop(sessionId: string): void {
    this.activeSessions.delete(sessionId);

    graphManager.setAgentStatus(sessionId, 'completed');
    broadcastSnapshot();
    logger.info(`Agent force-stopped → completed (session: ${sessionId})`);
  }

  /** 유저가 확인 → 빨강 끄고 idle 복귀 */
  dismiss(sessionId: string): void {
    // 사용자 확인 dismiss → purgeNodes=true: 그 에이전트가 전유하던 file/folder
    // 버블을 idle(5분 TTL)이 아니라 즉시 제거 (§2.4 v1.82).
    graphManager.markAgentIdle(sessionId, true);
    broadcastSnapshot();
    logger.info(`Agent acknowledged → idle + purged owned file/folder bubbles (session: ${sessionId})`);
  }

  activeCount(): number {
    return this.activeSessions.size;
  }

  /** 시스템-레벨 상태 전이를 stabilization window 뒤로 미룬다. 같은 window 안에 반대 전이가
   *  오면 둘 다 취소(no-op) — turn 사이 마이크로 플랩이 broadcast/log 로 새는 걸 막는다. */
  private scheduleStatus(isActive: boolean): void {
    // 보류 중인 전이가 이번 전이의 반대 방향이면 둘 다 취소 — flap 무시.
    if (this.pendingTimer && this.pendingTarget !== isActive) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
      this.pendingTarget = null;
      return;
    }
    // 이미 같은 방향으로 보류 중이면 그대로 둠.
    if (this.pendingTimer && this.pendingTarget === isActive) return;
    // 마지막 broadcast 와 같으면 발사할 필요 없음(노이즈 차단).
    if (isActive === this.lastBroadcastIsActive) return;

    this.pendingTarget = isActive;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.pendingTarget = null;
      this.broadcastStatus(isActive);
    }, AgentTracker.STABILIZE_MS);
  }

  private broadcastStatus(isActive: boolean): void {
    this.lastBroadcastIsActive = isActive;
    const payload: AgentStatus = {
      isActive,
      activeCount: this.activeSessions.size,
      totalCount: this.activeSessions.size,
      lastSeen: Date.now(),
    };
    broadcast({
      type: 'agent_status',
      timestamp: Date.now(),
      payload,
    });
    logger.info(`System ${isActive ? 'active' : 'all completed'}`);
  }
}

export const agentTracker = new AgentTracker();
