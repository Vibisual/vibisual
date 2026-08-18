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
import { atomicWriteFileSync, projectDirForInfo } from './statePersistence.js';
import { findTailLineOffset, scanTailLines } from './jsonlChunkReader.js';
import { isUnderDeadWorktree, shouldReportDeadWorktree } from './worktreeLiveness.js';

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
  // v3.71: 죽은 워크트리(`.git` 없음)에는 기록하지 않는다 — ensureDir 이 폴더를 새로 만들어
  // 사용자가 지운 워크트리 디렉토리를 되살리는 경로였다(writeCheckpoint 가드와 같은 판정).
  if (isUnderDeadWorktree(fp)) {
    if (shouldReportDeadWorktree(`stream:${path.dirname(fp)}`)) {
      logger.warn(`streamBufferStore: dropping ${arr.length} event(s) — target is a dead worktree: ${fp}`);
    }
    return;
  }
  try {
    ensureDir(path.dirname(fp));
    fs.appendFileSync(fp, arr.join('\n') + '\n', 'utf8');
    compactIfNeeded(fp);
  } catch (err) {
    logger.warn(`streamBufferStore flush failed (${path.basename(fp)}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── 컴팩션 (v4.67) ───
// 이 jsonl 은 append-only 라 상한이 없었고, 긴 세션 하나가 2.6MB 까지 자랐다(총 295개 44MB).
// 그런데 **읽기 경로는 전부 `loadBuffer(dir, id, MAX_STREAM_BUFFER)` 하나**뿐이라
// (subAgentManager 6곳) 뒤 그만큼만 살아있으면 복원 결과가 완전히 동일하다.
// 그래서 파일이 커지면 넉넉히 뒤 KEEP 줄만 남기고 원자적으로 다시 쓴다 — 소비자에게는 no-op.
//
// ⚠ KEEP 은 반드시 MAX_STREAM_BUFFER 보다 커야 한다. 작게 잡으면 그때부터는 복원 데이터가
//   실제로 깎인다(= 기존 동작 변경).
// §5.5 v4.92 — 읽기 상한이 500 → 2,000 으로 오르면서 KEEP 도 1,000 → 3,000 으로 함께 올린다.
//   (KEEP 을 그대로 뒀다면 상한만 올린 쪽이 헛돌아 복원 대화가 1,000 줄에서 잘렸다.)
const COMPACT_KEEP_LINES = 3_000;
/** 이 크기를 넘을 때만 재작성 — 매 flush 마다 전체를 다시 쓰면 배칭의 이점이 사라진다. */
const COMPACT_TRIGGER_BYTES = 3 * 1024 * 1024;

function compactIfNeeded(fp: string): void {
  let size: number;
  try {
    size = fs.statSync(fp).size;
  } catch {
    return; // 파일이 사라짐 등 — 다음 flush 에서 다시 본다.
  }
  if (size <= COMPACT_TRIGGER_BYTES) return;
  try {
    // §3.2.4 G축 — 남길 것은 뒤 KEEP 줄뿐인데 종전엔 파일을 통째로 읽어(`readFileSync`) 전 줄을
    // 배열로 펼친 뒤 잘랐다. 3MB 짜리를 컴팩션하려고 그 4~5배 피크를 잡던 자리다.
    // 이제 꼬리 시작점을 먼저 집어 **남길 만큼만** 읽는다 — 결과 파일은 종전과 같다.
    const start = findTailLineOffset(fp, COMPACT_KEEP_LINES);
    if (start === 0) return; // 줄이 KEEP 이하 — 한 줄이 비정상적으로 큰 경우라 건드리지 않는다.
    const kept: string[] = [];
    scanTailLines(fp, COMPACT_KEEP_LINES, (line) => { kept.push(line); });
    if (kept.length === 0) return;
    // §3.2.1-1 원자적 쓰기 — 재작성 도중 종료돼도 기존 파일이 반파되지 않는다.
    atomicWriteFileSync(fp, kept.join('\n') + '\n');
    logger.info(
      `streamBufferStore: compacted ${path.basename(fp)} — kept last ${kept.length} events ` +
      `(${(size / 1024 / 1024).toFixed(1)}MB → ${(fs.statSync(fp).size / 1024 / 1024).toFixed(1)}MB)`,
    );
  } catch (err) {
    // 컴팩션 실패는 비치명 — 원본이 그대로 남을 뿐이다.
    logger.warn(`streamBufferStore compact failed (${path.basename(fp)}): ${err instanceof Error ? err.message : String(err)}`);
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

/**
 * 파일 지문 — 크기와 mtime. append-only 라 크기만으로도 대개 갈리지만 **컴팩션이 크기를 줄이므로**
 * mtime 을 함께 본다. 파일이 없으면 `null`(그것도 "없다"는 하나의 상태라 지문으로 쓴다).
 */
function fileStamp(fp: string): string | null {
  try {
    const st = fs.statSync(fp);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
}

function readTailEvents(fp: string, subAgentId: string, max: number): SubAgentStreamEvent[] {
  try {
    if (!fs.existsSync(fp)) return [];
    const events: SubAgentStreamEvent[] = [];
    // §3.2.4 G축 — 쓰는 것은 마지막 `max` 줄뿐인데 종전엔 파일을 통째로 읽고(`readFileSync`)
    // 전 줄을 `JSON.parse` 한 뒤 앞을 잘랐다. 2.5MB 짜리 한 벌을 읽을 때마다 그 4~5배 피크와
    // 전 줄 파싱 비용을 냈고, 이 경로가 반복 호출되며 메인 프로세스 읽기가 누적 537GB
    // (디스크 총량의 약 230배)까지 갔다(실측 2026-08-15). 이제 꼬리만 읽어 꼬리만 파싱한다.
    scanTailLines(fp, max, (line) => {
      try {
        const evt = JSON.parse(line) as SubAgentStreamEvent;
        if (evt && typeof evt.id === 'string' && typeof evt.subAgentId === 'string') {
          events.push(evt);
        }
      } catch { /* skip corrupt line */ }
    });
    if (events.length > max) events.splice(0, events.length - max);
    return events;
  } catch (err) {
    logger.warn(`streamBufferStore load failed (${subAgentId}): ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** 파일에서 마지막 `max`개 이벤트를 복원. 손상된 라인은 스킵. */
export function loadBuffer(dir: string, subAgentId: string, max: number): SubAgentStreamEvent[] {
  const fp = subFile(dir, subAgentId);
  // 아직 디스크에 안 쓴 pending 이 있으면 먼저 기록해 최신 이벤트 누락 방지.
  flushFile(fp);
  return readTailEvents(fp, subAgentId, max);
}

/** `loadBufferIfChanged` 결과. */
export interface BufferLoadResult {
  /** 지난 지문 이후 파일이 달라졌는지. `false` 면 `events` 는 비고, 호출자는 들고 있던 것을 그대로 쓴다. */
  changed: boolean;
  /** 이번 시점의 지문 — 다음 호출에 그대로 넘긴다. */
  stamp: string | null;
  events: SubAgentStreamEvent[];
}

/**
 * `loadBuffer` 와 같되 **파일이 지난번과 같으면 읽지 않는다**(`stat` 한 번으로 끝).
 *
 * **왜**: 읽기 경로(`getStreamBuffer`·`getStreamBuffersForAgent`)가 결과가 비면 캐시하지 않아,
 * 파일이 없거나 빈 세션은 호출마다 파일을 다시 열었다. 내용이 있는 세션도 호출마다 꼬리를 다시
 * 파싱했다. 지문이 같으면 그 두 경우 모두 `stat` 한 번으로 끝난다.
 *
 * `prevStamp` 가 `undefined` 면 "읽은 적 없음"이라 항상 읽는다. `null` 은 "지난번엔 파일이 없었다"는
 * 유효한 지문이라, 여전히 없으면 변화 없음으로 친다.
 */
export function loadBufferIfChanged(
  dir: string,
  subAgentId: string,
  max: number,
  prevStamp: string | null | undefined,
): BufferLoadResult {
  const fp = subFile(dir, subAgentId);
  // pending 을 먼저 내려야 지문이 최신 상태를 가리킨다(안 그러면 방금 들어온 줄을 놓친다).
  flushFile(fp);
  const stamp = fileStamp(fp);
  if (prevStamp !== undefined && stamp === prevStamp) return { changed: false, stamp, events: [] };
  return { changed: true, stamp, events: readTailEvents(fp, subAgentId, max) };
}

/**
 * 부모 에이전트의 sub-streams 폴더를 통째로 삭제 — **휴지통 영구 삭제 전용**(v4.67).
 *
 * ⚠ 탭 닫기(`remove`)·idle 회수(`sweepIdle`)·lifecycle 제거에는 절대 배선하지 말 것.
 *   그 셋은 "메모리는 비우고 디스크에서 다시 읽는다"가 명세된 복구 경로라, 여기서 파일을 지우면
 *   IDE 재오픈·아카이브 부활·크래시 복구가 빈 화면이 된다. 묘비가 남아 되살아날 수 없는
 *   영구 삭제(`permanentlyDeleteTrashedAgent`)에서만 호출한다.
 */
export function deleteAgentStreams(dir: string): void {
  try {
    // pending 을 먼저 버린다 — 안 그러면 250ms 뒤 flush 가 폴더를 되살린다(deleteBuffer 와 같은 이유).
    const target = path.resolve(dir);
    for (const fp of Array.from(pending.keys())) {
      if (path.resolve(path.dirname(fp)) === target) pending.delete(fp);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    logger.warn(`streamBufferStore purge failed (${path.basename(dir)}): ${err instanceof Error ? err.message : String(err)}`);
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
