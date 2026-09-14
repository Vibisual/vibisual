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
 *   보관     : 같은 폴더의 <subId>.archive.jsonl — 컴팩션으로 본 파일에서 밀려난 앞부분(지우지 않는다)
 *
 * 이 모듈은 순수 파일시스템 유틸 — ProjectInfo 해석은 호출자(subAgentManager) 담당.
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSONL_SCAN_CHUNK_BYTES, SUB_STREAM_ARCHIVE_SUFFIX } from '@vibisual/shared';
import type { ProjectInfo, SubAgentStreamEvent } from '@vibisual/shared';
import { logger } from '../logger.js';
import { atomicWriteFileSync, projectDirForInfo } from './statePersistence.js';
import { findTailLineOffset, scanFileLines, scanLinesBackward, scanTailLines } from './jsonlChunkReader.js';
import { isUnderDeadWorktree, shouldReportDeadWorktree } from './worktreeLiveness.js';
import { restoreLinkedImages } from './streamLinkedImages.js';

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

/** 본 파일 경로 → 그 세션의 보관 파일 경로(`<subId>.archive.jsonl`). */
function archivePathOf(fp: string): string {
  return `${fp.slice(0, -'.jsonl'.length)}${SUB_STREAM_ARCHIVE_SUFFIX}`;
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
// 그래서 파일이 커지면 넉넉히 뒤 KEEP 줄만 본 파일에 남기고 원자적으로 다시 쓴다.
//
// ⚠ KEEP 은 반드시 MAX_STREAM_BUFFER 보다 커야 한다. 작게 잡으면 그때부터는 복원 창이
//   실제로 깎인다(= 기존 동작 변경).
// §5.5 v4.92 — 읽기 상한이 500 → 2,000 으로 오르면서 KEEP 도 1,000 → 3,000 으로 함께 올린다.
//   (KEEP 을 그대로 뒀다면 상한만 올린 쪽이 헛돌아 복원 대화가 1,000 줄에서 잘렸다.)
//
// §3.2.3 — **밀려난 앞부분은 지우지 않고 보관 파일로 옮긴다.** 종전엔 "읽기 경로가 마지막 2,000건
//   하나뿐이라 앞부분은 어차피 안 읽힌다"는 전제로 지웠다. 그 전제 때문에 3MB 를 넘긴 긴 대화는
//   다시 열었을 때 앞 몇 시간이 말풍선만 남은 채 **디스크에서도 영영 사라졌다**(실측 2026-09-12 —
//   `sub-mtpny1dz-er2x3b` 머리 약 5시간·`sub-mtrf4f0q-og5w77` 약 48분이 이미 없었다). 이제 IDE 가
//   복원 창 위쪽을 거슬러 읽으므로(`loadEventsBefore`) 앞부분도 읽기 경로가 닿는 범위다.
//   순서가 곧 안전장치다 — 보관 파일에 옮겨 적고 디스크에 내려앉은 것(`fsync`)을 확인한 **뒤에만**
//   본 파일을 줄인다. 그 사이에 꺼지면 같은 줄이 두 곳에 남을 뿐(읽을 때 id 로 거른다) 사라지지 않는다.
const COMPACT_KEEP_LINES = 3_000;
/** 이 크기를 넘을 때만 재작성 — 매 flush 마다 전체를 다시 쓰면 배칭의 이점이 사라진다. */
const COMPACT_TRIGGER_BYTES = 3 * 1024 * 1024;

/**
 * 본 파일의 `[0, headEnd)` 를 보관 파일 끝에 **바이트 그대로** 옮겨 적는다(다시 파싱하지 않는다).
 * 디스크에 내려앉은 것을 확인했을 때만 `true` — 호출자는 그때만 본 파일에서 앞부분을 걷어낸다.
 */
function appendHeadToArchive(fp: string, headEnd: number): boolean {
  const ap = archivePathOf(fp);
  let src: number | null = null;
  let dst: number | null = null;
  try {
    // 보관 파일이 개행 없이 끝나 있으면(직전 옮겨 적기가 도중에 끊긴 경우) 그 줄부터 닫는다 —
    // 안 닫으면 이번 첫 줄이 반쪽 줄에 들러붙어 둘 다 못 읽는다.
    let needsNewline = false;
    try {
      const archiveSize = fs.statSync(ap).size;
      if (archiveSize > 0) {
        const probe = fs.openSync(ap, 'r');
        try {
          const last = Buffer.alloc(1);
          fs.readSync(probe, last, 0, 1, archiveSize - 1);
          needsNewline = last[0] !== 0x0a;
        } finally {
          fs.closeSync(probe);
        }
      }
    } catch { /* 보관 파일이 아직 없다 — 새로 만든다 */ }
    src = fs.openSync(fp, 'r');
    dst = fs.openSync(ap, 'a');
    if (needsNewline) fs.writeSync(dst, '\n');
    const chunk = Buffer.allocUnsafe(Math.max(1, Math.min(JSONL_SCAN_CHUNK_BYTES, headEnd)));
    let pos = 0;
    while (pos < headEnd) {
      const n = fs.readSync(src, chunk, 0, Math.min(chunk.length, headEnd - pos), pos);
      if (n <= 0) return false;
      let written = 0;
      while (written < n) written += fs.writeSync(dst, chunk, written, n - written);
      pos += n;
    }
    fs.fsyncSync(dst);
    return true;
  } catch (err) {
    logger.warn(`streamBufferStore archive failed (${path.basename(fp)}): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  } finally {
    if (src !== null) { try { fs.closeSync(src); } catch { /* 무시 */ } }
    if (dst !== null) { try { fs.closeSync(dst); } catch { /* 무시 */ } }
  }
}

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
    // 이제 꼬리 시작점을 먼저 집어 **남길 만큼만** 읽는다.
    const start = findTailLineOffset(fp, COMPACT_KEEP_LINES);
    if (start === 0) return; // 줄이 KEEP 이하 — 한 줄이 비정상적으로 큰 경우라 건드리지 않는다.
    // §3.2.3 — 앞부분을 먼저 보관 파일로. 못 옮겼으면 본 파일을 건드리지 않는다(다음 flush 에서 다시 본다).
    if (!appendHeadToArchive(fp, start)) return;
    const kept: string[] = [];
    // 옮겨 적은 `[0, start)` 와 남길 `[start, size)` 가 **정확히 맞물리게** 같은 시작점에서 읽는다.
    const { pendingTail } = scanFileLines(fp, start, size, (line) => { kept.push(line); });
    if (pendingTail !== '') kept.push(pendingTail);
    if (kept.length === 0) return;
    // §3.2.1-1 원자적 쓰기 — 재작성 도중 종료돼도 기존 파일이 반파되지 않는다.
    atomicWriteFileSync(fp, kept.join('\n') + '\n');
    logger.info(
      `streamBufferStore: compacted ${path.basename(fp)} — kept last ${kept.length} events, head archived ` +
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
    return restoreLinkedImages(events, process.platform).slice(-max);
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

/** `loadEventsBefore` 결과 — 기준점 바로 앞의 한 쪽. */
export interface OlderEventsPage {
  /** 오래된 것 → 최신 순. 기준점 자신은 들지 않는다. */
  events: SubAgentStreamEvent[];
  /** 이 쪽보다 더 오래된 줄이 아직 남아 있는가(본 파일 앞부분 또는 보관 파일). */
  hasMore: boolean;
}

/** 읽기 경로가 덧붙이는 그림 줄의 id 꼬리(`streamLinkedImages` — `${id}:image:${n}`). 파일에는 없다. */
const LINKED_IMAGE_ID = /:image:\d+$/;

/**
 * §5.5 #17-12 — 복원 창 **위쪽**을 거슬러 읽는다: 기준 이벤트 바로 앞의 최대 `limit` 건.
 *
 * 본 파일을 뒤에서부터 읽고, 모자라면 보관 파일(컴팩션으로 밀려난 앞부분)로 이어 간다.
 *  - 기준점은 `beforeId`(클라가 들고 있는 가장 오래된 이벤트). 파일 순서로 **그 줄보다 앞**의 줄만 담는다.
 *  - 그 id 를 어디서도 못 찾으면(디스크에 안 내려간 줄이었다) `beforeTs` 보다 이른 줄로 대신 고른다.
 *  - 같은 id 는 한 번만 싣는다 — 컴팩션 도중 꺼지면 같은 줄이 두 파일에 남을 수 있다(`compactIfNeeded`).
 *    기준점보다 뒤에서 이미 본 id 도 거른다(클라가 이미 들고 있는 것이다).
 */
export function loadEventsBefore(
  dir: string,
  subAgentId: string,
  cursor: { beforeId?: string; beforeTs?: number },
  limit: number,
): OlderEventsPage {
  const fp = subFile(dir, subAgentId);
  // 아직 디스크에 안 쓴 줄이 있으면 먼저 내린다 — 기준점이 그 안에 있을 수 있다.
  flushFile(fp);
  const max = Math.max(1, Math.floor(limit));
  const rawId = typeof cursor.beforeId === 'string' ? cursor.beforeId : '';
  // 그림 줄은 파일에 없다 — 그 그림을 낳은 본문 줄을 기준으로 삼고, 그 본문 줄도 함께 싣는다
  //   (클라가 그림만 들고 본문은 창 밖으로 밀려났을 수 있다 — 중복은 클라가 id 로 거른다).
  const beforeId = rawId.replace(LINKED_IMAGE_ID, '');
  const includeAnchor = beforeId !== rawId;
  const beforeTs = typeof cursor.beforeTs === 'number' && Number.isFinite(cursor.beforeTs)
    ? cursor.beforeTs
    : Number.POSITIVE_INFINITY;
  const idMode = beforeId !== '';

  let anchorFound = !idMode;
  let hasMore = false;
  /** 기준점보다 뒤(파일 순서)에서 본 id — 중복 사본과 클라가 이미 가진 줄을 거른다. */
  const newer = new Set<string>();
  const page: SubAgentStreamEvent[] = []; // 최신 → 오래된 순으로 쌓는다
  const pageIds = new Set<string>();
  /** 기준 id 를 끝내 못 찾았을 때 쓸 시각 기준 후보(최신 쪽 `max + 1` 건까지만). */
  const byTs: SubAgentStreamEvent[] = [];
  const byTsIds = new Set<string>();

  const take = (evt: SubAgentStreamEvent): boolean => {
    if (newer.has(evt.id) || pageIds.has(evt.id)) return true;
    if (page.length >= max) { hasMore = true; return false; }
    page.push(evt);
    pageIds.add(evt.id);
    return true;
  };

  const onLine = (line: string): boolean | void => {
    let evt: SubAgentStreamEvent;
    try {
      evt = JSON.parse(line) as SubAgentStreamEvent;
    } catch {
      return; // 손상된 줄은 건너뛴다(readTailEvents 와 같은 규약)
    }
    if (!evt || typeof evt.id !== 'string' || typeof evt.subAgentId !== 'string') return;
    if (!anchorFound) {
      if (evt.id === beforeId) {
        anchorFound = true;
        if (includeAnchor) return take(evt);
        // 기준점 자신도 "클라가 이미 가진 줄"이다 — 보관 파일에 남은 그 사본이 과거 쪽에 섞이지 않게.
        newer.add(evt.id);
        return;
      }
      if (byTs.length <= max && evt.timestamp < beforeTs && !byTsIds.has(evt.id) && !newer.has(evt.id)) {
        byTs.push(evt);
        byTsIds.add(evt.id);
      }
      newer.add(evt.id);
      return;
    }
    if (!idMode && !(evt.timestamp < beforeTs)) {
      newer.add(evt.id);
      return;
    }
    return take(evt);
  };

  try {
    const stopped = scanLinesBackward(fp, onLine);
    const archive = archivePathOf(fp);
    if (!stopped && fs.existsSync(archive)) scanLinesBackward(archive, onLine);
  } catch (err) {
    logger.warn(`streamBufferStore older-page failed (${subAgentId}): ${err instanceof Error ? err.message : String(err)}`);
  }

  let picked: SubAgentStreamEvent[];
  if (idMode && !anchorFound) {
    hasMore = byTs.length > max;
    picked = byTs.slice(0, max);
  } else {
    picked = page;
  }
  picked.reverse();
  return { events: restoreLinkedImages(picked, process.platform), hasMore };
}

/**
 * 이 폴더에 그 세션의 스트림 파일이 실재하는가 — **읽지 않고 존재만** 본다.
 *
 * 소속 프로젝트를 잃은 세션의 스트림을 되찾을 때 쓴다(`subAgentManager.findStreamDirFor`).
 * 후보 폴더를 여럿 훑어야 하므로 파싱까지 하면 헛일이 커진다 — 있는 자리를 고른 다음 한 번만 읽는다.
 */
export function hasBuffer(dir: string, subAgentId: string): boolean {
  const fp = subFile(dir, subAgentId);
  // 아직 디스크에 안 내려간 첫 줄이 pending 에만 있을 수 있다 — 그것도 "있다"로 친다.
  if (pending.has(fp)) return true;
  try {
    return fs.existsSync(fp);
  } catch {
    return false;
  }
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
    // 보관 파일은 그 세션의 앞부분이다 — 세션을 지우는 호출이면 함께 지운다(남기면 주인 없는 고아가 된다).
    const archive = archivePathOf(fp);
    if (fs.existsSync(archive)) fs.unlinkSync(archive);
    // 에이전트 폴더가 비었으면 함께 제거
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch (err) {
    logger.warn(`streamBufferStore delete failed (${subAgentId}): ${err instanceof Error ? err.message : String(err)}`);
  }
}
