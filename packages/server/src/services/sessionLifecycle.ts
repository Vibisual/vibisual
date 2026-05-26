/**
 * sessionLifecycle.ts — 3-Layer 세션 생명주기 통합 관리자
 *
 * Layer 1 (SessionStart hook):  POST /api/session-start   → registerFromHook()
 * Layer 2 (JSONL watcher):      chokidar                   → JsonlWatcher
 * Layer 3 (process polling):    tasklist/pgrep             → processDetector
 *
 * 통합 규칙:
 *   - Layer 1이 가장 권위 있음 (PID, sessionId, cwd 동시 제공)
 *   - Layer 2는 JSONL 활동 → 살아있음 갱신 (훅 미설치 보험)
 *   - Layer 3은 최종 판결: PID가 실제 Claude 프로세스 목록에 없으면 dead
 *   - 세션이 SessionStart로만 등록됐고 tool-use 훅이 아직 없어 PID 미확보라면
 *     60초 후 'unknown' 표시, 120초 후 자동 제거
 */

import type { SessionSource, SessionLifeStatus } from '@vibisual/shared';
import type { SessionEntrypoint } from './sessionDiscovery.js';
import { findEntrypointBySession, readAliveSessionIds } from './sessionDiscovery.js';
import { JsonlWatcher } from './jsonlWatcher.js';
import { logger } from '../logger.js';
import { dbg } from './debugLog.js';

const POLL_INTERVAL_MS = 2_000;

/** 세션 정보 — 3개 Layer의 신호를 여기 누적 */
export interface LifecycleSession {
  sessionId: string;
  /** CLI/VSCode 프로세스 PID — Layer 1 또는 기존 seedAgents에서 확보 */
  pid: number | null;
  cwd: string;
  /** 마지막 활동 시각 (JSONL mtime 또는 tool-use 이벤트) */
  lastActivityMs: number;
  /** 최초 등록 시각 */
  registeredMs: number;
  /** 감지 소스 — UI 뱃지/내부 우선순위 용 */
  source: SessionSource;
  /** 현재 생명 상태 — idle 스타일링 용 */
  status: SessionLifeStatus;
  /** 세션 진입점 (표시용). v1.2부터는 정책이 일원화되어 vscode/cli 모두 PID 사망 시 제거. */
  entrypoint: SessionEntrypoint;
}

/** 외부(ProjectGraph)에 알릴 이벤트 콜백 */
export interface LifecycleCallbacks {
  /** 세션 PID 사망 — 버블 제거 (v1.2부터 vscode/cli 구분 없이 공통). */
  onDead: (sessionId: string) => void;
  /**
   * @deprecated v1.2 — 호출되지 않음. 이전 정책(VSCode 닫아도 유지) 흔적.
   * 시그니처 호환 유지를 위해 남겨둠. 다음 리팩토링에서 제거 예정.
   */
  onVSCodeClosed: (sessionId: string) => void;
  /** source/status 맵이 바뀌어 스냅샷 재브로드캐스트가 필요할 때 호출 */
  onMetaChange: () => void;
  /**
   * v1.2 — 현재 에이전트 버블로 살아있는 모든 sessionId를 반환.
   * 체크포인트 복원 직후처럼 lifecycle.sessions엔 없지만 버블은 떠 있는 케이스를
   * 커버하기 위해 폴링의 실제 기준으로 사용.
   */
  listAgentSessionIds: () => string[];
}

function sourceRank(source: SessionSource): number {
  return source === 'hook' ? 3 : source === 'jsonl' ? 2 : 1;
}

export class SessionLifecycleManager {
  private sessions = new Map<string, LifecycleSession>();
  private jsonlWatcher: JsonlWatcher;
  private callbacks: LifecycleCallbacks;
  private timer: NodeJS.Timeout | null = null;
  private probing = false;

  constructor(callbacks: LifecycleCallbacks) {
    this.callbacks = callbacks;
    this.jsonlWatcher = new JsonlWatcher({
      onActivity: (evt) => this.onJsonlActivity(evt.sessionId, evt.mtimeMs),
    });
  }

  start(): void {
    this.jsonlWatcher.start();
    this.scheduleNextPoll();
    logger.info('SessionLifecycleManager started');
  }

  stop(): void {
    this.jsonlWatcher.stop();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Layer 1: SessionStart 훅에서 호출. PID 포함 완전한 정보. */
  registerFromHook(params: {
    sessionId: string;
    pid: number | null;
    cwd: string;
  }): void {
    if (!params.sessionId) return;
    dbg('lifecycle.registerFromHook', params);
    this.upsert(params.sessionId, {
      pid: params.pid,
      cwd: params.cwd,
      source: 'hook',
      bump: true,
    });
  }

  /** 기존 seedAgents / discoverSessions 결과 — PID 있음. 소스는 'process'로 표시 */
  registerFromSeed(sessionId: string, pid: number, cwd: string): void {
    this.upsert(sessionId, { pid, cwd, source: 'process', bump: true });
  }

  /** tool-use 훅에서 호출 — 활동 갱신. 새 세션이면 'process' 폴백 소스 */
  registerFromToolUse(sessionId: string, cwd: string, pid: number | null): void {
    if (!sessionId) return;
    this.upsert(sessionId, { pid, cwd, source: 'process', bump: true, preserveSource: true });
  }

  unregister(sessionId: string): void {
    if (this.sessions.delete(sessionId)) this.callbacks.onMetaChange();
  }

  /** 현재 추적 중인 세션의 소스 맵 — graphManager.getSnapshot 병합용 */
  getSourcesSnapshot(): Record<string, SessionSource> {
    const result: Record<string, SessionSource> = {};
    for (const [id, s] of this.sessions) result[id] = s.source;
    return result;
  }

  /** 현재 추적 중인 세션의 상태 맵 — graphManager.getSnapshot 병합용 */
  getStatusesSnapshot(): Record<string, SessionLifeStatus> {
    const result: Record<string, SessionLifeStatus> = {};
    for (const [id, s] of this.sessions) result[id] = s.status;
    return result;
  }

  /** sessionId → PID (세션 종료 API에서 사용). null이면 PID 미확보. */
  getPid(sessionId: string): number | null {
    return this.sessions.get(sessionId)?.pid ?? null;
  }

  private upsert(
    sessionId: string,
    opts: {
      pid: number | null;
      cwd: string;
      source: SessionSource;
      bump: boolean;
      preserveSource?: boolean;
    },
  ): void {
    const existing = this.sessions.get(sessionId);
    const now = Date.now();
    let metaChanged = false;

    if (existing) {
      if (opts.pid !== null && existing.pid !== opts.pid) {
        existing.pid = opts.pid;
      }
      if (existing.cwd !== opts.cwd) existing.cwd = opts.cwd;
      if (opts.bump) existing.lastActivityMs = now;

      // source 승격 규칙: hook > jsonl > process. preserveSource면 기존 유지.
      if (!opts.preserveSource && sourceRank(opts.source) > sourceRank(existing.source)) {
        existing.source = opts.source;
        metaChanged = true;
      }
      // 활동 갱신 시 idle → active 복귀
      if (opts.bump && existing.status === 'idle') {
        existing.status = 'active';
        metaChanged = true;
      }
    } else {
      this.sessions.set(sessionId, {
        sessionId,
        pid: opts.pid,
        cwd: opts.cwd,
        lastActivityMs: now,
        registeredMs: now,
        source: opts.source,
        status: 'active',
        entrypoint: findEntrypointBySession(sessionId),
      });
      metaChanged = true;
    }

    if (metaChanged) this.callbacks.onMetaChange();
  }

  /** Layer 2 활동 이벤트 */
  private onJsonlActivity(sessionId: string, mtimeMs: number): void {
    const s = this.sessions.get(sessionId);
    if (!s) return; // 알려지지 않은 세션은 무시 (Layer 1/tool-use가 먼저 등록해야 함)
    let metaChanged = false;
    if (mtimeMs > s.lastActivityMs) s.lastActivityMs = mtimeMs;
    if (s.source === 'process' && sourceRank('jsonl') > sourceRank(s.source)) {
      s.source = 'jsonl';
      metaChanged = true;
    }
    if (s.status === 'idle') {
      s.status = 'active';
      metaChanged = true;
    }
    if (metaChanged) this.callbacks.onMetaChange();
  }

  /** setTimeout 체이닝 (setInterval 사용하지 않음 — 이전 폴링 완료 후 10초 대기) */
  private scheduleNextPoll(): void {
    this.timer = setTimeout(() => {
      this.pollOnce()
        .catch((err) => logger.warn('sessionLifecycle poll failed', err))
        .finally(() => {
          // stop() 이후에는 재스케줄 X
          if (this.timer !== null) this.scheduleNextPoll();
        });
    }, POLL_INTERVAL_MS);
  }

  private async pollOnce(): Promise<void> {
    if (this.probing) return;
    this.probing = true;
    try {
      // v1.2 정책 (SCENARIO §5.7 #24): ~/.claude/sessions/<PID>.json 존재 + PID alive = 살아있음.
      // 기준을 graphManager의 실제 에이전트 버블 목록에 두어, 체크포인트 복원 후
      // lifecycle.sessions에 없지만 버블은 떠있는 케이스도 정리한다.
      const aliveIds = readAliveSessionIds();
      const bubbleIds = this.callbacks.listAgentSessionIds();
      const dead: string[] = [];
      for (const sessionId of bubbleIds) {
        if (!aliveIds.has(sessionId)) dead.push(sessionId);
      }

      dbg('pollOnce', {
        aliveCount: aliveIds.size,
        alive: [...aliveIds],
        bubbleCount: bubbleIds.length,
        bubbles: bubbleIds,
        deadCount: dead.length,
        dead,
      });

      for (const sessionId of dead) {
        // SCENARIO §5.7 #24 v1.9: 조건 탈락 시 즉시 제거. Dormant 스냅샷이 복구를 담당.
        logger.info(`Lifecycle: PID file gone or dead → removed ${sessionId.slice(0, 8)}`);
        dbg('pollOnce.remove', { sessionId });
        this.sessions.delete(sessionId);
        this.callbacks.onDead(sessionId);
      }
    } finally {
      this.probing = false;
    }
  }

}
