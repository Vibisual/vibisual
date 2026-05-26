/**
 * §5.7 #23-2 v1.60 — Agent View 백그라운드 세션의 JSONL transcript tail watcher.
 *
 * Anthropic supervisor 가 작성하는 `~/.claude/projects/<cwdKey>/<sessionId>.jsonl` 을 chokidar 로 tail.
 * 파일이 append-only 이므로 마지막 읽은 offset 을 들고 있다가 새 chunk 만 읽어 라인 파싱.
 *
 * 책임 분리:
 * - 본 모듈: JSONL 파일 watching + 라인 파싱 + `parseStreamLine` 호출 → 콜백으로 이벤트 전달.
 * - 호출자(subAgentManager): SubAgentStreamEvent 를 WebSocket 으로 push + sub 상태 갱신.
 * - 완료 감지: 별도 `state.json` watcher 로 terminal state 감지(별 모듈로 두지 않고 같은 attach 호출에서 함께 시작).
 */
import { promises as fsp } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chokidar, { type FSWatcher } from 'chokidar';
import type { SubAgentStreamEvent, AgentViewJobState } from '@vibisual/shared';
import { logger } from '../logger.js';
import { parseStreamLine } from './subAgentManager.js';
import { readJobState } from './claudeAgentViewService.js';

const HOME = os.homedir();
const JOBS_DIR = path.join(HOME, '.claude', 'jobs');

/** terminal state — 더 이상 새 이벤트가 안 오는 상태. */
const TERMINAL_STATES = new Set(['done', 'failed', 'stopped']);

/** state.json mtime 폴링 주기 (chokidar 가 잡지 못하는 atomic-rename 케이스 폴백). */
const STATE_POLL_INTERVAL_MS = 750;

export interface AgentViewWatchHandle {
  /** 추적 중인 short id */
  short: string;
  /** chokidar JSONL watcher */
  jsonlWatcher: FSWatcher;
  /** state.json polling timer (terminal state 감지) */
  statePollTimer: NodeJS.Timeout;
  /** 마지막으로 읽은 JSONL 파일 byte offset */
  offset: number;
  /** 라인 버퍼 — 청크가 라인 경계에서 잘릴 때 이어 붙임 */
  lineBuf: string;
  /** terminal state 도달 여부 (idempotent guard) */
  terminated: boolean;
}

/** attach 옵션 — 우리 SubAgent 식별자 + 콜백들. */
export interface AgentViewAttachOptions {
  short: string;
  sessionId: string;
  jsonlPath: string;
  subAgentId: string;
  parentAgentId: string;
  /** 새 라인 파싱 결과 이벤트들. 호출자가 그대로 WS 푸시 + sub 메타 갱신. */
  onEvents: (events: SubAgentStreamEvent[]) => void;
  /** 라인 단위 raw object — assistant 메시지 카운팅(maxTurns 등) 처럼 parsed event 만으론 도출 불가한
   *  정보가 필요할 때 후킹. parseStreamLine 호출 직전 1회 발사. */
  onLine?: (obj: Record<string, unknown>) => void;
  /** state.json 폴링에서 terminal state 도달 시 1회 호출. */
  onTerminal: (state: AgentViewJobState) => void;
  /**
   * 과거 JSONL 라인을 무시하고 새 라인만 받을지(reconnect 직후 텍스트 폭풍 회피).
   * 기본 false — 첫 attach 는 처음부터 다 처리해서 UI 가 대화를 재구성할 수 있게.
   */
  skipExisting?: boolean;
}

const HANDLES = new Map<string, AgentViewWatchHandle>(); // key: short

/**
 * JSONL transcript 한 파일을 tail. 이미 attach 되어 있으면 기존 handle 반환(idempotent).
 *
 * 동작:
 * 1) `skipExisting=false` 일 때 파일이 이미 존재하면 처음부터 끝까지 한 번 읽어 historical 라인 처리.
 * 2) chokidar 로 파일 watch — 'add'/'change' 마다 offset 이후 신규 바이트만 읽어 라인 파싱.
 * 3) `state.json` 을 `STATE_POLL_INTERVAL_MS` 주기로 폴링해 terminal state 감지.
 */
export async function attach(opts: AgentViewAttachOptions): Promise<AgentViewWatchHandle> {
  const existing = HANDLES.get(opts.short);
  if (existing) return existing;

  let initialOffset = 0;
  if (opts.skipExisting) {
    try {
      const st = fs.statSync(opts.jsonlPath);
      initialOffset = st.size;
    } catch { initialOffset = 0; }
  }

  const handle: AgentViewWatchHandle = {
    short: opts.short,
    jsonlWatcher: chokidar.watch(opts.jsonlPath, {
      // 파일이 아직 없을 수 있음 — chokidar 가 'add' 로 알려줌.
      persistent: true,
      // append-only 라 atomic 옵션 불필요. mtime 폴링 폴백을 위해 usePolling=true 도 고려했으나
      // chokidar v5+ 는 native fs.watch 가 안정적이라 기본값으로 시작.
      awaitWriteFinish: false,
      ignoreInitial: false,
    }),
    statePollTimer: setInterval(() => pollState(opts), STATE_POLL_INTERVAL_MS),
    offset: initialOffset,
    lineBuf: '',
    terminated: false,
  };
  HANDLES.set(opts.short, handle);

  const readDelta = async (): Promise<void> => {
    try {
      const st = await fsp.stat(opts.jsonlPath).catch(() => null);
      if (!st || !st.isFile()) return;
      if (st.size <= handle.offset) return;
      const fd = await fsp.open(opts.jsonlPath, 'r');
      try {
        const len = st.size - handle.offset;
        const buf = Buffer.alloc(len);
        await fd.read(buf, 0, len, handle.offset);
        handle.offset = st.size;
        const chunk = handle.lineBuf + buf.toString('utf8');
        const lines = chunk.split('\n');
        handle.lineBuf = lines.pop() ?? '';
        const events: SubAgentStreamEvent[] = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const obj = JSON.parse(trimmed) as Record<string, unknown>;
            if (opts.onLine) {
              try { opts.onLine(obj); } catch (err) {
                logger.warn(`[agent-view watcher] onLine threw for ${opts.short}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
            const evs = parseStreamLine(obj, opts.subAgentId, opts.parentAgentId);
            for (const e of evs) events.push(e);
            // §5.7 #23-2 v1.60 — turn 종료 신호. `--bg` worker 는 turn 끝나도 죽지 않고
            // 'idle' 로 다음 prompt 대기하므로 state.json 의 terminal state 만 보면 영원히 안 떨어진다.
            // JSONL 의 `{type:'system', subtype:'turn_duration'}` 가 "이 turn 끝났음" 의 정식 신호 —
            // 본 라운드의 cmd 마무리 트리거로 사용.
            if (!handle.terminated && obj['type'] === 'system' && obj['subtype'] === 'turn_duration') {
              handle.terminated = true;
              const real = readJobState(opts.short);
              // turn 단위 종료이므로 supervisor 가 보고하는 state(idle/working)와 무관하게
              // caller 에게 'done' 으로 통일해 cmd 를 completed 로 봉합하게 한다.
              const synthetic: AgentViewJobState = { ...(real ?? { state: 'done' }), state: 'done' };
              try { opts.onTerminal(synthetic); } catch (err) {
                logger.warn(`[agent-view watcher] onTerminal(turn_duration) threw for ${opts.short}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          } catch (err) {
            logger.warn(`[agent-view watcher] JSON parse error in ${opts.short}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (events.length > 0) opts.onEvents(events);
      } finally {
        await fd.close();
      }
    } catch (err) {
      logger.warn(`[agent-view watcher] readDelta(${opts.short}) failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  handle.jsonlWatcher.on('add', () => { void readDelta(); });
  handle.jsonlWatcher.on('change', () => { void readDelta(); });
  handle.jsonlWatcher.on('error', (err: unknown) => {
    logger.warn(`[agent-view watcher] chokidar error for ${opts.short}: ${err instanceof Error ? err.message : String(err)}`);
  });

  // 파일이 이미 있으면 즉시 1회 읽어 historical 라인 처리(skipExisting=false 케이스).
  if (!opts.skipExisting) {
    void readDelta();
  }

  return handle;
}

/** state.json 폴링 — terminal state 감지 시 onTerminal 1회 호출 후 detach. */
function pollState(opts: AgentViewAttachOptions): void {
  const handle = HANDLES.get(opts.short);
  if (!handle || handle.terminated) return;
  const state = readJobState(opts.short);
  if (!state) return;
  if (typeof state.state === 'string' && TERMINAL_STATES.has(state.state)) {
    handle.terminated = true;
    try { opts.onTerminal(state); } catch (err) {
      logger.warn(`[agent-view watcher] onTerminal threw for ${opts.short}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // detach 는 호출자가 결정 — auto-detach 하지 않는다(추가 메타 작업이 필요할 수 있음).
  }
}

/** watcher 정리. 호출 안 하면 chokidar/timer 가 누수됨. */
export async function detach(short: string): Promise<void> {
  const h = HANDLES.get(short);
  if (!h) return;
  clearInterval(h.statePollTimer);
  try {
    await h.jsonlWatcher.close();
  } catch (err) {
    logger.warn(`[agent-view watcher] detach close error for ${short}: ${err instanceof Error ? err.message : String(err)}`);
  }
  HANDLES.delete(short);
}

/** 디버그/테스트용 — 현재 attached 된 short 목록. */
export function listAttached(): string[] {
  return Array.from(HANDLES.keys());
}

/** 종료 hook 에서 일괄 정리. */
export async function detachAll(): Promise<void> {
  const shorts = Array.from(HANDLES.keys());
  await Promise.all(shorts.map((s) => detach(s)));
}

/** JOBS_DIR — index.ts 가 reconcile 시 directory presence 확인에 쓸 수 있게 export. */
export const AGENT_VIEW_JOBS_DIR = JOBS_DIR;
