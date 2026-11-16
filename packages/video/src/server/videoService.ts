/**
 * §5.13 Vibistudio — 서버 서비스. 서버는 그리지 않는다 — §3.7 단일 프로세스라 렌더 자식을 띄우지 않고 스틸·띠·렌더를 일감(job)으로 쌓아
 * 숨은 일꾼 창(§5.13 (T-4))이 처리한다. 편집은 낙관적 잠금으로 중재한다 — 여러 에이전트가 같은 문서를 동시에 만지는 게 기본이라
 * 마지막 쓰기가 조용히 이기면 작업이 사라진다. 경로는 `routes.ts` 가 기능별 `*Routes.ts` 로 나눠 붙인다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathKey } from '@vibisual/shared';
import { resolveVideoAssetAsync } from './assets.js';
import { VideoSourceSync } from './sourceSync.js';
import { compositionFingerprintAsync, compositionRefreshOps, needsCues } from './composition.js';
import { VersionBook, type VersionEntry } from './versionBook.js';
import { CHAPTER_THUMBS_TIMEOUT_MS, COMPARE_TIMEOUT_MS, CUES_TIMEOUT_MS, JOB_LEASE_MS, REVIEW_TIMEOUT_MS, STILL_TIMEOUT_MS, STRIP_TIMEOUT_MS, VIDEO_DIR, VIDEO_OUT_DIR, applyPatch, createEmptyDoc, settleCues, toPosixPath, validateDoc, resolveTimeline, type CueScanError, type VideoAsset, type VideoDoc, type VideoDocOp } from '../index.js';
import type { AppServerHost } from '../host.js';
import { VideoHistoryStore } from './historyStore.js';
import { ActivityBook } from './historyRoutes.js';
import { VideoNotesStore } from './notesRoutes.js';
import { RENDER_HISTORY_MAX } from '../constants.js';
import type { RenderOutputSpec, RenderSpec } from '../renderSpec.js';
import { thumbnailTime, type CompanionKind, type CompanionNote } from '../exportExtras.js';
import { ExportStore } from './exportStore.js';
import { placeRenderOutput } from './exportOutput.js';
import { writeNewFile } from './exportOutputFiles.js';
import { applyQueueAction, historyOverflow, isDue, nextScheduledAt, reorderJob, type HeldReason, type QueueAction, type QueueBulkAction } from './renderQueue.js';
import { fromQueueRecord, toQueueRecord } from './queueRecord.js';
import { isSafeId } from './routeSupport.js';


/** 끝난 일감을 얼마나 들고 있을지(ms). 결과를 가져갈 시간은 주되 무한정 쌓지 않는다. */
const JOB_RETENTION_MS = 10 * 60_000;


/**
 * `review` = 검수 표본(§5.13 (V) 37-9 — 판정은 서버의 순수 함수) · `cues` = 표지 모으기(§5.13 (T-8) — 길이에 비례해 렌더 줄) ·
 * `stills` = 여러 시각을 한 무대에서 차례로(§5.13 (X) 39-4 — 장마다 숨은 렌더 창을 세우지 않게) ·
 * `compare` = 이미 찍은 스틸 두 장을 나란히 한 장으로(§5.13 (G) 전후 비교 — 무대를 세우지 않는다).
 */
export type VideoJobKind = 'render' | 'still' | 'strip' | 'review' | 'cues' | 'stills' | 'compare';
/** §5.13 (T-4) — 일감 두 줄. 스틸·프레임 띠는 렌더 뒤에 줄 서지 않는다(4분짜리 렌더 중에도 스틸이 온다). */
export type VideoJobLane = 'still' | 'render';
export type VideoJobStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled';

export interface VideoJob {
  id: string;
  kind: VideoJobKind;
  projectPath: string;
  docId: string;
  status: VideoJobStatus;
  /** 0~1. 렌더 진행률. */
  progress: number;
  createdAt: number;
  updatedAt: number;
  /** `still`·`strip` 이면 data URL, `render` 면 만들어진 파일 경로. */
  result?: string;
  error?: string;
  /** `still` 전용 — 뽑을 시각(초). */
  t?: number;
  /** `strip` 전용 — 찍을 시각들(초, 앞에서부터). */
  times?: number[];
  /** `still`·`strip` — 결과 한 변 상한(px). 0 이면 문서 원본 크기. */
  maxEdge?: number;
  /** 렌더 방식이 강등됐다면 그 사실. 조용히 느려지지 않게 그대로 올린다. */
  note?: string;
  /** §5.13 (V) 37-3 — 판 기록의 한 판을 찍는 일감이면 그 판(일꾼은 지금 문서 대신 그 판의 문서·코드로 그린다). */
  revId?: string;
  /** §5.13 (T-8) — `cues` 전용 — 표지를 모을 컴포지션 소재. */
  assetId?: string;
  /** §5.13 (T-8) — 이 일감들이 끝나야 집힌다(렌더가 낡은 표지 모으기를 먼저 기다린다). */
  after?: string[];
  /** 기다리는 까닭(화면이 사람 말로 옮긴다) — `cues` = 표지를 먼저 모으는 중. */
  waitingFor?: 'cues';
  /** §5.13 (V) 37-15 — 자막 **따로 내기**: 자막 트랙을 숨기고 렌더한다(SRT 는 화면이 따로 낸다). */
  hideCaptions?: boolean;
  /** §5.13 (T-8) — 먼저 돌린 표지 모으기가 실패해 예전 표지 시각으로 그렸다(화면이 사람 말로 알린다). */
  cuesFailed?: boolean;
  /** §5.13 (W) 38-3 — 투명 배경 렌더(WebM + 알파 — 결과 파일도 `.webm`). */
  transparent?: boolean;
  /** §5.13 (W) 38-7 — `still` 이 장면 정지 화면이면 그 장면(일꾼이 그 컴포지션 하나짜리 문서로 그린다). */
  frameOf?: string;
  /** §5.13 (X) 39-4 — `stills` 의 그림 형식(작은 그림은 webp — 같은 크기 png 의 몇 분의 일이다). 없으면 png. */
  imageType?: 'png' | 'webp';
  /** §5.13 (G) `compare` 전용 — 붙일 두 그림(전·후 data URL)과 칸 위 글자. 끝나면 비운다(그림을 들고 있지 않게). */
  images?: string[];
  labels?: string[];
  /** §5.13 (AA) 42-5 — 줄의 순서(작을수록 먼저). 스틸 줄도 같은 값으로 먼저 들어온 것부터. */
  order: number;
  /** 문서 갤러리 포스터처럼 기다려도 되는 일감 — 같은 줄에서 먼저 들어온 일감보다도 뒤로 선다(`claimNext`). */
  background?: boolean;
  /** §5.13 (AA) 42-5 — 줄에 섰지만 멈춤(사람 · 놓친 예약 · 끊김 — `heldReason`). */
  held?: boolean;
  heldReason?: HeldReason;
  /** §5.13 (AA) 42-5 — 예약 시각(ms). 이 시각 전에는 집지 않는다. */
  notBefore?: number;
  /** §5.13 (AA) 42-5 — 도는 렌더를 멈췄다(일꾼이 프레임 사이에서 기다린다). */
  paused?: boolean;
  pausedAt?: number;
  /** 지금까지 멈춰 있던 시간(ms) — 남은 시간 계산에서 뺀다. */
  pausedMs?: number;
  startedAt?: number;
  finishedAt?: number;
  /** §5.13 (AA) 42-5 — 일꾼이 알린 프레임(초당 프레임 계산). */
  frame?: number;
  totalFrames?: number;
  /** §5.13 (AA) 42-1·42-2 — 그리는 방법과 결과를 놓는 방법(새 내보내기 화면이 건 일감만). */
  spec?: RenderSpec;
  output?: RenderOutputSpec;
  /** 대기열 줄에 쓰는 이름(문서 제목 · 판형·장면). */
  title?: string;
  label?: string;
  /** §5.13 (AA) 42-2 — 사용자가 보는 결과 파일(고른 폴더의 것, 없으면 `result`). */
  exported?: string;
  exportNote?: { code: 'export-failed' | 'overwrite-fallback'; detail?: string };
  /** §5.13 (AA) 42-13 — 함께 나온 딸림 파일(사용자가 보는 자리)과, 켰지만 나오지 않은 까닭. */
  companions?: Partial<Record<CompanionKind, string>>;
  companionNotes?: readonly CompanionNote[];
  /** §5.13 (AA) 42-7 — 캔버스 노드에 담았다(창이 닫혀 있는 동안 끝난 것을 다음에 담는다). */
  delivered?: boolean;
}

/** §5.13 (AA) 42-5 — 렌더를 걸 때 더 싣는 것. */
export interface RenderEnqueueExtra {
  readonly spec?: RenderSpec;
  readonly output?: RenderOutputSpec;
  readonly title?: string;
  readonly label?: string;
  readonly held?: boolean;
  readonly notBefore?: number;
}

/** §5.13 (AA) 42-5 — 예약 시계 한 번의 최대 대기(ms) — 길면 나눠 다시 건다(잠자기·시계 변경을 따라간다). */
const SCHEDULE_MAX_DELAY_MS = 6 * 60 * 60_000;

/** §5.13 (T-8) — 표지 모으기 한 벌의 끝(적었으면 그 판본). */
export interface CueOutcome {
  readonly assetId: string;
  readonly ok: boolean;
  readonly cues?: readonly { name: string; t: number }[];
  readonly issues?: readonly unknown[];
  readonly docVersion?: number;
  readonly error?: string;
}

interface PendingWait {
  resolve: (job: VideoJob) => void;
  timer: NodeJS.Timeout;
}

/** `GET /docs` 의 한 줄 — `duration` 은 해소한 타임라인 길이(초). */
export interface DocListEntry {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
  readonly version: number;
  readonly width: number;
  readonly height: number;
  readonly duration: number;
}

function laneOf(kind: VideoJobKind): VideoJobLane {
  return kind === 'render' || kind === 'cues' ? 'render' : 'still';
}

/** §5.13 (T-8) — 표지 모으기 한 벌의 열쇠(같은 코드 판이면 한 번만 돈다). */
function cueKey(projectPath: string, docId: string, assetId: string, contentHash: string): string {
  return [pathKey(projectPath, process.platform), docId, assetId, contentHash].join('\u0000');
}

/** 실패한 표지 모으기를 저절로 다시 걸지 않는 동안(ms) — 판본을 물을 때마다 같은 실패를 되풀이하지 않게. */
const CUE_RETRY_AFTER_MS = 5 * 60_000;

/** 스틸 결과(data URL)에서 PNG 바이트만 꺼낸다 — 다른 형식·깨진 글이면 null(썸네일 없이 간다). */
function pngBytesOf(result: string | undefined): Uint8Array | null {
  const match = typeof result === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(result) : null;
  if (!match?.[1]) return null;
  const bytes = Buffer.from(match[1], 'base64');
  const magic = [0x89, 0x50, 0x4e, 0x47];
  return bytes.length > magic.length && magic.every((b, i) => bytes[i] === b) ? bytes : null;
}

function isTerminal(status: VideoJobStatus): boolean {
  return status === 'done' || status === 'error' || status === 'canceled';
}

function videoDirFor(projectPath: string): string {
  return path.join(projectPath, '.vibisual', VIDEO_DIR);
}

function outDirFor(projectPath: string): string {
  return path.join(projectPath, '.vibisual', VIDEO_OUT_DIR);
}

interface RenderOutputRange {
  readonly start: number;
  /** null = 흘려 보내기(`bytes S-E/*` — 전체 크기는 끝맺음에서 안다, 42-11). */
  readonly total: number | null;
}

interface RenderOutputUpload {
  readonly file: string;
  readonly total: number | null;
  /** 순서대로 받은 바이트 수 · 흘려 보내기면 쓴 가장 먼 끝. */
  received: number;
}

export function renderOutputRange(header: string, length: number): RenderOutputRange | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(header);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === '*' ? null : Number(match[3]);
  if (![start, end].every(Number.isSafeInteger) || end - start + 1 !== length) return null;
  if (total !== null && (!Number.isSafeInteger(total) || end >= total)) return null;
  return { start, total };
}

function docPath(projectPath: string, docId: string): string {
  return path.join(videoDirFor(projectPath), `${docId}.json`);
}



/**
 * 호스트는 붙일 때 한 번만 주입된다. 앱이 코어를 직접 부르지 않는다는 규약이라
 * 이 변수 말고는 코어에 닿는 길이 없다(§5.13 (P)).
 */
let host: AppServerHost | null = null;
/** 마운트 때 한 번 — 호스트를 붙인다. */
export function attachHost(serverHost: AppServerHost): void {
  host = serverHost;
}
export function h(): AppServerHost {
  if (!host) throw new Error('video 앱이 아직 붙지 않았습니다.');
  return host;
}

/**
 * §5.13 (Y) 40-1 — `/media` 가 가리키는 파일 경로(규칙은 `/asset` 과 같다 · 못 찾으면 null = 404). 패키지 앱은 코어 vibproxy 미디어 갈래가 이 답으로
 * 흘려 보내고(구간 지원, IPC 를 타지 않는다), 웹·모바일은 `/media` 라우트가 같은 답을 쓴다.
 */
export async function resolveVideoMedia(serverHost: AppServerHost, query: URLSearchParams): Promise<string | null> {
  const p = serverHost.resolveProjectPath(query.get('project'));
  const rel = query.get('path');
  if (!p || !rel) return null;
  try {
    return await resolveVideoAssetAsync(p, rel);
  } catch {
    return null;
  }
}

/** 읽은 글 → 검증한 문서(틀리면 경고를 남기고 null). 동기 읽기와 판 기억(비동기 읽기)이 같은 판정을 쓴다. */
function parseDocText(text: string, docId: string): VideoDoc | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const result = validateDoc(parsed);
    if (!result.ok) {
      h().warn(`[video] 문서 ${docId} 가 검증을 통과하지 못했습니다: ${result.errors.join(' / ')}`);
      return null;
    }
    return result.doc;
  } catch (err) {
    h().warn(`[video] 문서 ${docId} 를 읽지 못했습니다: ${String(err)}`);
    return null;
  }
}

/** §5.13 (Y) 40-7 ② — 문서 판 기억(`versionBook.ts`). `/version` 은 이것으로만 답한다(비동기 stat 한 번). 알림은 호스트의 기존 방송(`notify`) — 새 통로를 만들지 않는다. */
export const versionBook = new VersionBook({
  fileOf: (projectPath, docId) => docPath(projectPath, docId),
  parse: (text, docId) => parseDocText(text, docId),
  notify: (event) => { host?.notify?.(event); },
});

/** §5.13 (Y) 40-7 ② — 지켜보는 문서의 컴포지션 코드가 바뀌었는지 이 간격(ms)마다 **비동기로** 잰다. */
export const VERSION_REFRESH_MS = 2_000;
/** 이만큼(ms) 안에 `/version` 으로 물은 문서만 지켜본다(창의 안전망 폴링 간격보다 넉넉하게). */
export const VERSION_WATCH_MS = 20_000;
let versionRefresher: ReturnType<typeof setInterval> | null = null;

export function ensureVersionRefresher(): void {
  if (versionRefresher) return;
  versionRefresher = setInterval(() => { void refreshWatchedCompositions(); }, VERSION_REFRESH_MS);
  versionRefresher.unref?.();
}

/** 시험 전용 — 지켜보기 시계를 멈춘다. */
export function __stopVersionRefresherForTest(): void {
  if (versionRefresher) clearInterval(versionRefresher);
  versionRefresher = null;
}

/** 바뀐 컴포지션이 있는가(이미 살핀 지문은 건너뛴다 — 다시 적을 것이 없던 변화로 2초마다 탐침하지 않게). */
async function compositionsMoved(entry: VersionEntry): Promise<boolean> {
  let moved = false;
  for (const asset of Object.values(entry.doc.assets)) {
    if (asset.kind !== 'composition' || asset.source.kind !== 'file') continue;
    const fingerprint = await compositionFingerprintAsync(entry.projectPath, asset.source.path);
    if (fingerprint === null || fingerprint === asset.contentHash || entry.examined.get(asset.id) === fingerprint) continue;
    entry.examined.set(asset.id, fingerprint);
    moved = true;
  }
  return moved;
}

/** 한 간격 — 바뀐 문서만 종전 길(탐침 → 쓰기 · 쓰면 알린다), 그대로면 낡은 표지 모으기만 다시 건다. */
export async function refreshWatchedCompositions(): Promise<void> {
  versionBook.prune();
  for (const entry of versionBook.watched(VERSION_WATCH_MS)) {
    if (entry.refreshing) continue;
    entry.refreshing = true;
    try {
      if (await compositionsMoved(entry)) {
        const read = videoService.readDoc(entry.projectPath, entry.docId);
        if (read) videoService.refreshCompositions(entry.projectPath, read);
      } else if (Object.values(entry.doc.assets).some(needsCues)) {
        videoService.scheduleCues(entry.projectPath, entry.doc);
      }
    } catch {
      // 다음 간격에 다시 본다.
    } finally {
      entry.refreshing = false;
    }
  }
}


export class VideoService {
  private readonly jobs = new Map<string, VideoJob>();
  private readonly outputUploads = new Map<VideoJob, RenderOutputUpload>();
  private readonly outputWrites = new Set<VideoJob>();
  /** §5.13 (V) 37-15 — 판 기록에 '렌더함' 을 이미 적은 렌더 일감. */
  private readonly renderRecorded = new Set<string>();
  private readonly pendingWaits = new Map<string, PendingWait>();
  private seq = 0;
  private workerUnavailableWarned = false;
  /** §5.13 (AA) 42-5 — 줄 순서 시계(되살린 일감 뒤로 선다). */
  private lastOrder = 0;
  /** §5.13 (AA) 42-6 — 대기열 파일을 되살린 프로젝트(경로 열쇠). */
  private readonly loadedQueues = new Set<string>();
  /** §5.13 (AA) 42-5 — 가장 이른 예약 시각에 거는 시계 하나. */
  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;
  /** §5.13 (AA) 42-7 — 지금 OS 절전을 막고 있는가(바뀔 때만 main 몫에 알린다). */
  private keepAwakeOn = false;

  // ─── 문서 ───

  /** 파일 stat(수정·변경 시각·크기·inode)이 같으면 지난 요약을 쓴다(mtime 이 거친 exFAT·HFS+ 의 같은 크기 다시쓰기는 ctime 이 잡는다) — 문서가 수백 개여도 목록이 파일을 다시 읽고 시간을 풀지 않는다. */
  private readonly docSummaries = new Map<string, { stamp: string; summary: DocListEntry }>();

  /** §5.13 (AA) 42-4 — 크기도 싣는다(여러 문서를 한 번에 내보낼 때 판형을 안다). 문서 갤러리가 길이(`duration`)도 쓴다. */
  listDocs(projectPath: string): DocListEntry[] {
    const dir = videoDirFor(projectPath);
    if (!fs.existsSync(dir)) return [];
    const out: DocListEntry[] = [];
    const seen = new Set<string>();
    const prefix = `${pathKey(dir, process.platform)}|`;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const docId = file.slice(0, -5);
      const cacheKey = prefix + docId;
      let stamp = '';
      try {
        const st = fs.statSync(path.join(dir, file));
        stamp = `${st.mtimeMs}:${st.ctimeMs}:${st.size}:${st.ino}`;
      } catch { continue; }
      seen.add(cacheKey);
      const cached = this.docSummaries.get(cacheKey);
      if (cached && cached.stamp === stamp) { out.push(cached.summary); continue; }
      const doc = this.readDoc(projectPath, docId);
      if (!doc) { this.docSummaries.delete(cacheKey); continue; }
      const summary: DocListEntry = {
        id: doc.id, title: doc.title, updatedAt: doc.updatedAt, version: doc.version, width: doc.size.width, height: doc.size.height,
        duration: resolveTimeline(doc).duration,
      };
      this.docSummaries.set(cacheKey, { stamp, summary });
      out.push(summary);
    }
    for (const key of [...this.docSummaries.keys()]) if (key.startsWith(prefix) && !seen.has(key)) this.docSummaries.delete(key);
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  readDoc(projectPath: string, docId: string): VideoDoc | null {
    if (!isSafeId(docId)) return null;
    const file = docPath(projectPath, docId);
    if (!fs.existsSync(file)) return null;
    try {
      return parseDocText(fs.readFileSync(file, 'utf8'), docId);
    } catch (err) {
      h().warn(`[video] 문서 ${docId} 를 읽지 못했습니다: ${String(err)}`);
      return null;
    }
  }

  /** §5.13 (R-10) — 편집 원본 참조의 공통 색인(거울). 연결이 있는 문서만, 잦은 저장은 합쳐서, 그대로면 쓰지 않는다. */
  readonly sourceSync = new VideoSourceSync();

  /** §3.2.1 원자적 쓰기 — 영상 문서는 사람의 창작물이라 반쯤 쓰이면 되돌릴 길이 없다. 이전 판은 `.bak` 한 벌로 남긴다. */
  writeDoc(projectPath: string, doc: VideoDoc): void {
    const file = docPath(projectPath, doc.id);
    if (fs.existsSync(file)) {
      try {
        fs.copyFileSync(file, `${file}.bak`);
      } catch {
        // 백업 실패가 저장을 막지는 않는다.
      }
    }
    h().atomicWriteFile(file, JSON.stringify(doc, null, 2));
    this.sourceSync.enqueue(h(), projectPath, doc);
    // §5.13 (Y) 40-7 ② — 판 기억을 새 판으로 바꾸고 그 문서를 지켜보는 창에 알린다(지켜보는 창이 없으면 아무 일도 없다).
    versionBook.noteWrite(projectPath, doc);
  }

  /** 이미 있으면 그것을 돌려준다 — §5.13 (R-3) 눌러서 연 영상 파일은 경로 파생 안정 id(`file-<해시>`)라 다시 눌러도 새 문서가 쌓이지 않게. */
  createDoc(projectPath: string, title: string, requestedId?: string): VideoDoc {
    if (requestedId !== undefined && isSafeId(requestedId)) {
      const existing = this.readDoc(projectPath, requestedId);
      if (existing) return existing;
      const reused = createEmptyDoc(requestedId, title);
      this.writeDoc(projectPath, reused);
      return reused;
    }
    const id = `vid-${Date.now().toString(36)}-${(this.seq++).toString(36)}`;
    const doc = createEmptyDoc(id, title);
    this.writeDoc(projectPath, doc);
    return doc;
  }

  deleteDoc(projectPath: string, docId: string): boolean {
    if (!isSafeId(docId)) return false;
    const file = docPath(projectPath, docId);
    if (!fs.existsSync(file)) return false;
    // 지우지 않고 옆으로 치운다 — 되돌릴 길을 남긴다(§5.11 "끄면 지우지 않는다"와 같은 정신).
    try {
      fs.renameSync(file, `${file}.deleted-${Date.now()}`);
      return true;
    } catch {
      return false;
    }
  }

  /** §5.13 (T-5) — 컴포지션 지문이 바뀌었으면 소재를 다시 탐침해 적는다 — 에이전트가 파일만 고쳐도 스튜디오·노드·일꾼이 새 코드를 본다. */
  refreshCompositions(projectPath: string, doc: VideoDoc): VideoDoc {
    const ops = compositionRefreshOps(projectPath, doc);
    if (ops.length === 0) {
      this.scheduleCues(projectPath, doc);
      return doc;
    }
    const result = applyPatch(doc, { baseVersion: doc.version, ops });
    if (!result.ok) return doc;
    this.writeDoc(projectPath, result.doc);
    // §5.13 (T-8) — 코드가 바뀌어 표지가 낡았으면 모으기를 건다(렌더 줄 — 스틸을 막지 않는다).
    this.scheduleCues(projectPath, result.doc);
    return result.doc;
  }

  // ─── §5.13 (T-8) 표지 모으기 ───

  private readonly cueRuns = new Map<string, { jobId: string; done: Promise<CueOutcome> }>();
  private readonly cueFailures = new Map<string, number>();

  /** 이 문서에서 표지가 낡은 컴포지션마다 모으기를 건다(이미 도는 것·방금 실패한 것은 건너뛴다). */
  scheduleCues(projectPath: string, doc: VideoDoc): void {
    for (const asset of Object.values(doc.assets)) {
      if (!needsCues(asset) || asset.contentHash === undefined) continue;
      const key = cueKey(projectPath, doc.id, asset.id, asset.contentHash);
      if (this.cueRuns.has(key)) continue;
      const failedAt = this.cueFailures.get(key);
      if (failedAt !== undefined && Date.now() - failedAt < CUE_RETRY_AFTER_MS) continue;
      this.ensureCues(projectPath, doc.id, asset);
    }
  }

  /**
   * 그 소재의 표지 모으기를 건다 — 같은 코드 판으로 이미 도는 것이 있으면 그것을 돌려준다. 끝나면 결과를 낙관적 잠금 경로로
   * 적는다(그 사이 코드가 또 바뀌었으면 적지 않는다 — 새 판의 모으기가 다시 걸린다).
   */
  ensureCues(projectPath: string, docId: string, asset: VideoAsset, force = false): { jobId: string; done: Promise<CueOutcome> } | null {
    if (asset.kind !== 'composition' || asset.contentHash === undefined) return null;
    const hash = asset.contentHash;
    const key = cueKey(projectPath, docId, asset.id, hash);
    const running = this.cueRuns.get(key);
    if (running) return running;
    if (force) this.cueFailures.delete(key);
    const job = this.newJob('cues', projectPath, docId, { assetId: asset.id });
    const done = this.waitFor(job, CUES_TIMEOUT_MS, '영상 일꾼이 표지 모으기를 돌려주지 않았습니다.').then((finished): CueOutcome => {
      this.cueRuns.delete(key);
      if (finished.status !== 'done' || typeof finished.result !== 'string') {
        this.cueFailures.set(key, Date.now());
        return { assetId: asset.id, ok: false, error: finished.error ?? 'the worker did not return cues' };
      }
      let raw: unknown[] = [];
      let errors: CueScanError[] = [];
      try {
        const parsed = JSON.parse(finished.result) as { cues?: unknown; errors?: unknown };
        raw = Array.isArray(parsed.cues) ? parsed.cues : [];
        errors = Array.isArray(parsed.errors)
          ? parsed.errors.filter((e): e is CueScanError => !!e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string')
          : [];
      } catch {
        this.cueFailures.set(key, Date.now());
        return { assetId: asset.id, ok: false, error: 'the worker returned unreadable cues' };
      }
      const settled = settleCues(raw, errors);
      const written = this.patchFresh(projectPath, docId, (current) => {
        const now = current.assets[asset.id];
        // 그 사이 코드가 또 바뀌었거나 소재가 빠졌으면 적지 않는다(새 판으로 다시 모은다).
        if (!now || now.kind !== 'composition' || now.contentHash !== hash) return [];
        const { cueIssues: _old, ...rest } = now;
        const next: VideoAsset = {
          ...rest,
          cues: settled.cues,
          cuesHash: hash,
          ...(settled.issues.length > 0 ? { cueIssues: settled.issues } : {}),
        };
        return [{ op: 'setAsset', asset: next }];
      });
      this.cueFailures.delete(key);
      return {
        assetId: asset.id,
        ok: written !== null,
        cues: settled.cues,
        issues: settled.issues,
        ...(written ? { docVersion: written.version } : { error: 'the document kept changing' }),
      };
    });
    const run = { jobId: job.id, done };
    this.cueRuns.set(key, run);
    return run;
  }

  /** 지금 표지 모으기를 기다리는 일감 id 들(이 문서 — 렌더가 그 뒤에 선다). 낡았는데 안 도는 것은 지금 건다(실패 기억은 무시). */
  cueJobsFor(projectPath: string, doc: VideoDoc): string[] {
    const ids: string[] = [];
    for (const asset of Object.values(doc.assets)) {
      if (!needsCues(asset)) continue;
      const run = this.ensureCues(projectPath, doc.id, asset, true);
      if (run) ids.push(run.jobId);
    }
    return ids;
  }

  /** 서버가 스스로 고치는 한 벌(읽고 → 연산 → 쓰기). 그 사이 바뀌면 한 번 다시 읽고 다시 해 본다. */
  patchFresh(projectPath: string, docId: string, build: (doc: VideoDoc) => readonly VideoDocOp[]): VideoDoc | null {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const doc = this.readDoc(projectPath, docId);
      if (!doc) return null;
      const ops = build(doc);
      if (ops.length === 0) return doc;
      const result = applyPatch(doc, { baseVersion: doc.version, ops });
      if (result.ok) {
        this.writeDoc(projectPath, result.doc);
        return result.doc;
      }
      if (result.reason !== 'version-conflict') return null;
    }
    return null;
  }

  // ─── 일감 ───

  /** §5.13 (AA) 42-5 — 다음 줄 순서(시각을 따라가되 되살린 일감보다 늘 뒤). */
  private nextOrder(): number {
    this.lastOrder = Math.max(this.lastOrder + 1, Date.now());
    return this.lastOrder;
  }

  private newJob(
    kind: VideoJobKind,
    projectPath: string,
    docId: string,
    extra: { t?: number; times?: number[]; maxEdge?: number; revId?: string; assetId?: string; after?: string[]; hideCaptions?: boolean; transparent?: boolean; frameOf?: string; imageType?: 'png' | 'webp'; images?: string[]; labels?: string[]; background?: boolean } & RenderEnqueueExtra = {},
  ): VideoJob {
    const job: VideoJob = {
      id: `job-${Date.now().toString(36)}-${(this.seq++).toString(36)}`,
      kind,
      projectPath,
      docId,
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      order: this.nextOrder(),
      ...(extra.background === true ? { background: true } : {}),
      ...(extra.t === undefined ? {} : { t: extra.t }),
      ...(extra.times === undefined ? {} : { times: extra.times }),
      ...(extra.maxEdge === undefined ? {} : { maxEdge: extra.maxEdge }),
      ...(extra.revId === undefined ? {} : { revId: extra.revId }),
      ...(extra.assetId === undefined ? {} : { assetId: extra.assetId }),
      ...(extra.after === undefined || extra.after.length === 0 ? {} : { after: extra.after, waitingFor: 'cues' as const }),
      ...(extra.hideCaptions === true ? { hideCaptions: true } : {}),
      ...(extra.transparent === true ? { transparent: true } : {}),
      ...(extra.frameOf === undefined ? {} : { frameOf: extra.frameOf }),
      ...(extra.imageType === undefined ? {} : { imageType: extra.imageType }),
      ...(extra.images === undefined ? {} : { images: extra.images }),
      ...(extra.labels === undefined ? {} : { labels: extra.labels }),
      ...(extra.spec === undefined ? {} : { spec: extra.spec }),
      ...(extra.output === undefined ? {} : { output: extra.output }),
      ...(extra.title === undefined ? {} : { title: extra.title }),
      ...(extra.label === undefined ? {} : { label: extra.label }),
      ...(extra.held === true ? { held: true, heldReason: 'user' as const } : {}),
      ...(extra.notBefore === undefined ? {} : { notBefore: extra.notBefore }),
    };
    this.jobs.set(job.id, job);
    this.sweep();
    // §5.13 (AA) 42-5 — 멈춘·예약한 일감으로는 숨은 창을 띄우지 않는다(안 쓰면 0 — (P-1)). 예약은 시계 하나가 맡는다.
    if (isDue(job, Date.now())) this.ensureWorker();
    else this.armSchedule();
    return job;
  }

  /**
   * §5.13 (T-4) — main 몫에게 숨은 일꾼 창을 깨워 달라고 한다. main 이 없으면 일감은 줄에 남고(시험의 가짜 일꾼 등이 집는다),
   * 깨우기가 실패하면 줄에 선 일감을 이유와 함께 닫는다(`queued` 로 조용히 썩지 않게).
   */
  private ensureWorker(): void {
    const current = host;
    if (!current) return;
    if (typeof current.invokeMain !== 'function') {
      if (!this.workerUnavailableWarned) {
        this.workerUnavailableWarned = true;
        current.info('[video] main 다리가 없는 실행 형태라 일꾼 창을 띄우지 않습니다 — 일감은 줄에서 기다립니다.');
      }
      return;
    }
    current.invokeMain('worker:ensure', {}).catch((err: unknown) => {
      current.warn(`[video] 일꾼 창을 띄우지 못했습니다: ${String(err)}`);
      this.failQueued(`영상 일꾼 창을 띄우지 못했습니다: ${String(err)}`);
    });
  }

  private failQueued(reason: string): void {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      // §5.13 (AA) 42-5 — 멈춘·예약한 일감은 일꾼을 기다리는 것이 아니다(그때 다시 깨운다).
      if (isDue(job, now)) this.updateJob(job.id, { status: 'error', error: reason });
    }
  }

  /**
   * `after` = 먼저 끝나야 할 일감(낡은 표지 모으기 — §5.13 (T-8)) · `hideCaptions` = 자막 따로 내기(37-15) · `transparent` = 투명 배경 WebM(38-3) ·
   * `extra` = §5.13 (AA) 42 그리는 방법·놓는 방법·멈춤·예약.
   */
  enqueueRender(projectPath: string, docId: string, after: string[] = [], hideCaptions = false, transparent = false, extra: RenderEnqueueExtra = {}): VideoJob {
    this.ensureQueueLoaded(projectPath);
    const job = this.newJob('render', projectPath, docId, { after, hideCaptions, transparent, ...extra });
    this.afterQueueChange(projectPath, job);
    return job;
  }

  // ─── §5.13 (AA) 42-5·42-6·42-7 렌더 대기열 ───

  /** 그 프로젝트의 대기열 파일을 한 번 되살린다(이 앱에 처음 닿을 때 — 부팅 때 앱을 불러오지 않는다, (P-1)). */
  ensureQueueLoaded(projectPath: string): void {
    const key = pathKey(projectPath, process.platform);
    if (this.loadedQueues.has(key) || !host) return;
    this.loadedQueues.add(key);
    const now = Date.now();
    let restored = 0;
    for (const raw of exportStore.readQueue(projectPath)) {
      const job = fromQueueRecord(raw, projectPath, now);
      if (!job || this.jobs.has(job.id)) continue;
      // 되살린 줄은 렌더 일감뿐이다(`fromQueueRecord` 가 kind 를 'render' 로 세운다).
      this.jobs.set(job.id, job as VideoJob);
      this.lastOrder = Math.max(this.lastOrder, job.order);
      if (job.status === 'done') this.renderRecorded.add(job.id);
      restored += 1;
    }
    if (restored > 0) this.armSchedule();
  }

  /** 대기열이 바뀌었다 — 적고 · 알리고 · 예약 시계를 다시 걸고 · 절전 막기를 맞추고 · 집을 것이 있으면 일꾼을 깨운다. */
  private afterQueueChange(projectPath: string, job?: VideoJob): void {
    for (const [uploadJob, upload] of this.outputUploads) {
      if (uploadJob.projectPath === projectPath && uploadJob.status !== 'running' && !this.outputWrites.has(uploadJob)) {
        void this.discardRenderUpload(uploadJob, upload);
      }
    }
    this.persistQueue(projectPath);
    this.notifyQueue(projectPath, job?.id ?? '*');
    this.armSchedule();
    this.syncKeepAwake();
    const now = Date.now();
    if ([...this.jobs.values()].some((j) => j.kind === 'render' && isDue(j, now))) this.ensureWorker();
  }

  /** 대기열 파일에 적는다(끝난 기록은 최근 `RENDER_HISTORY_MAX` 건 — 결과 파일은 지우지 않는다 (K)). */
  private persistQueue(projectPath: string): void {
    if (!host) return;
    this.ensureQueueLoaded(projectPath);
    for (const id of historyOverflow(this.jobs.values(), projectPath, RENDER_HISTORY_MAX)) {
      this.jobs.delete(id);
      this.renderRecorded.delete(id);
    }
    const records = [...this.jobs.values()]
      .filter((j) => j.kind === 'render' && j.projectPath === projectPath)
      .sort((a, b) => a.order - b.order)
      .map((j) => toQueueRecord(j));
    exportStore.writeQueue(projectPath, records);
  }

  private notifyQueue(projectPath: string, key: string): void {
    host?.notify?.({ project: projectPath, kind: 'render-queue', key });
  }

  /** 가장 이른 예약 시각에 시계 하나(길면 나눠서). */
  private armSchedule(): void {
    if (this.scheduleTimer) { clearTimeout(this.scheduleTimer); this.scheduleTimer = null; }
    const now = Date.now();
    const next = nextScheduledAt(this.jobs.values(), now);
    if (next === null) return;
    const delay = Math.min(Math.max(0, next - now) + 50, SCHEDULE_MAX_DELAY_MS);
    this.scheduleTimer = setTimeout(() => { this.scheduleTimer = null; this.onScheduleTick(); }, delay);
    this.scheduleTimer.unref?.();
  }

  /** 예약 시각이 된 일감을 줄에 세운다(표지가 낡았으면 먼저 모은다). */
  private onScheduleTick(): void {
    const now = Date.now();
    const projects = new Set<string>();
    for (const job of this.jobs.values()) {
      if (job.kind !== 'render' || job.notBefore === undefined || !isDue(job, now)) continue;
      delete job.notBefore;
      job.updatedAt = now;
      this.prepareDue(job);
      projects.add(job.projectPath);
    }
    for (const p of projects) this.afterQueueChange(p);
    this.armSchedule();
  }

  /**
   * 멈춰 있던·예약한 일감이 이제 돈다 — 그 사이 코드가 바뀌어 표지가 낡았으면 표지 모으기를 먼저 건다(렌더 경로와 같은 규칙 —
   * 낡은 시각으로 소리를 깔지 않는다).
   */
  private prepareDue(job: VideoJob): void {
    try {
      const read = this.readDoc(job.projectPath, job.docId);
      if (!read) return;
      const doc = this.refreshCompositions(job.projectPath, read);
      const after = this.cueJobsFor(job.projectPath, doc);
      if (after.length > 0) { job.after = after; job.waitingFor = 'cues'; }
    } catch {
      // 표지 준비 실패는 렌더를 막지 않는다 — 일꾼이 예전 표지로 그리고 그 사실을 알린다(`cuesFailed`).
    }
  }

  /** 렌더 중(멈춤 제외) 절전 막기가 켜진 일감이 있으면 OS 절전을 막는다(바뀔 때만 알린다). */
  private syncKeepAwake(): void {
    const on = [...this.jobs.values()].some((j) => j.kind === 'render' && j.status === 'running' && j.paused !== true && j.output?.keepAwake === true);
    if (on === this.keepAwakeOn) return;
    this.keepAwakeOn = on;
    void host?.invokeMain?.('power:keepAwake', { on })?.catch(() => undefined);
  }

  /** §5.13 (AA) 42-7 — 끝난 뒤(알림·폴더에서 보이기). 사람이 취소한 것은 알리지 않는다. */
  private afterDone(job: VideoJob): void {
    const out = job.output;
    const current = host;
    if (!out || !current?.invokeMain || job.status === 'canceled') return;
    const failed = job.status === 'error';
    if (failed ? !out.after.notify : !out.after.notify && !out.after.reveal) return;
    const file = job.exported ?? job.result ?? null;
    current.invokeMain('export:done', {
      path: failed ? null : file,
      reveal: !failed && out.after.reveal,
      notify: out.after.notify,
      title: (failed ? out.notice?.failed : out.notice?.done) ?? null,
      body: failed ? (job.error ?? '').slice(0, 300) : file ? path.basename(file) : '',
    }).catch(() => undefined);
  }

  /** 사람이 일감 하나에 거는 조작(일시정지·재개·취소·지금 시작·멈춤·순서·담았음). */
  controlJob(jobId: string, action: QueueAction): { status: number; job?: VideoJob; error?: string } {
    const job = this.jobs.get(jobId);
    if (!job || job.kind !== 'render') return { status: 404, error: 'unknown job' };
    const now = Date.now();
    const wasDue = isDue(job, now);
    let changed: boolean;
    if (action === 'move-up' || action === 'move-down') {
      changed = reorderJob(this.jobs.values(), job, action === 'move-up' ? 'up' : 'down');
    } else {
      const r = applyQueueAction(job, action, now);
      if (r.error) return { status: 409, job, error: r.error };
      changed = r.changed;
    }
    if (!changed) return { status: 200, job };
    job.updatedAt = now;
    if (!wasDue && isDue(job, now)) this.prepareDue(job);
    this.afterQueueChange(job.projectPath, job);
    return { status: 200, job };
  }

  /** 줄 전체(모두 시작 · 대기열 멈춤 · 모두 취소 · 끝난 것 지우기). 바뀐 수를 돌려준다. */
  controlQueue(projectPath: string, action: QueueBulkAction): number {
    this.ensureQueueLoaded(projectPath);
    const now = Date.now();
    let changed = 0;
    for (const job of [...this.jobs.values()]) {
      if (job.kind !== 'render' || job.projectPath !== projectPath) continue;
      if (action === 'clear-finished') {
        if (job.status === 'done' || job.status === 'error' || job.status === 'canceled') {
          this.jobs.delete(job.id);
          this.renderRecorded.delete(job.id);
          changed += 1;
        }
        continue;
      }
      if (action === 'cancel-all') {
        if (applyQueueAction(job, 'cancel', now).changed) changed += 1;
        continue;
      }
      if (action === 'hold-all') {
        if (job.status === 'queued' && applyQueueAction(job, 'hold', now).changed) changed += 1;
        continue;
      }
      // start-all — 멈춘 것·예약한 것을 지금 줄에 세우고, 멈춘 렌더는 다시 돌린다.
      const wasDue = isDue(job, now);
      const r = job.status === 'running' ? applyQueueAction(job, 'resume', now) : applyQueueAction(job, 'start-now', now);
      if (r.changed) {
        changed += 1;
        if (!wasDue && isDue(job, now)) this.prepareDue(job);
      }
    }
    if (changed > 0) this.afterQueueChange(projectPath);
    return changed;
  }

  /**
   * §5.13 (T-4) 임대 — 집어 간 일감이 `JOB_LEASE_MS` 안에 진행을 알리지 않으면(창 충돌·강제 종료) 오류로 닫는다.
   * `running` 으로 영원히 굳지 않게. 같은 일감을 조용히 다시 돌리지 않는다(렌더가 두 번 나가지 않게).
   */
  private reap(): void {
    const cutoff = Date.now() - JOB_LEASE_MS;
    for (const job of this.jobs.values()) {
      if (job.status === 'running' && job.updatedAt < cutoff && !this.outputWrites.has(job)) {
        this.updateJob(job.id, { status: 'error', error: '영상 일꾼이 응답하지 않아 이 일감을 닫았습니다.' });
      }
    }
  }

  /** 줄 순서(`order` — 들어온 순, 사람이 위·아래로 바꾼다). `lane` 을 주면 그 줄만. §5.13 (AA) 42-5 — 멈춘 것·예약 시각 전인 것은 집지 않는다. */
  claimNext(projectPath?: string, lane?: VideoJobLane): VideoJob | null {
    this.reap();
    const now = Date.now();
    const line = [...this.jobs.values()]
      .filter((job) => isDue(job, now)
        && (projectPath === undefined || job.projectPath === projectPath)
        && (lane === undefined || laneOf(job.kind) === lane))
      .sort((a, b) => Number(a.background === true) - Number(b.background === true) || a.order - b.order);
    for (const job of line) {
      // §5.13 (T-8) — 먼저 끝나야 하는 일감이 아직 돌면 건너뛴다. 끝났으면 기다림 표시를 걷는다(실패했으면 그 사실을 남긴다).
      if (job.after && job.after.length > 0) {
        const deps = job.after.map((id) => this.jobs.get(id)).filter((d): d is VideoJob => d !== undefined);
        if (deps.some((d) => !isTerminal(d.status))) continue;
        // 실패 사유 원문은 일꾼의 완료 보고가 note 를 덮으므로 따로 깃발로 남긴다(화면이 번역해 알린다).
        if (deps.some((d) => d.status !== 'done')) job.cuesFailed = true;
        delete job.waitingFor;
      }
      job.status = 'running';
      job.updatedAt = now;
      if (job.kind === 'render') {
        job.startedAt = now;
        job.pausedMs = 0;
        delete job.pausedAt;
        job.paused = false;
        this.afterQueueChange(job.projectPath, job);
      }
      return job;
    }
    return null;
  }

  getJob(jobId: string): VideoJob | undefined {
    this.reap();
    return this.jobs.get(jobId);
  }

  /** `kind` 를 주면 그 종류만(§5.13 (AA) 42-5 — 대기열은 렌더만 본다). */
  listJobs(projectPath?: string, kind?: VideoJobKind): VideoJob[] {
    this.reap();
    if (projectPath !== undefined) this.ensureQueueLoaded(projectPath);
    return [...this.jobs.values()].filter((j) => (projectPath === undefined || j.projectPath === projectPath) && (kind === undefined || j.kind === kind));
  }

  updateJob(jobId: string, patch: Partial<Pick<VideoJob, 'status' | 'progress' | 'result' | 'error' | 'note' | 'frame' | 'totalFrames' | 'exported' | 'exportNote' | 'companions' | 'companionNotes'>>): VideoJob | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    // A late progress response must not resurrect an already completed render.
    if (isTerminal(job.status) && (patch.status === 'running' || patch.status === 'queued')) return job;
    // §5.13 (AA) 42-5 — 끝난 일감의 끝은 바뀌지 않는다(사람이 취소한 렌더에 일꾼의 늦은 '중단됨' 오류가 덮이지 않게).
    if (isTerminal(job.status) && patch.status !== undefined && patch.status !== job.status) return job;
    const finishing = !isTerminal(job.status) && patch.status !== undefined && isTerminal(patch.status);
    Object.assign(job, patch);
    job.updatedAt = Date.now();
    if (job.kind === 'render') {
      if (finishing) {
        if (job.pausedAt !== undefined) job.pausedMs = (job.pausedMs ?? 0) + Math.max(0, job.updatedAt - job.pausedAt);
        delete job.pausedAt;
        job.paused = false;
        job.finishedAt = job.updatedAt;
        this.afterQueueChange(job.projectPath, job);
        this.afterDone(job);
      } else {
        // 진행률만 — 적지 않고 알리기만 한다(머리줄 단추의 채움).
        this.notifyQueue(job.projectPath, job.id);
      }
    }
    // §5.13 (V) 37-15 — 렌더가 끝나면 그 판본에 '이 판을 렌더함' 을 붙인다(한 번만).
    if (job.kind === 'render' && job.status === 'done' && typeof job.result === 'string' && !this.renderRecorded.has(job.id)) {
      this.renderRecorded.add(job.id);
      this.recordRender(job);
    }

    if (job.kind !== 'render' && isTerminal(job.status)) {
      delete job.images;
      const pending = this.pendingWaits.get(jobId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingWaits.delete(jobId);
        pending.resolve(job);
      }
    }
    return job;
  }

  /** §5.13 (V) 37-15 — 렌더 결과를 판 기록에 남긴다(지금 문서 판으로 — 결과 경로는 프로젝트 기준). 실패해도 렌더는 그대로다. */
  private recordRender(job: VideoJob): void {
    try {
      const doc = this.readDoc(job.projectPath, job.docId);
      if (!doc || typeof job.result !== 'string') return;
      const rel = toPosixPath(path.relative(job.projectPath, job.result));
      videoHistory.record(job.projectPath, doc, { kind: 'render', by: 'user', render: { file: rel, jobId: job.id } });
    } catch (err) {
      h().warn(`[video] 렌더 판 기록을 남기지 못했습니다: ${String(err)}`);
    }
  }

  /** 렌더 결과 바이트를 프로젝트 안에 쓴다. 경로를 돌려준다. §5.13 (W) 38-3 — 투명 배경이면 `.webm`. */
  saveRenderOutput(projectPath: string, docId: string, bytes: Buffer, ext: 'mp4' | 'webm' = 'mp4'): string {
    const dir = outDirFor(projectPath);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${docId}-${Date.now()}.${ext}`);
    fs.writeFileSync(file, bytes);
    return file;
  }

  /** 일감 하나를 걸어 두고 끝나기를 기다린다. 일꾼이 안 오면 시간이 지나 실패로 끝난다 — 영원히 매달리지 않는다. */
  private waitFor(job: VideoJob, timeoutMs: number, timeoutMessage: string): Promise<VideoJob> {
    return new Promise<VideoJob>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingWaits.delete(job.id);
        if (!isTerminal(job.status)) {
          job.status = 'error';
          job.error = timeoutMessage;
          job.updatedAt = Date.now();
        }
        delete job.images;
        resolve(job);
      }, timeoutMs);
      this.pendingWaits.set(job.id, { resolve, timer });
    });
  }

  /** 에이전트가 한 시각의 스틸을 물으면 그 자리에서 답이 와야 루프가 돈다 — 권한 승인 팝업처럼 일감을 걸어 두고 응답을 기다린다. */
  requestStill(projectPath: string, docId: string, t: number, opts: { maxEdge?: number; revId?: string } = {}): Promise<VideoJob> {
    const job = this.newJob('still', projectPath, docId, {
      t,
      ...(opts.maxEdge === undefined ? {} : { maxEdge: opts.maxEdge }),
      ...(opts.revId === undefined ? {} : { revId: opts.revId }),
    });
    return this.waitFor(job, STILL_TIMEOUT_MS, '영상 일꾼이 스틸을 돌려주지 않았습니다.');
  }

  /** §5.13 (W) 38-7 — 장면 정지 화면 한 장을 요청하고 기다린다(스틸 줄 — 스틸과 같은 일꾼·같은 결과 모양). */
  requestFrame(projectPath: string, docId: string, chapterId: string, t: number, maxEdge?: number, opts: { background?: boolean } = {}): Promise<VideoJob> {
    const job = this.newJob('still', projectPath, docId, { t, frameOf: chapterId, ...(maxEdge === undefined ? {} : { maxEdge }), ...(opts.background === true ? { background: true } : {}) });
    return this.waitFor(job, STILL_TIMEOUT_MS, '영상 일꾼이 정지 화면을 돌려주지 않았습니다.');
  }

  /** §5.13 (X) 39-4 — 스틸 줄(한 무대에서 차례로). `result` = 그림 데이터 주소의 JSON 배열(`times` 순). */
  requestStills(projectPath: string, docId: string, times: number[], maxEdge: number, imageType: 'png' | 'webp' = 'png', opts: { background?: boolean } = {}): Promise<VideoJob> {
    const job = this.newJob('stills', projectPath, docId, { times, maxEdge, imageType, ...(opts.background === true ? { background: true } : {}) });
    return this.waitFor(job, CHAPTER_THUMBS_TIMEOUT_MS, '영상 일꾼이 장면 그림을 돌려주지 않았습니다.');
  }

  /** §5.13 (T-9) — 프레임 띠 한 장을 요청하고 기다린다(스틸 줄 — 렌더 뒤에 줄 서지 않는다). */
  requestStrip(projectPath: string, docId: string, times: number[], maxEdge: number): Promise<VideoJob> {
    const job = this.newJob('strip', projectPath, docId, { times, maxEdge });
    return this.waitFor(job, STRIP_TIMEOUT_MS, '영상 일꾼이 프레임 띠를 돌려주지 않았습니다.');
  }

  /** §5.13 (T-8) — 이 문서의 낡은 표지를 지금 모은다(기다린다). `assetId` 를 주면 그 소재만 — 낡지 않았어도 다시 모은다. */
  async collectCuesNow(projectPath: string, doc: VideoDoc, assetId?: string, all = false): Promise<CueOutcome[]> {
    const targets = Object.values(doc.assets).filter((a) =>
      a.kind === 'composition' && a.usesCues === true && (assetId !== undefined ? a.id === assetId : all || needsCues(a)));
    const runs: Promise<CueOutcome>[] = [];
    for (const asset of targets) {
      const run = this.ensureCues(projectPath, doc.id, asset, true);
      if (run) runs.push(run.done);
    }
    return Promise.all(runs);
  }

  /**
   * §5.13 (V) 37-9 — 프레임 검수 표본(그 시각들의 평평함·글자 상자·아래 밝기)을 요청하고 기다린다(스틸 줄). §5.13 (G) — `revId` 면 그 판으로,
   * `timeoutMs` 는 표본 한 장짜리(배치 요약)가 스틸 상한을 쓰게.
   */
  requestReview(projectPath: string, docId: string, times: number[], opts: { revId?: string; timeoutMs?: number } = {}): Promise<VideoJob> {
    const job = this.newJob('review', projectPath, docId, { times, ...(opts.revId === undefined ? {} : { revId: opts.revId }) });
    return this.waitFor(job, opts.timeoutMs ?? REVIEW_TIMEOUT_MS, '영상 일꾼이 프레임 검수를 돌려주지 않았습니다.');
  }

  /** §5.13 (G) — 이미 찍은 두 장(전·후)을 일꾼이 나란히 한 장으로 붙인다(스틸 줄 — 스틸과 같은 결과 모양). */
  requestCompare(projectPath: string, docId: string, images: readonly [string, string], labels: readonly [string, string]): Promise<VideoJob> {
    const job = this.newJob('compare', projectPath, docId, { images: [...images], labels: [...labels] });
    return this.waitFor(job, COMPARE_TIMEOUT_MS, '영상 일꾼이 전후 비교 그림을 돌려주지 않았습니다.');
  }

  private sweep(): void {
    const cutoff = Date.now() - JOB_RETENTION_MS;
    for (const [id, job] of this.jobs) {
      // §5.13 (AA) 42-6 — 렌더는 대기열의 기록이다(사람이 지우거나 `RENDER_HISTORY_MAX` 를 넘을 때까지 남는다).
      if (job.kind === 'render') continue;
      if (isTerminal(job.status) && job.updatedAt < cutoff) this.jobs.delete(id);
    }
  }

  private async discardRenderUpload(job: VideoJob, upload: RenderOutputUpload): Promise<void> {
    this.outputUploads.delete(job);
    await fs.promises.rm(upload.file, { force: true }).catch((error: unknown) => {
      host?.warn(`[video] Could not remove unfinished render output: ${String(error)}`);
    });
  }

  /** §5.13 (E-5) ③ — 올리던 결과를 버린다(일꾼이 한 인코더 렌더로 처음부터 다시 굽기 전). 쓰는 중이면 거절한다. */
  async resetRenderOutput(job: VideoJob): Promise<{ status: number; job: VideoJob | null; error?: string }> {
    if (this.outputWrites.has(job)) return { status: 409, job, error: 'output upload already in progress' };
    const upload = this.outputUploads.get(job);
    if (upload) await this.discardRenderUpload(job, upload);
    return { status: 200, job };
  }

  /** §5.13 (AA) 42-11 — Publish only when every byte has arrived in order. */
  async receiveRenderOutput(job: VideoJob, bytes: Buffer, range?: RenderOutputRange): Promise<{ status: number; job: VideoJob | null; error?: string }> {
    let upload = this.outputUploads.get(job);
    if (this.outputWrites.has(job) || (range === undefined && upload !== undefined)) {
      return { status: 409, job, error: 'output upload already in progress' };
    }
    // 순서대로 이어 쓰기는 빈틈 없이 · 흘려 보내기는 쓴 끝을 넘어 건너뛰지 않는다(머리 상자를 되돌아가 고쳐 쓰는 것은 받는다).
    if (range && ((upload && range.total !== upload.total) || range.start > (upload?.received ?? 0)
      || (range.total !== null && range.start !== (upload?.received ?? 0)))) {
      return { status: 409, job, error: 'unexpected output byte range' };
    }
    this.outputWrites.add(job);
    let keepUpload = false;
    try {
      if (!range) return await this.completeRenderOutput(job, bytes);
      if (range.total === null) {
        if (!upload) {
          const dir = outDirFor(job.projectPath);
          await fs.promises.mkdir(dir, { recursive: true });
          upload = { file: path.join(dir, `.render-${randomUUID()}.part`), total: null, received: 0 };
          this.outputUploads.set(job, upload);
        }
        const handle = await fs.promises.open(upload.file, upload.received === 0 ? 'wx' : 'r+');
        try {
          await handle.write(bytes, 0, bytes.length, range.start);
        } finally {
          await handle.close();
        }
        upload.received = Math.max(upload.received, range.start + bytes.length);
        if (job.status !== 'running') return { status: 409, job, error: 'output job is not running' };
        job.updatedAt = Date.now();
        keepUpload = true;
        return { status: 200, job };
      }
      if (!upload) {
        const dir = outDirFor(job.projectPath);
        await fs.promises.mkdir(dir, { recursive: true });
        const file = path.join(dir, `.render-${randomUUID()}.part`);
        await writeNewFile(file, bytes);
        upload = { file, total: range.total, received: 0 };
        this.outputUploads.set(job, upload);
      } else {
        await fs.promises.appendFile(upload.file, bytes);
      }
      upload.received += bytes.length;
      if (job.status !== 'running') return { status: 409, job, error: 'output job is not running' };
      job.updatedAt = Date.now();
      if (upload.received === upload.total) return await this.completeRenderOutput(job, upload.file);
      keepUpload = true;
      return { status: 200, job };
    } finally {
      if (upload && !keepUpload) await this.discardRenderUpload(job, upload);
      this.outputWrites.delete(job);
    }
  }

  /** §5.13 (AA) 42-11 — 흘려 보낸 결과의 끝맺음: 쓴 끝·파일 크기가 전체 크기와 맞을 때만 결과 파일로 둔다. */
  async commitRenderOutput(job: VideoJob, total: number): Promise<{ status: number; job: VideoJob | null; error?: string }> {
    const upload = this.outputUploads.get(job);
    if (this.outputWrites.has(job)) return { status: 409, job, error: 'output upload already in progress' };
    if (!upload || upload.total !== null) return { status: 409, job, error: 'no streamed output to commit' };
    this.outputWrites.add(job);
    try {
      const size = (await fs.promises.stat(upload.file)).size;
      if (upload.received !== total || size !== total) {
        return { status: 409, job, error: `output size mismatch (expected ${total}, received ${size})` };
      }
      if (job.status !== 'running') return { status: 409, job, error: 'output job is not running' };
      return await this.completeRenderOutput(job, upload.file);
    } finally {
      await this.discardRenderUpload(job, upload);
      this.outputWrites.delete(job);
    }
  }

  /**
   * §5.13 (AA) 42-13 — 썸네일 한 장을 종전 스틸 길로 찍는다(스틸 줄 — 렌더 줄의 끝맺음과 따로 돈다). 못 찍으면 null —
   * 렌더는 그대로 성공이고 까닭은 놓을 때 일감에 남는다.
   */
  private async captureThumbnail(job: VideoJob, doc: VideoDoc | null): Promise<Uint8Array | null> {
    if (job.output?.extras.thumbnail !== true || !doc) return null;
    try {
      const t = thumbnailTime(job.output.thumbnailAt, resolveTimeline(doc).duration, job.spec?.range ?? null);
      const still = await this.requestStill(job.projectPath, job.docId, t, { maxEdge: 0 });
      return still.status === 'done' ? pngBytesOf(still.result) : null;
    } catch (err) {
      host?.warn(`[video] 썸네일을 찍지 못했습니다: ${String(err)}`);
      return null;
    }
  }

  /** §5.13 (AA) 42-2 — Place the result before marking the job done and notifying the user. */
  private async completeRenderOutput(job: VideoJob, source: Buffer | string): Promise<{ status: number; job: VideoJob | null; error?: string }> {
    const doc = this.readDoc(job.projectPath, job.docId);
    const thumbnail = await this.captureThumbnail(job, doc);
    // 스틸을 기다리는 동안 취소됐으면 아무것도 놓지 않는다(취소한 렌더는 딸림 파일도 만들지 않는다 — 42-13).
    if (job.status !== 'running') return { status: 409, job, error: 'output job is not running' };
    const placed = await placeRenderOutput({
      outDir: outDirFor(job.projectPath),
      docId: job.docId,
      title: job.title ?? null,
      spec: job.spec ?? null,
      output: job.output ?? null,
      legacyExt: job.transparent === true ? 'webm' : 'mp4',
      ...(typeof source === 'string' ? { sourceFile: source } : { bytes: source }),
      doc,
      now: new Date(),
      thumbnail,
    }, process.platform);
    if (job.status !== 'running') return { status: 409, job, error: 'output job is not running' };
    const updated = this.updateJob(job.id, {
      status: 'done',
      progress: 1,
      result: placed.result,
      exported: placed.exported,
      ...(placed.exportNote ? { exportNote: placed.exportNote } : {}),
      ...(placed.companions ? { companions: placed.companions } : {}),
      ...(placed.companionNotes ? { companionNotes: placed.companionNotes } : {}),
    });
    return { status: 200, job: updated };
  }
}

export const videoService = new VideoService();
/** §5.13 (AA) 42-1·42-6 — 내보내기 설정·렌더 대기열 파일. */
export const exportStore = new ExportStore(() => h());

/** §5.13 (V) 37-3 — 판 기록(파일)과 지금 하는 일(메모리). 호스트는 붙일 때 들어온다. */
export const videoHistory = new VideoHistoryStore(() => h());
// §5.13 (Y) 40-7 ② — 지금 하는 일이 바뀌면 그 문서를 지켜보는 창에 알린다.
export const videoActivity = new ActivityBook((projectPath, docId) => versionBook.noteActivity(projectPath, docId));
/** §5.13 (V) 37-7 — 메모 핀(파일). */
export const videoNotes = new VideoNotesStore(() => h());
