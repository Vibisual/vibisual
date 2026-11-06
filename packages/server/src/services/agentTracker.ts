import type { WSMessage, AgentStatus } from '@vibisual/shared';
import { broadcast } from '../broadcastBus.js';
import { graphManager } from './projectGraphManager.js';
import { logger } from '../logger.js';
import type { BubbleResumeFrom } from './hookEventClass.js';

/** §9 — index.ts 의 디바운스 broadcastSnapshot 주입 지점. 미주입 시 즉시 송신 폴백. */
let snapshotScheduler: (() => void) | null = null;

export function setSnapshotScheduler(fn: () => void): void {
  snapshotScheduler = fn;
}

function broadcastSnapshot(): void {
  // §9 — Stop/dismiss 가 몰릴 때 즉시 풀 getSnapshot()+broadcast 가 메인 스레드를 잡지 않도록 디바운스 경로로 넘긴다.
  if (snapshotScheduler) {
    snapshotScheduler();
    return;
  }
  broadcast({
    type: 'graph_snapshot',
    timestamp: Date.now(),
    payload: graphManager.getBroadcastSnapshot(),
  });
}

/**
 * 상태: idle → active(훅 이벤트) → completed(Stop 훅·PID 사망) 또는 error(StopFailure) → idle(completed 는 60초, 둘 다 클릭 dismiss, 연결 노드도 idle).
 * 시스템 단위 0↔1 전이는 micro-flap 보호 — turn 사이 잠깐 0 이 되는 정상 흐름이 "all completed → active" 로 새지 않게(에이전트별 빨강은 즉시).
 */
export class AgentTracker {
  private activeSessions = new Set<string>();
  // 시스템-레벨 broadcast/log 마이크로 플랩 보호 — 마지막으로 실제로 내보낸 상태와 보류 중인
  // 전이를 따로 보관. 보류 중 반대 전이가 오면 둘 다 취소(no-op).
  private lastBroadcastIsActive = false;
  private pendingTimer: NodeJS.Timeout | null = null;
  private pendingTarget: boolean | null = null;
  private static readonly STABILIZE_MS = 300;

  /**
   * 활동 신호. 이 집합은 시스템 단위 표시만 바꾼다 — `resumeFrom`(`bubbleResumeFrom`)이 있으면 도구 없이 일이 다시 도는 것이라
   * 개별 버블도 올린다(도구 이벤트는 `touchAgent` 가 올린다).
   */
  markActive(sessionId: string, resumeFrom: BubbleResumeFrom | null = null): void {
    const wasEmpty = this.activeSessions.size === 0;

    this.activeSessions.add(sessionId);

    if (resumeFrom && graphManager.resumeAgentStatus(sessionId, resumeFrom)) {
      broadcastSnapshot();
    }

    if (wasEmpty) {
      this.scheduleStatus(true);
    }
  }

  /** Stop 훅 → 응답 완료. 즉시 completed, `failed`(StopFailure)면 같은 종료를 error 로 남긴다(§2.4). 새 이벤트 오면 active 복귀 */
  markStop(sessionId: string, failed = false): void {
    this.activeSessions.delete(sessionId);

    const status = failed ? 'error' : 'completed';
    graphManager.setAgentStatus(sessionId, status);
    broadcastSnapshot();

    if (this.activeSessions.size === 0) {
      this.scheduleStatus(false);
    }

    logger.info(`Agent stop → ${status} (session: ${sessionId})`);
  }

  /** PID 사망 → completed (빨강) */
  markForceStop(sessionId: string): void {
    this.activeSessions.delete(sessionId);

    graphManager.setAgentStatus(sessionId, 'completed');
    broadcastSnapshot();
    logger.info(`Agent force-stopped → completed (session: ${sessionId})`);
  }

  /**
   * 유저가 확인 → 빨강 끄고 idle 복귀.
   * @returns 즉시 제거된 전유 file/folder 버블 id 목록(걷을 게 없었으면 빈 배열).
   */
  dismiss(sessionId: string): string[] {
    // 확인 dismiss 는 purgeNodes=true — 그 에이전트가 전유하던 file/folder 버블을 5분 TTL 없이 즉시 제거(§2.4).
    const purged = graphManager.markAgentIdle(sessionId, true);
    broadcastSnapshot();
    logger.info(`Agent acknowledged → idle + purged ${purged.length} owned file/folder bubble(s) (session: ${sessionId})`);
    return purged;
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
