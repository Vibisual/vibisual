/**
 * 3-Layer 세션 생명주기 관리자 — ① SessionStart hook(`registerFromHook`, PID·sessionId·cwd 를 주는 최고 권위)
 * ② JSONL watcher(활동 = 살아있음, 훅 미설치 보험) ③ liveness scan(`readAliveSessionIds` — PID 가 claude 프로세스 목록에 없으면 dead, 최종 판결).
 * PID 를 못 얻은 SessionStart 세션은 60초 뒤 'unknown', 120초 뒤 제거.
 */

import type { SessionSource, SessionLifeStatus } from '@vibisual/shared';
import type { SessionEntrypoint } from './sessionDiscovery.js';
import { findEntrypointBySession, readAliveSessionIds } from './sessionDiscovery.js';
import { JsonlWatcher } from './jsonlWatcher.js';
import { logger } from '../logger.js';
import { dbg, dbgOnChange } from './debugLog.js';

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
  /** 진입점(표시용) — 진입점과 무관하게 PID 사망 시 제거한다. */
  entrypoint: SessionEntrypoint;
}

/** 외부(ProjectGraph)에 알릴 이벤트 콜백 */
export interface LifecycleCallbacks {
  /** PID 사망 → 버블 제거(진입점 무관). */
  onDead: (sessionId: string) => void;
  /** §9 「창이 뜬 직후의 메인 스레드」 ③ — 한 주기의 죽은 세션을 다 걷은 뒤 한 번(걷은 게 있을 때만). 체크포인트 저장을 여기서 한 번으로 묶는다. */
  onDeadSettled?: () => void;
  /**
   * @deprecated v1.2 — 호출되지 않음. 이전 정책(VSCode 닫아도 유지) 흔적.
   * 시그니처 호환 유지를 위해 남겨둠. 다음 리팩토링에서 제거 예정.
   */
  onVSCodeClosed: (sessionId: string) => void;
  /** source/status 맵이 바뀌어 스냅샷 재브로드캐스트가 필요할 때 호출 */
  onMetaChange: () => void;
  /** 버블로 떠 있는 모든 sessionId — 폴링의 실제 기준(복원 직후 lifecycle.sessions 에 없는 버블도 덮는다). */
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
      // §5.7 #24: sessions/<PID>.json + PID alive = 살아있음. 기준은 실제 버블 목록(복원 버블도 정리).
      const aliveIds = readAliveSessionIds();
      const bubbleIds = this.callbacks.listAgentSessionIds();
      const dead: string[] = [];
      for (const sessionId of bubbleIds) {
        if (!aliveIds.has(sessionId)) dead.push(sessionId);
      }

      // 2초 폴링이라 달라졌을 때만 기록한다(실측 로그의 87%). dead 가 생긴 주기는 signature 가 반드시 바뀌어 진단 기록은 안 잃는다.
      const alive = [...aliveIds];
      dbgOnChange(
        'pollOnce',
        JSON.stringify([alive, bubbleIds, dead]),
        'pollOnce',
        {
          aliveCount: aliveIds.size,
          alive,
          bubbleCount: bubbleIds.length,
          bubbles: bubbleIds,
          deadCount: dead.length,
          dead,
        },
      );

      for (const sessionId of dead) {
        // §5.7 #24: 탈락 즉시 제거 — 복구는 Dormant 스냅샷이 맡는다.
        logger.info(`Lifecycle: PID file gone or dead → removed ${sessionId.slice(0, 8)}`);
        dbg('pollOnce.remove', { sessionId });
        this.sessions.delete(sessionId);
        this.callbacks.onDead(sessionId);
      }
      if (dead.length > 0) this.callbacks.onDeadSettled?.();
    } finally {
      this.probing = false;
    }
  }

}
