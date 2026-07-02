/**
 * streamBufferStore.ts — SubAgentStreamEvent 영속화.
 *
 * 각 subagent가 emit하는 스트림 이벤트를 프로젝트 save 디렉토리 하위
 * `sub-streams/<parentAgentId>/<subId>.jsonl` 에 append-only로 기록한다.
 * 부모 에이전트별로 독립된 폴더로 분리 — 커스텀 에이전트가 여러 개여도 섞이지 않음.
 *
 * 경로 규약 (statePersistence.projectDirForInfo 재사용):
 *   일반     : save/<project>/sub-streams/<agentId>/<subId>.jsonl
 *   worktree : save/<parent>/worktrees/<wt>/sub-streams/<agentId>/<subId>.jsonl
 *
 * 이 모듈은 순수 파일시스템 유틸 — ProjectInfo 해석은 호출자(subAgentManager) 담당.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectInfo, SubAgentStreamEvent } from '@vibisual/shared';
import { logger } from '../logger.js';
import { projectDirForInfo } from './statePersistence.js';

function sanitize(segment: string): string {
  // 경로 주입 방지 — 안전 문자만 허용
  return segment.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** 프로젝트 + 부모 에이전트 단위의 sub-streams 디렉토리 경로. */
export function subStreamsDir(info: ProjectInfo, parentAgentId: string): string {
  return path.join(projectDirForInfo(info), 'sub-streams', sanitize(parentAgentId));
}

function subFile(dir: string, subAgentId: string): string {
  return path.join(dir, `${sanitize(subAgentId)}.jsonl`);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── 디스크 append 배칭 (성능) ───
// 과거: 스트림 이벤트마다 fs.appendFileSync(open→write→close)를 동기로 실행 →
// 멀티에이전트가 초당 수백~수천 이벤트를 뿜으면 Node 이벤트 루프가 통째로 블로킹(서버 멈칫).
// 지금: 파일별 pending 큐에 직렬화된 줄을 모아 (a) 250ms 주기 (b) 파일당 100줄 초과
// (c) loadBuffer/deleteBuffer 직전 (d) 프로세스 종료 시 — 중 먼저 오는 시점에 한 번에 기록.
// 순서는 append 순서 그대로 보존된다(배열 push 순).
const FLUSH_INTERVAL_MS = 250;
const FLUSH_MAX_LINES = 100;
/** filePath → 아직 디스크에 안 쓴 직렬화 줄들(도착 순서). */
const pending = new Map<string, string[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(flushAll, FLUSH_INTERVAL_MS);
  // 이 타이머 하나 때문에 프로세스가 종료를 미루지 않도록.
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

/** 단일 파일의 pending 을 디스크에 기록하고 큐에서 제거. */
function flushFile(fp: string): void {
  const arr = pending.get(fp);
  pending.delete(fp);
  if (!arr || arr.length === 0) return;
  try {
    ensureDir(path.dirname(fp));
    fs.appendFileSync(fp, arr.join('\n') + '\n', 'utf8');
  } catch (err) {
    logger.warn(`streamBufferStore flush failed (${path.basename(fp)}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 모든 파일의 pending 을 즉시 기록. 타이머·프로세스 종료 시 호출. */
export function flushAll(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  for (const fp of Array.from(pending.keys())) flushFile(fp);
}

// 프로세스 종료 시 유실 방지 — exit 핸들러는 동기 코드만 가능하므로 appendFileSync 로 flush.
process.once('exit', () => { try { flushAll(); } catch { /* best effort */ } });

export function appendEvent(dir: string, event: SubAgentStreamEvent): void {
  const fp = subFile(dir, event.subAgentId);
  let arr = pending.get(fp);
  if (!arr) { arr = []; pending.set(fp, arr); }
  arr.push(JSON.stringify(event));
  if (arr.length >= FLUSH_MAX_LINES) flushFile(fp);
  else scheduleFlush();
}

/** 파일에서 마지막 `max`개 이벤트를 복원. 손상된 라인은 스킵. */
export function loadBuffer(dir: string, subAgentId: string, max: number): SubAgentStreamEvent[] {
  try {
    const fp = subFile(dir, subAgentId);
    // 아직 디스크에 안 쓴 pending 이 있으면 먼저 기록해 최신 이벤트 누락 방지.
    flushFile(fp);
    if (!fs.existsSync(fp)) return [];
    const raw = fs.readFileSync(fp, 'utf8');
    const lines = raw.split('\n');
    const events: SubAgentStreamEvent[] = [];
    for (const line of lines) {
      if (!line) continue;
      try {
        const evt = JSON.parse(line) as SubAgentStreamEvent;
        if (evt && typeof evt.id === 'string' && typeof evt.subAgentId === 'string') {
          events.push(evt);
        }
      } catch { /* skip corrupt line */ }
    }
    if (events.length > max) events.splice(0, events.length - max);
    return events;
  } catch (err) {
    logger.warn(`streamBufferStore load failed (${subAgentId}): ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export function deleteBuffer(dir: string, subAgentId: string): void {
  try {
    const fp = subFile(dir, subAgentId);
    // pending 을 버려 삭제 직후 재기록으로 파일이 되살아나지 않게.
    pending.delete(fp);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    // 에이전트 폴더가 비었으면 함께 제거
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch (err) {
    logger.warn(`streamBufferStore delete failed (${subAgentId}): ${err instanceof Error ? err.message : String(err)}`);
  }
}
