/**
 * §5.13 Vibistudio — 서버 서비스.
 *
 * 코어(`index.ts`)는 `mountVideoRoutes(app)` 한 줄만 안다(플러그인 호스트 선례).
 *
 * **서버는 그리지 않는다.** 그리기는 캔버스와 WebCodecs 가 있는 렌더러 몫이고, 여기서는
 * 문서를 보관하고 편집을 중재하고 작업을 줄 세운다. §3.7 단일 프로세스 원칙상 렌더용
 * 자식 프로세스를 띄우지 않으므로, 스틸·프레임 띠·렌더 요청은 **일감(job)** 으로 쌓아 두고
 * 숨은 일꾼 창(§5.13 (T-4) — main 몫이 띄운다)이 가져가 처리한 뒤 결과를 돌려준다.
 *
 * 편집 중재의 핵심은 낙관적 잠금이다 — 여러 에이전트가 같은 문서를 동시에 만지는 것이
 * 이 앱의 기본 상황이라, 마지막에 쓴 쪽이 조용히 이기면 작업이 소리 없이 사라진다.
 *
 * §5.13 (T) — 코드 컴포지션: 내주기(샌드박스 iframe 이 여는 정적 콘텐츠 — CSP + 런타임 심 주입)·탐침·뼈대 만들기·
 * 규약 글. 에이전트가 코드로 모션을 짓고 문서에 올리는 길이 전부 여기 있다.
 */
import fs from 'node:fs';
import path from 'node:path';
import express, { type Express, type Request } from 'express';
import { isPathWithin, pathKey } from '@vibisual/shared';
import { importProjectAsset, resolveVideoAsset, saveVideoAsset, VIDEO_UPLOAD_LIMIT } from './assets.js';
import {
  assetWithProbe,
  compositionAssetId,
  compositionRefreshOps,
  compositionRoots,
  engineChromium,
  needsCues,
  probeComposition,
  resolveInsideProject,
  vibisualRel,
} from './composition.js';

import {
  CAPTION_IMPORT_MAX_BYTES,
  MOTION_CRAFT_GUIDE,
  captionFormatOf,
  captionImportOps,
  chapterFrameDoc,
  chapterFrameTime,
  compositionGuideFor,
  parseCaptionText,
  CUES_TIMEOUT_MS,
  JOB_LEASE_MS,
  REVIEW_MAX_SAMPLES,
  REVIEW_TIMEOUT_MS,
  reviewMotion,
  reviewSampleTimes,
  type FrameProbe,
  STILL_MAX_EDGE,
  STILL_TIMEOUT_MS,
  STRIP_DEFAULT_FRAMES,
  STRIP_MAX_EDGE,
  STRIP_MAX_FRAMES,
  STRIP_TIMEOUT_MS,
  VIBISTUDIO_AGENT_GUIDE,
  VIDEO_COMPOSITIONS_DIR,
  VIDEO_DIR,
  VIDEO_OUT_DIR,
  VIDEO_REVIEW_DIR,
  applyPatch,
  buildCutOps,
  buildTranscript,
  deriveFormatDoc,
  derivedDocId,
  compositionCsp,
  compositionMimeType,
  compositionRuntimeScript,
  compositionSeed,
  compositionSkeleton,
  createEmptyDoc,
  injectCompositionRuntime,
  isCompositionWebFile,
  isProjectRelativePath,
  resolveTimeline,
  safeCompositionName,
  sentenceCutRanges,
  settleCues,
  toPosixPath,
  validateDoc,
  type CueScanError,
  type CompositionRuntimeStyle,
  type VideoAsset,
  type VideoDoc,
  type VideoDocOp,
  type VideoDocPatch,
  type VideoFormatId,
} from '../index.js';

import type { AppServerHost } from '../host.js';
import { isSafeHistoryId } from '../history.js';
import { rejectAgent, requestAuthor } from './guards.js';
import { VideoHistoryStore } from './historyStore.js';
import { ActivityBook, mountHistoryRoutes } from './historyRoutes.js';
import { VideoNotesStore, mountNotesRoutes } from './notesRoutes.js';
import { mountStyleRoutes, readStyleFile } from './styleRoutes.js';
import { mountPartsRoutes } from './partsRoutes.js';
import { mountLibsRoutes, readLibsFile } from './libsRoutes.js';
import { libInjection } from '../libs.js';
import { parseCompositionMeta } from '../composition/meta.js';

/** §5.13 (V) 37-2 — 시작 화면 재료(소재 아닌 파일)의 형식과 크기 상한. */
const MATERIAL_EXTENSIONS: readonly string[] = ['.csv', '.tsv', '.json', '.txt', '.md', '.svg'];
const MATERIAL_UPLOAD_LIMIT = 16 * 1024 * 1024;

/** 끝난 일감을 얼마나 들고 있을지(ms). 결과를 가져갈 시간은 주되 무한정 쌓지 않는다. */
const JOB_RETENTION_MS = 10 * 60_000;

/** §5.13 (T-3) — 문서 없이 기본 자리(`compositions/`)·라이브러리 자리만 내주는 주소의 문서 칸. */
const NO_DOC = '_';

/**
 * §5.13 (V) 37-9 — `review` = 프레임 검수 표본(일꾼이 찍고 재서 JSON 으로 돌려준다 — 판정은 서버의 순수 함수).
 * §5.13 (T-8) — `cues` = 표지 모으기(컴포지션 하나를 끝까지 한 번 흘려 받은 표지·오류를 JSON 으로 — 길이에 비례해 렌더 줄).
 */
export type VideoJobKind = 'render' | 'still' | 'strip' | 'review' | 'cues';
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
}

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

function laneOf(kind: VideoJobKind): VideoJobLane {
  return kind === 'render' || kind === 'cues' ? 'render' : 'still';
}

/** §5.13 (T-8) — 표지 모으기 한 벌의 열쇠(같은 코드 판이면 한 번만 돈다). */
function cueKey(projectPath: string, docId: string, assetId: string, contentHash: string): string {
  return [pathKey(projectPath, process.platform), docId, assetId, contentHash].join('\u0000');
}

/** 실패한 표지 모으기를 저절로 다시 걸지 않는 동안(ms) — 판본을 물을 때마다 같은 실패를 되풀이하지 않게. */
const CUE_RETRY_AFTER_MS = 5 * 60_000;

function isTerminal(status: VideoJobStatus): boolean {
  return status === 'done' || status === 'error' || status === 'canceled';
}

function videoDirFor(projectPath: string): string {
  return path.join(projectPath, '.vibisual', VIDEO_DIR);
}

function outDirFor(projectPath: string): string {
  return path.join(projectPath, '.vibisual', VIDEO_OUT_DIR);
}

function docPath(projectPath: string, docId: string): string {
  return path.join(videoDirFor(projectPath), `${docId}.json`);
}

/** 파일명으로 쓸 수 없는 글자를 막는다 — docId 가 경로를 벗어나지 못하게. */
function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** 초 → 파일 이름에 쓰는 시각(`1.50`). */
function secondsTag(t: number): string {
  return (Number.isFinite(t) ? Math.max(0, t) : 0).toFixed(2);
}

/**
 * 호스트는 붙일 때 한 번만 주입된다. 앱이 코어를 직접 부르지 않는다는 규약이라
 * 이 변수 말고는 코어에 닿는 길이 없다(§5.13 (P)).
 */
let host: AppServerHost | null = null;
function h(): AppServerHost {
  if (!host) throw new Error('video 앱이 아직 붙지 않았습니다.');
  return host;
}

class VideoService {
  private readonly jobs = new Map<string, VideoJob>();
  /** §5.13 (V) 37-15 — 판 기록에 '렌더함' 을 이미 적은 렌더 일감. */
  private readonly renderRecorded = new Set<string>();
  private readonly pendingWaits = new Map<string, PendingWait>();
  private seq = 0;
  private workerUnavailableWarned = false;

  // ─── 문서 ───

  listDocs(projectPath: string): Array<{ id: string; title: string; updatedAt: number; version: number }> {
    const dir = videoDirFor(projectPath);
    if (!fs.existsSync(dir)) return [];
    const out: Array<{ id: string; title: string; updatedAt: number; version: number }> = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const doc = this.readDoc(projectPath, file.slice(0, -5));
      if (doc) out.push({ id: doc.id, title: doc.title, updatedAt: doc.updatedAt, version: doc.version });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  readDoc(projectPath: string, docId: string): VideoDoc | null {
    if (!isSafeId(docId)) return null;
    const file = docPath(projectPath, docId);
    if (!fs.existsSync(file)) return null;
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
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

  /**
   * 문서를 저장한다.
   *
   * §3.2.1 원자적 쓰기를 처음부터 쓴다 — 영상 문서는 사람의 창작물이라 반파되면
   * 되돌릴 방법이 없다. 이전 판은 `.bak` 한 벌로 남겨 둔다.
   */
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
  }

  /**
   * 문서를 만든다.
   *
   * `requestedId` 가 오면 **그 id 로** 만들고, 이미 있으면 만들지 않고 그것을 그대로 돌려준다.
   * §5.13 (R-3) — 눌러서 연 영상 파일은 경로에서 파생한 안정 id(`file-<해시>`)를 갖는다. 같은
   * 파일을 다시 누를 때마다 새 문서가 생기면 프로젝트가 문서 무덤이 되므로 그 자리를 여기서 막는다.
   */
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

  /**
   * §5.13 (T-5) — 컴포지션 코드가 바뀌었으면(지문) 소재를 다시 탐침해 문서에 적는다. 바뀐 게 없으면 그대로.
   * 에이전트가 파일만 고치고 탐침을 다시 부르지 않아도, 문서를 읽는 쪽(스튜디오·노드·일꾼)이 새 코드를 본다.
   */
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

  private newJob(
    kind: VideoJobKind,
    projectPath: string,
    docId: string,
    extra: { t?: number; times?: number[]; maxEdge?: number; revId?: string; assetId?: string; after?: string[]; hideCaptions?: boolean; transparent?: boolean; frameOf?: string } = {},
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
      ...(extra.t === undefined ? {} : { t: extra.t }),
      ...(extra.times === undefined ? {} : { times: extra.times }),
      ...(extra.maxEdge === undefined ? {} : { maxEdge: extra.maxEdge }),
      ...(extra.revId === undefined ? {} : { revId: extra.revId }),
      ...(extra.assetId === undefined ? {} : { assetId: extra.assetId }),
      ...(extra.after === undefined || extra.after.length === 0 ? {} : { after: extra.after, waitingFor: 'cues' as const }),
      ...(extra.hideCaptions === true ? { hideCaptions: true } : {}),
      ...(extra.transparent === true ? { transparent: true } : {}),
      ...(extra.frameOf === undefined ? {} : { frameOf: extra.frameOf }),
    };
    this.jobs.set(job.id, job);
    this.sweep();
    this.ensureWorker();
    return job;
  }

  /**
   * §5.13 (T-4) — 일감이 들어오면 같은 앱의 main 몫에게 숨은 일꾼 창을 깨워 달라고 한다(이미 떠 있으면 아무 일 없음).
   * main 이 없는 실행 형태면 일감은 줄에 그대로 남는다 — 다른 일꾼(시험의 가짜 일꾼 등)이 집어 갈 수 있다.
   * 깨우기가 실패하면 줄에 선 일감을 이유와 함께 닫는다 — `queued` 로 조용히 썩지 않게.
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
    for (const job of this.jobs.values()) {
      if (job.status === 'queued') this.updateJob(job.id, { status: 'error', error: reason });
    }
  }

  /**
   * `after` — 먼저 끝나야 하는 일감(낡은 표지 모으기 — §5.13 (T-8)). `hideCaptions` — 자막 따로 내기(§5.13 (V) 37-15).
   * `transparent` — 투명 배경 WebM(§5.13 (W) 38-3).
   */
  enqueueRender(projectPath: string, docId: string, after: string[] = [], hideCaptions = false, transparent = false): VideoJob {
    return this.newJob('render', projectPath, docId, { after, hideCaptions, transparent });
  }

  /**
   * §5.13 (T-4) 임대 — 집어 간 일감이 `JOB_LEASE_MS` 안에 진행을 알리지 않으면(창 충돌·강제 종료) 오류로 닫는다.
   * `running` 으로 영원히 굳지 않게. 같은 일감을 조용히 다시 돌리지 않는다(렌더가 두 번 나가지 않게).
   */
  private reap(): void {
    const cutoff = Date.now() - JOB_LEASE_MS;
    for (const job of this.jobs.values()) {
      if (job.status === 'running' && job.updatedAt < cutoff) {
        this.updateJob(job.id, { status: 'error', error: '영상 일꾼이 응답하지 않아 이 일감을 닫았습니다.' });
      }
    }
  }

  /** 일꾼이 가져갈 다음 일감. 먼저 들어온 것부터. `lane` 을 주면 그 줄만. */
  claimNext(projectPath?: string, lane?: VideoJobLane): VideoJob | null {
    this.reap();
    for (const job of this.jobs.values()) {
      if (job.status !== 'queued') continue;
      if (projectPath !== undefined && job.projectPath !== projectPath) continue;
      if (lane !== undefined && laneOf(job.kind) !== lane) continue;
      // §5.13 (T-8) — 먼저 끝나야 하는 일감이 아직 돌면 건너뛴다. 끝났으면 기다림 표시를 걷는다(실패했으면 그 사실을 남긴다).
      if (job.after && job.after.length > 0) {
        const deps = job.after.map((id) => this.jobs.get(id)).filter((d): d is VideoJob => d !== undefined);
        if (deps.some((d) => !isTerminal(d.status))) continue;
        // 실패 사유 원문은 일꾼의 완료 보고가 note 를 덮으므로 따로 깃발로 남긴다(화면이 번역해 알린다).
        if (deps.some((d) => d.status !== 'done')) job.cuesFailed = true;
        delete job.waitingFor;
      }
      job.status = 'running';
      job.updatedAt = Date.now();
      return job;
    }
    return null;
  }

  getJob(jobId: string): VideoJob | undefined {
    this.reap();
    return this.jobs.get(jobId);
  }

  listJobs(projectPath?: string): VideoJob[] {
    this.reap();
    const all = [...this.jobs.values()];
    return projectPath === undefined ? all : all.filter((j) => j.projectPath === projectPath);
  }

  updateJob(jobId: string, patch: Partial<Pick<VideoJob, 'status' | 'progress' | 'result' | 'error' | 'note'>>): VideoJob | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    // A late progress response must not resurrect an already completed render.
    if (isTerminal(job.status) && (patch.status === 'running' || patch.status === 'queued')) return job;
    Object.assign(job, patch);
    job.updatedAt = Date.now();
    // §5.13 (V) 37-15 — 렌더가 끝나면 그 판본에 '이 판을 렌더함' 을 붙인다(한 번만).
    if (job.kind === 'render' && job.status === 'done' && typeof job.result === 'string' && !this.renderRecorded.has(job.id)) {
      this.renderRecorded.add(job.id);
      this.recordRender(job);
    }

    if (job.kind !== 'render' && isTerminal(job.status)) {
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
        resolve(job);
      }, timeoutMs);
      this.pendingWaits.set(job.id, { resolve, timer });
    });
  }

  /**
   * 스틸 한 장을 요청하고 기다린다.
   *
   * 에이전트가 "2.4초 지점 보여 줘"라고 물으면 그 자리에서 답이 와야 루프가 성립하므로,
   * 권한 승인 팝업과 같은 방식으로 일감을 걸어 두고 응답을 기다린다. 일꾼 창은 일감이 들어올 때 깨어난다.
   */
  requestStill(projectPath: string, docId: string, t: number, opts: { maxEdge?: number; revId?: string } = {}): Promise<VideoJob> {
    const job = this.newJob('still', projectPath, docId, {
      t,
      ...(opts.maxEdge === undefined ? {} : { maxEdge: opts.maxEdge }),
      ...(opts.revId === undefined ? {} : { revId: opts.revId }),
    });
    return this.waitFor(job, STILL_TIMEOUT_MS, '영상 일꾼이 스틸을 돌려주지 않았습니다.');
  }

  /** §5.13 (W) 38-7 — 장면 정지 화면 한 장을 요청하고 기다린다(스틸 줄 — 스틸과 같은 일꾼·같은 결과 모양). */
  requestFrame(projectPath: string, docId: string, chapterId: string, t: number, maxEdge?: number): Promise<VideoJob> {
    const job = this.newJob('still', projectPath, docId, { t, frameOf: chapterId, ...(maxEdge === undefined ? {} : { maxEdge }) });
    return this.waitFor(job, STILL_TIMEOUT_MS, '영상 일꾼이 정지 화면을 돌려주지 않았습니다.');
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

  /** §5.13 (V) 37-9 — 프레임 검수 표본(그 시각들의 평평함·글자 상자·아래 밝기)을 요청하고 기다린다(스틸 줄). */
  requestReview(projectPath: string, docId: string, times: number[]): Promise<VideoJob> {
    const job = this.newJob('review', projectPath, docId, { times });
    return this.waitFor(job, REVIEW_TIMEOUT_MS, '영상 일꾼이 프레임 검수를 돌려주지 않았습니다.');
  }

  private sweep(): void {
    const cutoff = Date.now() - JOB_RETENTION_MS;
    for (const [id, job] of this.jobs) {
      if (isTerminal(job.status) && job.updatedAt < cutoff) this.jobs.delete(id);
    }
  }
}

export const videoService = new VideoService();

/** §5.13 (V) 37-3 — 판 기록(파일)과 지금 하는 일(메모리). 호스트는 붙일 때 들어온다. */
export const videoHistory = new VideoHistoryStore(() => h());
export const videoActivity = new ActivityBook();
/** §5.13 (V) 37-7 — 메모 핀(파일). */
export const videoNotes = new VideoNotesStore(() => h());

/** §5.13 (V) 37-12 — 비트 칸 상한(긴 음악도 이 안 — 180 BPM 으로 20분). */
const BEATS_MAX = 4000;

/** 화면이 보낸 비트 사실을 허용 칸·모양으로만 거른다. 틀리면 null. */
function sanitizeBeatFacts(raw: unknown): Pick<VideoAsset, 'beats' | 'beatsStrong' | 'bpm' | 'beatsHash'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const times = (v: unknown): number[] | null => {
    if (!Array.isArray(v)) return null;
    const out = v.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0).slice(0, BEATS_MAX);
    return out.sort((a, b) => a - b).map((n) => Math.round(n * 1000) / 1000);
  };
  const beats = times(r['beats']);
  const strong = times(r['beatsStrong']);
  const bpmRaw = r['bpm'];
  const hashRaw = r['beatsHash'];
  const bpm = typeof bpmRaw === 'number' && Number.isFinite(bpmRaw) ? Math.max(0, Math.min(400, bpmRaw)) : null;
  const hash = typeof hashRaw === 'string' && hashRaw.length > 0 && hashRaw.length <= 80 ? hashRaw : null;
  if (!beats || !strong || bpm === null || !hash) return null;
  return { beats, beatsStrong: strong, bpm, beatsHash: hash };
}

/** 프로젝트 해소는 호스트가 한다 — 앱은 프로젝트가 무엇인지 모른다. */
function resolveProjectPath(raw: unknown): string | null {
  return h().resolveProjectPath(raw);
}

/**
 * §5.13 (G)(T-9) — 스틸·프레임 띠 PNG 를 프로젝트 안에 쓴다. 에이전트가 자기 Read 도구로 그 파일을 열어 **눈으로** 본다
 * (응답에 수백 KB 짜리 data URL 을 실으면 에이전트의 문맥만 태운다). 같은 이름이면 덮어쓴다 — 지우는 코드 없이도 끝없이
 * 쌓이지 않는다((K) 자동 삭제 ❌).
 */
function saveReviewImage(projectPath: string, docId: string, name: string, dataUrl: string | undefined): string | null {
  if (typeof dataUrl !== 'string') return null;
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:image/png;base64,') || comma < 0) return null;
  try {
    const dir = path.join(projectPath, '.vibisual', VIDEO_REVIEW_DIR, docId);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, Buffer.from(dataUrl.slice(comma + 1), 'base64'));
    return file;
  } catch (err) {
    h().warn(`[video] 검수 그림을 쓰지 못했습니다: ${String(err)}`);
    return null;
  }
}

/** 숫자 쿼리 값. 없거나 숫자가 아니면 기본값. */
function numQuery(raw: unknown, fallback: number): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

/**
 * §5.13 (T-3) ③ — CSP 출처 목록: 그 문서의 컴포지션 콘텐츠 앞머리(경로까지). 패키지 앱은 `vibproxy://proxy` 로,
 * 다른 접속(웹·모바일 모드)은 요청이 들어온 호스트로 연다 — 두 갈래를 다 적는다.
 */
function contentSources(req: Request, projectRaw: string, docId: string): string[] {
  const prefix = `${req.baseUrl}/content/${encodeURIComponent(projectRaw)}/${encodeURIComponent(docId)}/`;
  const sources = [`vibproxy://proxy${prefix}`];
  const hostHeader = req.get('host');
  if (hostHeader) sources.push(`${req.protocol}://${hostHeader}${prefix}`);
  return sources;
}

/** §5.13 (V) 37-5 — 미리보기의 props 덮어쓰기(base64url JSON, 상한 안 · 평범한 객체만). 아니면 null. */
const PROPS_OVERRIDE_MAX_CHARS = 24_000;
function decodePropsOverride(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw === '' || raw.length > PROPS_OVERRIDE_MAX_CHARS) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** §5.13 (V) 37-10 — 심에 넘길 스타일(글꼴·로고는 내주기 주소로 바꾼다 — 라이브러리 뿌리 안이라 CSP 가 연다). */
function runtimeStyle(style: NonNullable<VideoDoc['style']>, prefix: string): CompositionRuntimeStyle {
  const url = (rel: string | undefined): string | undefined =>
    rel && isProjectRelativePath(rel) ? prefix + toPosixPath(rel).split('/').filter((s) => s !== '').map(encodeURIComponent).join('/') : undefined;
  const fontUrl = url(style.fontFile);
  const logoUrl = url(style.logo);
  return {
    accent: style.accent,
    bg: style.bg,
    fg: style.fg,
    muted: style.muted,
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    ...(fontUrl ? { fontUrl } : {}),
    ...(logoUrl ? { logoUrl } : {}),
  };
}

/** §5.13 (V) 37-3 — 그 판이 남긴 파일 내용(덩어리) 경로. 그 판에 없는 파일이면 null(지금 디스크의 것을 쓴다). */
function revisionBlob(projectPath: string, docId: string, revId: string, rel: string): string | null {
  const manifest = videoHistory.readManifest(projectPath, docId, revId);
  const sha = manifest?.files[rel];
  if (!sha) return null;
  const blob = videoHistory.blobPath(projectPath, docId, sha);
  return blob && fs.existsSync(blob) ? blob : null;
}

const CONTENT_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  // 불투명 출처 프레임이 고전 스크립트·그림을 읽는 데는 필요 없지만, 글꼴·모듈처럼 CORS 를 타는 요청이 막히지 않게.
  'Access-Control-Allow-Origin': '*',
};

/**
 * 이 앱의 서버 몫을 붙인다.
 *
 * **처음 요청이 올 때만 불린다** — 안 쓰면 이 파일 자체가 로드되지 않는다
 * (`appHost` 가 늦게 import 한다). 그래서 안 쓰는 사용자는 이 코드의 비용을 0으로 낸다.
 */
export function mountVideoRoutes(app: Express, serverHost: AppServerHost): void {
  host = serverHost;
  /** 공통 — 프로젝트를 못 찾으면 404. */
  const project = (raw: unknown): string | null => resolveProjectPath(raw);

  // ─── §5.13 (G)(T-2) 규약 글 — 에이전트가 세션마다 한 번 읽는다 ───

  app.get('/guide', (_req, res) => {
    res.type('text/markdown; charset=utf-8').send(VIBISTUDIO_AGENT_GUIDE);
  });

  // §5.13 (W) 38-9 — 규약 글 끝에 렌더 엔진 줄(이 실행본의 Chromium)을 붙여 내준다.
  app.get('/composition/guide', (_req, res) => {
    res.type('text/markdown; charset=utf-8').send(compositionGuideFor(engineChromium()));
  });

  // §5.13 (W) 38-8 — 연출 규약("어떻게 잘 만드나"). 컴포지션을 쓰기 전에 읽는다.
  app.get('/craft', (_req, res) => {
    res.type('text/markdown; charset=utf-8').send(MOTION_CRAFT_GUIDE);
  });

  // ─── §5.13 (V) 37-3 판 기록·바퀴 보고 ───
  mountHistoryRoutes(app, {
    project,
    readDoc: (p, docId) => videoService.readDoc(p, docId),
    writeDoc: (p, doc) => videoService.writeDoc(p, doc),
    requestStill: (p, docId, t, opts) => videoService.requestStill(p, docId, t, opts),
    history: videoHistory,
    activity: videoActivity,
    // §5.13 (V) 37-7 — 바퀴 보고가 고쳤다고 적은 메모를 '고침'으로.
    onNotesFixed: (p, docId, noteIds, passId) => { videoNotes.markFixed(p, docId, noteIds, passId); },
  });

  // ─── §5.13 (V) 37-7 메모 핀 ───
  mountNotesRoutes(app, {
    project,
    docExists: (p, docId) => videoService.readDoc(p, docId) !== null,
    notes: videoNotes,
  });

  // ─── §5.13 (V) 37-10 스타일 카드 ───
  mountStyleRoutes(app, { project, host: () => h() });

  // ─── §5.13 (T-6)(T-10)(V) 37-11 가져오기 ───
  mountLibsRoutes(app, { project, host: () => h() });

  // ─── §5.13 (V) 37-11 부품 서랍 ───
  mountPartsRoutes(app, {
    project,
    readDoc: (p, docId) => videoService.readDoc(p, docId),
    writeDoc: (p, doc) => videoService.writeDoc(p, doc),
    patchFresh: (p, docId, build) => videoService.patchFresh(p, docId, build),
    requestStill: (p, docId, t, opts) => videoService.requestStill(p, docId, t, opts),
    atomicWriteFile: (file, data) => h().atomicWriteFile(file, data),
    warn: (message) => h().warn(message),
  });

  // ─── 문서 ───

  app.get('/docs', (req, res) => {
    const p = project(req.query['project']);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    res.json({ ok: true, docs: videoService.listDocs(p) });
  });

  app.post('/docs', (req, res) => {
    const body = req.body as { project?: unknown; title?: unknown; id?: unknown };
    const p = project(body.project);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    const title = typeof body.title === 'string' && body.title.trim() !== '' ? body.title.trim() : '새 영상';
    // (R-3) — 파일에서 파생한 안정 id 로 열 때만 온다. 없으면 종전처럼 서버가 새 id 를 붙인다.
    const requestedId = typeof body.id === 'string' && body.id.trim() !== '' ? body.id.trim() : undefined;
    let doc = videoService.createDoc(p, title, requestedId);
    // §5.13 (V) 37-10 — 새 문서는 확정된 스타일 카드를 받아 태어난다(이미 손댄 문서는 그대로).
    const confirmed = readStyleFile(p)?.style;
    if (confirmed && !doc.style && doc.version === 1) {
      doc = videoService.patchFresh(p, doc.id, (current) => (current.style || current.version !== 1 ? [] : [{ op: 'setDoc', patch: { style: confirmed } }])) ?? doc;
    }
    res.json({ ok: true, doc });
  });

  app.get('/doc/:docId', (req, res) => {
    const p = project(req.query['project']);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    const read = videoService.readDoc(p, req.params.docId);
    if (!read) {
      res.status(404).json({ ok: false, error: 'unknown doc' });
      return;
    }
    // 에이전트가 편집 전에 읽는 그 응답이다 — 지금 상태와 시간 해소 결과를 함께 준다.
    // 컴포지션 코드가 바뀌었으면 소재를 먼저 새로 적는다(그래야 읽은 version 이 곧 쓸 baseVersion 이다).
    const doc = videoService.refreshCompositions(p, read);
    const timeline = resolveTimeline(doc);
    res.json({
      ok: true,
      doc,
      duration: timeline.duration,
      diagnostics: timeline.diagnostics,
    });
  });

  /**
   * §5.13 (T-7) — 문서의 판본만. 스튜디오·노드 화면이 몇 초마다 물어 **에이전트가 고친 것을 저절로 다시 읽는다**.
   * 컴포지션 코드가 바뀐 것도 여기서 알아챈다(지문이 바뀌면 소재를 다시 적어 판본이 오른다).
   */
  app.get('/doc/:docId/version', (req, res) => {
    const p = project(req.query['project']);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    const read = videoService.readDoc(p, req.params.docId);
    if (!read) {
      res.status(404).json({ ok: false, error: 'unknown doc' });
      return;
    }
    const doc = videoService.refreshCompositions(p, read);
    res.json({
      ok: true,
      id: doc.id,
      title: doc.title,
      version: doc.version,
      updatedAt: doc.updatedAt,
      duration: resolveTimeline(doc).duration,
      // §5.13 (V) 37-3 — 지금 하는 일(바퀴·만지는 장면). AI 패널 머리와 구슬 위성이 이것을 보인다.
      activity: videoActivity.get(p, doc.id),
    });
  });

  app.post('/doc/:docId/patch', (req, res) => {
    const body = req.body as { project?: unknown; passId?: unknown; focus?: unknown } & Partial<VideoDocPatch>;
    const p = project(body.project);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    const doc = videoService.readDoc(p, req.params.docId);
    if (!doc) {
      res.status(404).json({ ok: false, error: 'unknown doc' });
      return;
    }
    if (typeof body.baseVersion !== 'number' || !Array.isArray(body.ops)) {
      res.status(400).json({ ok: false, error: 'baseVersion 과 ops 가 필요합니다.' });
      return;
    }

    const result = applyPatch(doc, { baseVersion: body.baseVersion, ops: body.ops });
    if (!result.ok) {
      // 409 = "그 사이 바뀌었으니 다시 읽고 오세요". 에이전트가 이 신호로 재시도한다.
      const status = result.reason === 'version-conflict' ? 409 : 400;
      // `result` 에도 ok:false 가 있으므로 펼친 뒤에 다시 못 박는다(순서가 바뀌면 조용히 덮인다).
      res.status(status).json({ ...result, ok: false });
      return;
    }

    // 새로 얹은 composition 소재가 아직 탐침되지 않았으면 여기서 채운다(길이·판형·lint) — 에이전트가 탐침을 잊어도
    // `duration:'auto'` 가 풀린다.
    const written = videoService.refreshCompositions(p, result.doc);
    if (written === result.doc) videoService.writeDoc(p, result.doc);
    // §5.13 (V) 37-3 — 바퀴의 이름으로 들어온 판본을 적는다. 처음 보는 바퀴면 고치기 직전 상태를 그 바퀴의 시작 판으로 남긴다
    //   (스튜디오를 거치지 않고 맡긴 바퀴도 [이 바퀴 되돌리기]가 된다).
    if (isSafeHistoryId(body.passId)) {
      const passId = body.passId;
      const focus = typeof body.focus === 'string' && body.focus.trim() !== '' ? body.focus.trim().slice(0, 80) : undefined;
      try {
        let startRev = videoHistory.findPass(p, doc.id, passId)?.startRev;
        if (!startRev) startRev = videoHistory.record(p, doc, { kind: 'pass-start', by: 'user', passId }).id;
        videoHistory.notePatch(p, doc.id, passId, written.version, focus, doc.version, startRev);
        videoActivity.touch(p, doc.id, passId, focus, 'open');
      } catch (err) {
        h().warn(`[video] 바퀴 기록을 남기지 못했습니다: ${String(err)}`);
      }
    }
    const timeline = resolveTimeline(written);
    res.json({ ok: true, doc: written, duration: timeline.duration, diagnostics: timeline.diagnostics, by: requestAuthor(req) });
  });

  app.delete('/doc/:docId', (req, res) => {
    if (rejectAgent(req, res, 'Only the user deletes a document.')) return;
    const p = project(req.query['project']);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    res.json({ ok: videoService.deleteDoc(p, req.params.docId) });
  });

  /**
   * 소재 파일을 내준다.
   *
   * 경로는 **프로젝트 루트 안으로만** 허용한다 — 상대 경로에 `..` 를 섞어 프로젝트
   * 밖 파일을 읽어 가는 길을 막는다(§3.5 프로젝트 독립성이 여기서도 그대로 적용).
   */
  app.put('/assets', express.raw({ type: 'application/octet-stream', limit: VIDEO_UPLOAD_LIMIT }), (req, res) => {
    const p = project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    try {
      if (!Buffer.isBuffer(req.body)) throw new Error('Expected media bytes.');
      res.json({ ok: true, asset: saveVideoAsset(p, req.query['name'], req.body) });
    } catch (error) { res.status(400).json({ ok: false, error: String(error) }); }
  });

  /**
   * §5.13 (V) 37-2 — 시작 화면에 끌어 놓은 **소재 아닌 재료**(CSV·표·JSON·글·SVG 로고)를 프로젝트 안에 둔다. 에이전트는 그 경로를
   * 읽는다(데이터 설명·로고 등장 레시피). 미디어는 종전 `PUT /assets`. 사람이 놓은 것만 받는다(루프백 유입 거절).
   */
  app.put('/materials', express.raw({ type: 'application/octet-stream', limit: MATERIAL_UPLOAD_LIMIT }), (req, res) => {
    if (rejectAgent(req, res, 'Read project files directly; materials are dropped by the user.')) return;
    const p = project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const name = typeof req.query['name'] === 'string' ? req.query['name'] : '';
    const ext = path.extname(name).toLowerCase();
    if (!MATERIAL_EXTENSIONS.includes(ext) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ ok: false, error: 'unsupported material' });
      return;
    }
    try {
      const dir = path.join(p, '.vibisual', VIDEO_DIR, 'materials');
      fs.mkdirSync(dir, { recursive: true });
      const safe = safeCompositionName(path.basename(name, ext)) || 'material';
      const file = `${Date.now().toString(36)}-${safe}${ext}`;
      fs.writeFileSync(path.join(dir, file), req.body, { flag: 'wx' });
      res.json({ ok: true, path: `.vibisual/${VIDEO_DIR}/materials/${file}` });
    } catch (error) { res.status(500).json({ ok: false, error: String(error) }); }
  });

  /**
   * §5.13 (G) — 프로젝트 안의 파일(사용자가 첨부한 그림·영상·소리 등)을 영상 소재 자리로 **복사**한다.
   * 에이전트가 바이트를 실어 나르지 않고 경로만 준다. 첨부 폴더는 보존 정책으로 정리될 수 있어 원본을 가리키지 않는다.
   */
  app.post('/assets/import', (req, res) => {
    const body = req.body as { project?: unknown; path?: unknown };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    if (typeof body.path !== 'string' || body.path.trim() === '') {
      res.status(400).json({ ok: false, error: 'path required' });
      return;
    }
    try {
      res.json({ ok: true, asset: importProjectAsset(p, body.path) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/asset', (req, res) => {
    const p = project(req.query['project']);
    const rel = req.query['path'];
    if (!p || typeof rel !== 'string' || rel === '') {
      res.status(404).json({ ok: false, error: 'unknown project or path' });
      return;
    }
    let target: string;
    try { target = resolveVideoAsset(p, rel); } catch {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    res.sendFile(target, { dotfiles: 'allow' });
  });

  // ─── §5.13 (T) 코드 컴포지션 ───

  /**
   * §5.13 (T-5) — 기본 자리에 컴포지션 폴더와 뼈대 `index.html`(meta 셋 + `@keyframes` 예시 + `__vibi.seek` 예시)을 만든다.
   * `docId` 를 주면 그 문서에 소재까지 올린다(탐침 결과와 함께). 에이전트가 파일을 직접 써도 된다 — 자리와 meta 를
   * 틀리지 않게 하는 지름길일 뿐이다.
   */
  app.post('/composition', (req, res) => {
    const body = req.body as {
      project?: unknown; name?: unknown; title?: unknown; docId?: unknown;
      duration?: unknown; width?: unknown; height?: unknown;
    };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = typeof body.docId === 'string' && body.docId !== '' ? body.docId : null;
    const doc = docId ? videoService.readDoc(p, docId) : null;
    if (docId && !doc) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }

    const rawName = typeof body.name === 'string' && body.name.trim() !== '' ? body.name : 'comp';
    const base = safeCompositionName(rawName);
    const parent = path.join(p, '.vibisual', ...VIDEO_COMPOSITIONS_DIR.split('/'));
    let folder = base;
    for (let i = 2; fs.existsSync(path.join(parent, folder)) && i < 1000; i += 1) folder = `${base}-${i}`;
    const dirAbs = path.join(parent, folder);
    try {
      fs.mkdirSync(dirAbs, { recursive: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: `could not create the composition folder: ${String(err)}` });
      return;
    }
    const rel = `${vibisualRel(VIDEO_COMPOSITIONS_DIR)}/${folder}/index.html`;
    if (!resolveInsideProject(p, path.dirname(rel))) {
      res.status(400).json({ ok: false, error: 'the composition folder resolved outside the project' });
      return;
    }
    const width = typeof body.width === 'number' && body.width > 0 ? body.width : doc?.size.width ?? 1920;
    const height = typeof body.height === 'number' && body.height > 0 ? body.height : doc?.size.height ?? 1080;
    const title = typeof body.title === 'string' && body.title.trim() !== '' ? body.title.trim() : rawName;
    h().atomicWriteFile(path.join(dirAbs, 'index.html'), compositionSkeleton({
      title,
      width,
      height,
      ...(typeof body.duration === 'number' ? { duration: body.duration } : {}),
    }));

    if (!doc || !docId) {
      res.json({ ok: true, path: rel });
      return;
    }
    const probed = probeComposition(p, rel);
    if (!probed.ok) { res.status(500).json({ ok: false, error: probed.error, path: rel }); return; }
    let assetId = '';
    const updated = videoService.patchFresh(p, docId, (current) => {
      assetId = compositionAssetId(current, rel);
      const asset: VideoAsset = assetWithProbe({ id: assetId, kind: 'composition', source: { kind: 'file', path: rel } }, probed.probe);
      return [{ op: 'setAsset', asset }];
    });
    if (!updated) { res.status(409).json({ ok: false, error: 'the document changed — read it again', path: rel }); return; }
    res.json({ ok: true, path: rel, assetId, docVersion: updated.version });
  });

  /**
   * §5.13 (T-5) — 탐침. 길이·판형(meta)·시각 맞춤 방식·결정성 검사(lint)·지문을 돌려준다. `docId` 를 주면 그 문서의
   * 같은 경로 소재(없으면 새 소재)를 낙관적 잠금 경로로 채운다. 창을 띄우지 않는다(문자열만 읽는다).
   */
  app.post('/composition/probe', (req, res) => {
    const body = req.body as { project?: unknown; path?: unknown; docId?: unknown; assetId?: unknown };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    if (typeof body.path !== 'string' || body.path.trim() === '') {
      res.status(400).json({ ok: false, error: 'path required' });
      return;
    }
    const probed = probeComposition(p, body.path);
    if (!probed.ok) { res.status(400).json({ ok: false, error: probed.error }); return; }
    const probe = probed.probe;
    const docId = typeof body.docId === 'string' && body.docId !== '' ? body.docId : null;
    if (!docId) { res.json({ ok: true, ...probe }); return; }

    const requestedAssetId = typeof body.assetId === 'string' && body.assetId !== '' ? body.assetId : null;
    let assetId = '';
    const updated = videoService.patchFresh(p, docId, (doc) => {
      const samePath = Object.values(doc.assets).find((a) =>
        a.kind === 'composition' && a.source.kind === 'file' &&
        pathKey(toPosixPath(a.source.path), process.platform) === pathKey(probe.path, process.platform));
      const existing = (requestedAssetId ? doc.assets[requestedAssetId] : undefined) ?? samePath;
      const base: VideoAsset = existing ?? { id: compositionAssetId(doc, probe.path), kind: 'composition', source: { kind: 'file', path: probe.path } };
      assetId = base.id;
      return [{ op: 'setAsset', asset: assetWithProbe(base, probe) }];
    });
    if (!updated) { res.status(404).json({ ok: false, error: 'unknown doc or it kept changing' }); return; }
    // §5.13 (T-8) — 소스가 표지를 부르면 모으기 일감을 함께 건다(렌더 줄). 그 id 를 돌려준다.
    const written = updated.assets[assetId];
    const cueRun = written && needsCues(written) ? videoService.ensureCues(p, docId, written) : null;
    res.json({ ok: true, ...probe, assetId, docVersion: updated.version, ...(cueRun ? { cuesJobId: cueRun.jobId } : {}) });
  });

  /**
   * §5.13 (T-3) — 컴포지션 콘텐츠를 내준다(샌드박스 iframe 이 여는 정적 파일만 — API 는 내지 않는다).
   *
   * 주소: `…/content/<프로젝트>/<문서 id 또는 _>/<프로젝트 기준 경로>?item=<아이템 id>&v=<판>`
   * ① 뿌리 — 그 문서의 컴포지션 폴더들 + 기본 자리 + 라이브러리 자리만(그 밖은 404)
   * ② 형식 — 알려진 웹 형식만(`nosniff`)
   * ③ CSP — 응답 헤더와 문서 맨 앞 meta 두 겹, 그리고 HTML 이면 런타임 심과 그 아이템의 props·seed 를 맨 앞에 넣는다.
   * 패키지 앱에서는 `vibproxy://proxy` 로 들어온다(코어의 vibproxy 허용 목록은 앱 이름 없이 이 모양만 안다).
   */
  app.get('/content/:project/:docId/*', (req, res) => {
    const notFound = (): void => {
      res.status(404).set('X-Content-Type-Options', 'nosniff').type('text/plain').send('not found');
    };
    const projectRaw = req.params.project;
    const p = project(projectRaw);
    // §5.13 (V) 37-3 — `<docId>@<revId>` 면 그 판의 문서와 **그 판의 코드**로 내준다(판 둘을 나란히 볼 때·판 정지 화면).
    //   판이 문서 칸(경로)에 있어야 컴포지션 안의 상대 주소(`app.js`)도 같은 판으로 풀린다.
    const docSegment = req.params.docId;
    const at = docSegment.indexOf('@');
    const docId = at < 0 ? docSegment : docSegment.slice(0, at);
    const revId = at < 0 ? null : docSegment.slice(at + 1);
    // 런타임은 express 4 라 `*` 가 params['0'] 로 온다. @types/express 5 는 이 모양을 몰라 unknown 을 거친다.
    const rel = toPosixPath(String((req.params as unknown as Record<string, string | undefined>)['0'] ?? ''));
    if (!p || !isProjectRelativePath(rel) || !isCompositionWebFile(rel)) { notFound(); return; }
    let doc: VideoDoc | null = null;
    if (docId !== NO_DOC) {
      doc = revId ? videoHistory.readSnapshot(p, docId, revId) : videoService.readDoc(p, docId);
      if (!doc) { notFound(); return; }
    }
    const revBlob = revId ? revisionBlob(p, docId, revId, rel) : null;
    const abs = resolveInsideProject(p, rel) ?? (revBlob ? path.resolve(p, rel) : null);
    if (!abs) { notFound(); return; }
    const roots = compositionRoots(p, doc);
    if (!roots.some((root) => abs !== root && isPathWithin(abs, root, process.platform))) { notFound(); return; }
    let isFile = revBlob !== null;
    if (!isFile) {
      try { isFile = fs.statSync(abs).isFile(); } catch { isFile = false; }
    }
    if (!isFile) { notFound(); return; }
    const mime = compositionMimeType(rel);
    if (!mime) { notFound(); return; }

    res.set(CONTENT_HEADERS);
    if (!mime.startsWith('text/html')) {
      res.type(mime);
      res.sendFile(revBlob ?? abs, { dotfiles: 'allow' });
      return;
    }

    // CSP 출처는 주소에 적힌 그대로의 문서 칸이다(판이면 `<docId>@<revId>` — 그 판의 상대 주소만 열린다).
    const csp = compositionCsp(contentSources(req, projectRaw, docSegment));
    const itemId = typeof req.query['item'] === 'string' ? req.query['item'] : '';
    const item = doc?.tracks.flatMap((track) => track.items).find((candidate) => candidate.id === itemId);
    // §5.13 (W) 38-7 — 문서에 없는 아이템(장면 정지 화면의 `__chapter-frame` 등)은 이 파일을 가리키는 컴포지션 소재로 크기·길이를 잡는다.
    const relKey = toPosixPath(rel);
    const asset = item?.assetId !== undefined
      ? doc?.assets[item.assetId]
      : Object.values(doc?.assets ?? {}).find((a) => a.kind === 'composition' && a.source.kind === 'file' && toPosixPath(a.source.path) === relKey);
    // §5.13 (V) 37-5 — 미리보기가 묶인 곳 없는 컴포지션을 새 값으로 다시 열 때만 오는 props(저장보다 앞선 낙관 값).
    const override = decodePropsOverride(req.query['props']);
    // §5.13 (V) 37-15 — 반응형 컴포지션은 선언 크기 대신 상자 크기를 받는다(무대가 `bw`·`bh` 로 준다).
    const responsive = asset?.responsive === true;
    const bw = numQuery(req.query['bw'], 0);
    const bh = numQuery(req.query['bh'], 0);
    const contentPrefix = `${req.baseUrl}/content/${encodeURIComponent(projectRaw)}/${encodeURIComponent(docSegment)}/`;
    const runtime = compositionRuntimeScript({
      props: override ?? item?.props ?? {},
      seed: compositionSeed(doc?.seed, itemId),
      itemId,
      fps: doc?.fps ?? 30,
      duration: asset?.duration ?? null,
      width: responsive && bw > 0 ? Math.round(bw) : asset?.width ?? doc?.size.width ?? 1920,
      height: responsive && bh > 0 ? Math.round(bh) : asset?.height ?? doc?.size.height ?? 1080,
      // §5.13 (V) 37-10 — 문서 스타일(모든 컴포지션에 같은 팔레트). 글꼴·로고는 같은 내주기 앞머리 아래 주소로.
      ...(doc?.style ? { style: runtimeStyle(doc.style, contentPrefix) } : {}),
    });
    let html: string;
    try { html = fs.readFileSync(revBlob ?? abs, 'utf8'); } catch { notFound(); return; }
    // §5.13 (T-6) — 들여놓은 라이브러리(`vibi:libs` 에 적은 이름)와 글꼴(늘 `@font-face`)을 심 뒤·컴포지션 스크립트 앞에 넣는다.
    const libs = readLibsFile(p).items;
    const extra = libs.length > 0
      ? libInjection(libs, parseCompositionMeta(html).libs ?? [], (rel) => contentPrefix + toPosixPath(rel).split('/').filter((s) => s !== '').map(encodeURIComponent).join('/'))
      : '';
    res.set('Content-Security-Policy', csp);
    res.type(mime).send(injectCompositionRuntime(html, csp, runtime, extra));
  });

  // ─── 스틸 · 프레임 띠 · 렌더 ───

  /**
   * 스틸 한 장 — 최종 렌더와 같은 경로(숨은 일꾼 창)로 찍는다. 응답은 **파일 경로**(`.vibisual/video/review/…`)이고,
   * `format=dataurl` 이면 그림도 싣는다(노드 화면처럼 바로 그릴 자리). `full=1` 이면 문서 원본 크기.
   */
  app.get('/doc/:docId/still', (req, res) => {
    const p = project(req.query['project']);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    const docId = req.params.docId;
    const read = videoService.readDoc(p, docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    videoService.refreshCompositions(p, read);
    const t = numQuery(req.query['t'], 0);
    const wantData = req.query['format'] === 'dataurl';
    const full = req.query['full'] === '1';
    videoService
      .requestStill(p, docId, Math.max(0, t), { maxEdge: full ? 0 : STILL_MAX_EDGE })
      .then((job) => {
        if (job.status !== 'done') {
          res.status(504).json({ ok: false, error: job.error ?? '스틸을 얻지 못했습니다.' });
          return;
        }
        const file = wantData ? null : saveReviewImage(p, docId, `still-${secondsTag(job.t ?? t)}s${full ? '-full' : ''}.png`, job.result);
        res.json({
          ok: true,
          t: job.t,
          ...(file ? { file } : {}),
          ...(wantData || !file ? { image: job.result } : {}),
        });
      })
      .catch((err: unknown) => res.status(500).json({ ok: false, error: String(err) }));
  });

  /**
   * §5.13 (W) 38-7 — 장면 정지 화면 한 장(`chapter` 의 `frame` 컴포지션 — 스틸과 같은 일꾼·같은 응답 모양). 기획 단계에서 움직임을
   * 짓기 전에 모양을 승인받는 그림이다. 정지 화면이 없거나 컴포지션이 아니면 400 + 이유(진단과 같은 말).
   */
  app.get('/doc/:docId/frame', (req, res) => {
    const p = project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = req.params.docId;
    const read = videoService.readDoc(p, docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const doc = videoService.refreshCompositions(p, read);
    const chapterId = typeof req.query['chapter'] === 'string' ? req.query['chapter'] : '';
    const chapter = (doc.chapters ?? []).find((c) => c.id === chapterId);
    if (!chapter) { res.status(404).json({ ok: false, error: `unknown chapter '${chapterId}'` }); return; }
    if (!chapterFrameDoc(doc, chapterId)) {
      res.status(400).json({ ok: false, error: `chapter '${chapterId}' has no style frame composition — set chapter.frame = { assetId: <composition asset>, t? }` });
      return;
    }
    const wantData = req.query['format'] === 'dataurl';
    const full = req.query['full'] === '1';
    const t = chapterFrameTime(doc, chapterId);
    videoService
      .requestFrame(p, docId, chapterId, t, full ? 0 : STILL_MAX_EDGE)
      .then((job) => {
        if (job.status !== 'done') {
          res.status(504).json({ ok: false, error: job.error ?? '정지 화면을 얻지 못했습니다.' });
          return;
        }
        const file = wantData ? null : saveReviewImage(p, docId, `frame-${chapterId}${full ? '-full' : ''}.png`, job.result);
        res.json({ ok: true, chapter: chapterId, t, ...(file ? { file } : {}), ...(wantData || !file ? { image: job.result } : {}) });
      })
      .catch((err: unknown) => res.status(500).json({ ok: false, error: String(err) }));
  });

  /**
   * §5.13 (T-9) — 프레임 띠: 한 구간에서 고르게 고른 시각 N 개를 찍어 시각이 적힌 격자 한 장으로. 스틸 한 장은 순간을,
   * 띠 한 장은 흐름을 보여 준다. `item` 이면 그 아이템 구간, 아니면 `from`/`to`(초). 끝 시각은 한 프레임 앞으로 당긴다.
   */
  app.get('/doc/:docId/strip', (req, res) => {
    const p = project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = req.params.docId;
    const read = videoService.readDoc(p, docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const doc = videoService.refreshCompositions(p, read);
    const timeline = resolveTimeline(doc);
    if (timeline.duration <= 0) { res.status(400).json({ ok: false, error: 'the document is empty' }); return; }
    const itemId = typeof req.query['item'] === 'string' && req.query['item'] !== '' ? req.query['item'] : null;
    let from: number;
    let to: number;
    if (itemId) {
      const resolved = timeline.items.find((it) => it.id === itemId);
      if (!resolved) { res.status(404).json({ ok: false, error: `unknown or unplaced item '${itemId}' — check diagnostics` }); return; }
      from = resolved.start;
      to = resolved.end;
    } else {
      from = numQuery(req.query['from'], 0);
      to = numQuery(req.query['to'], timeline.duration);
    }
    from = Math.max(0, Math.min(from, timeline.duration));
    to = Math.max(from, Math.min(to, timeline.duration));
    const count = Math.round(Math.min(STRIP_MAX_FRAMES, Math.max(2, numQuery(req.query['count'], STRIP_DEFAULT_FRAMES))));
    const last = Math.max(from, to - 1 / Math.max(1, doc.fps));
    const times = Array.from({ length: count }, (_, i) => Number((from + ((last - from) * i) / (count - 1)).toFixed(3)));
    const wantData = req.query['format'] === 'dataurl';
    videoService
      .requestStrip(p, docId, times, STRIP_MAX_EDGE)
      .then((job) => {
        if (job.status !== 'done') {
          res.status(504).json({ ok: false, error: job.error ?? '프레임 띠를 얻지 못했습니다.', times });
          return;
        }
        const label = itemId ? itemId.replace(/[^A-Za-z0-9_-]+/g, '-') : `${secondsTag(from)}-${secondsTag(to)}`;
        const file = wantData ? null : saveReviewImage(p, docId, `strip-${label}-${count}.png`, job.result);
        res.json({
          ok: true,
          times,
          ...(file ? { file } : {}),
          ...(wantData || !file ? { image: job.result } : {}),
        });
      })
      .catch((err: unknown) => res.status(500).json({ ok: false, error: String(err) }));
  });

  /**
   * §5.13 (V) 37-9 — 모션 검수. 기본은 문서만 보는 판정(읽을 시간·안전 영역·겹침·빈 구간·자막 잘림·무음·비트 어긋남), `frames=1`
   * 이면 일꾼이 표본 시각을 찍어 대비·평평한 화면·컴포지션 안 글자까지 본다. 스튜디오의 장면 줄 표시와 같은 결과다.
   */
  app.get('/doc/:docId/review', (req, res) => {
    const p = project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = req.params.docId;
    const read = videoService.readDoc(p, docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const doc = videoService.refreshCompositions(p, read);
    const timeline = resolveTimeline(doc);
    if (req.query['frames'] !== '1' || timeline.duration <= 0) {
      res.json({ ok: true, version: doc.version, frames: false, findings: reviewMotion(doc, timeline) });
      return;
    }
    const times = reviewSampleTimes(timeline, REVIEW_MAX_SAMPLES);
    videoService
      .requestReview(p, docId, times)
      .then((job) => {
        let probes: FrameProbe[] = [];
        if (job.status === 'done' && typeof job.result === 'string') {
          try { probes = (JSON.parse(job.result) as FrameProbe[]).filter((x) => x && typeof x.t === 'number'); } catch { probes = []; }
        }
        // 일꾼이 못 왔으면 문서 판정만이라도 돌려준다(그 사실을 함께 — 조용히 줄이지 않는다).
        res.json({
          ok: true,
          version: doc.version,
          frames: job.status === 'done',
          ...(job.status !== 'done' ? { framesError: job.error ?? 'the worker did not return frames' } : {}),
          findings: reviewMotion(doc, timeline, probes),
        });
      })
      .catch((err: unknown) => res.status(500).json({ ok: false, error: String(err) }));
  });

  /**
   * §5.13 (V) 37-13 — 대본: 자막 큐를 문장 목록으로(문서 시각 · 그 문장 동안 나오는 영상·소리 아이템). 실사를 편집할 때 에이전트는
   * 프레임보다 이것을 먼저 읽는다.
   */
  app.get('/doc/:docId/transcript', (req, res) => {
    const p = project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const read = videoService.readDoc(p, req.params.docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const doc = videoService.refreshCompositions(p, read);
    const timeline = resolveTimeline(doc);
    res.json({ ok: true, version: doc.version, duration: timeline.duration, sentences: buildTranscript(doc, timeline) });
  });

  /**
   * §5.13 (V) 37-13 — 문장을 지우면 잘릴 연산을 **계산만** 한다(쓰지 않는다). 경계는 문장 경계, 길이는 문서에서 계산한다 — 에이전트는
   * 돌려받은 `ops` 를 `baseVersion` 과 함께 `/patch` 로 보낸다(쓰는 문은 하나). 스튜디오는 같은 순수 함수를 화면에서 돌린다.
   */
  app.post('/doc/:docId/transcript/cut', (req, res) => {
    const body = req.body as { project?: unknown; sentenceIds?: unknown };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const read = videoService.readDoc(p, req.params.docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    if (!Array.isArray(body.sentenceIds) || body.sentenceIds.length === 0) {
      res.status(400).json({ ok: false, error: 'sentenceIds required (ids from GET /transcript)' });
      return;
    }
    const doc = videoService.refreshCompositions(p, read);
    const timeline = resolveTimeline(doc);
    const sentences = buildTranscript(doc, timeline);
    const wanted = new Set(body.sentenceIds.filter((id): id is string => typeof id === 'string'));
    const unknown = [...wanted].filter((id) => !sentences.some((s) => s.id === id));
    if (unknown.length > 0) { res.status(400).json({ ok: false, error: `unknown sentence ids: ${unknown.slice(0, 5).join(', ')}` }); return; }
    const plan = buildCutOps(doc, timeline, sentenceCutRanges(sentences, wanted));
    res.json({ ok: true, baseVersion: doc.version, ...plan });
  });

  /**
   * §5.13 (W) 38-6 — 자막 파일(SRT · VTT · 낱말 시각 JSON)을 자막 아이템으로 얹는 연산을 **계산만** 한다(쓰지 않는다 — 37-13 과 같다).
   * 앱은 음성 모델을 품지 않는다((H)) — 받아쓰기는 바깥 도구가 프로젝트 안에 만든 파일을 여기로 들인다. 파서는 화면과 같은 순수 함수.
   */
  app.post('/doc/:docId/captions/import', (req, res) => {
    const body = req.body as { project?: unknown; path?: unknown; label?: unknown };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const read = videoService.readDoc(p, req.params.docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const rel = typeof body.path === 'string' ? body.path.trim() : '';
    if (rel === '' || !captionFormatOf(rel)) {
      res.status(400).json({ ok: false, error: 'path must be a project-relative .srt, .vtt or word-timestamp .json file' });
      return;
    }
    const abs = resolveInsideProject(p, rel);
    if (!abs) { res.status(400).json({ ok: false, error: 'path must stay inside the project' }); return; }
    let text: string;
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile()) throw new Error('not a file');
      if (stat.size > CAPTION_IMPORT_MAX_BYTES) { res.status(413).json({ ok: false, error: `caption file is larger than ${CAPTION_IMPORT_MAX_BYTES} bytes` }); return; }
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      res.status(404).json({ ok: false, error: `cannot read '${rel}'` });
      return;
    }
    let parsed: ReturnType<typeof parseCaptionText>;
    try { parsed = parseCaptionText(rel, text); } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const doc = videoService.refreshCompositions(p, read);
    const label = typeof body.label === 'string' && body.label.trim() !== '' ? body.label.trim().slice(0, 120) : path.basename(rel);
    const ops = captionImportOps(doc, parsed.cues, label);
    if (ops.length === 0) { res.status(400).json({ ok: false, error: 'no usable caption cues in the file' }); return; }
    res.json({ ok: true, baseVersion: doc.version, ops, cues: parsed.cues.length, words: parsed.words });
  });

  /**
   * §5.13 (T-8) — 표지를 지금 모은다(끝날 때까지 기다린다). `assetId` 를 주면 그 컴포지션만 다시(낡지 않았어도), 없으면 낡은
   * 것 전부. 정밀 편집의 표지 줄 [다시 모으기]와 에이전트가 같은 길을 쓴다. 평소에는 판본을 물을 때 저절로 걸린다.
   */
  app.post('/doc/:docId/cues', (req, res) => {
    const body = req.body as { project?: unknown; assetId?: unknown; all?: unknown };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const read = videoService.readDoc(p, req.params.docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const doc = videoService.refreshCompositions(p, read);
    const all = body.all === true;
    const assetId = typeof body.assetId === 'string' && body.assetId !== '' ? body.assetId : undefined;
    if (assetId !== undefined && doc.assets[assetId]?.kind !== 'composition') {
      res.status(404).json({ ok: false, error: 'unknown composition asset' });
      return;
    }
    if (assetId !== undefined && doc.assets[assetId]?.usesCues !== true) {
      res.json({ ok: true, results: [], note: 'this composition does not call __vibi.cue' });
      return;
    }
    videoService
      .collectCuesNow(p, doc, assetId, all)
      .then((results) => res.json({ ok: results.every((r) => r.ok), results }))
      .catch((err: unknown) => res.status(500).json({ ok: false, error: String(err) }));
  });

  /**
   * §5.13 (V) 37-12 — 화면이 잰 소재 사실(음악 비트)을 그 소재에 얹는다. 판본을 받지 않는다 — 서버가 최신 문서에 그 칸만
   * 합쳐 적는다(사람의 편집과 부딪히지 않고 되돌리기 이력에도 들어가지 않는다 — 길이 실측과 같은 성격). 허용 칸만 받는다.
   */
  app.post('/doc/:docId/asset-facts', (req, res) => {
    const body = req.body as { project?: unknown; assetId?: unknown; facts?: unknown };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const assetId = typeof body.assetId === 'string' ? body.assetId : '';
    const facts = sanitizeBeatFacts(body.facts);
    if (assetId === '' || !facts) { res.status(400).json({ ok: false, error: 'assetId and beat facts required' }); return; }
    let found = false;
    const updated = videoService.patchFresh(p, req.params.docId, (doc) => {
      const asset = doc.assets[assetId];
      if (!asset || (asset.kind !== 'audio' && asset.kind !== 'video')) return [];
      found = true;
      return [{ op: 'setAsset', asset: { ...asset, ...facts } }];
    });
    if (!updated) { res.status(409).json({ ok: false, error: 'the document kept changing' }); return; }
    if (!found) { res.status(404).json({ ok: false, error: 'unknown audio asset' }); return; }
    res.json({ ok: true, doc: updated });
  });

  /**
   * §5.13 (V) 37-15 — 판형 파생: `<docId>-<판형>` 문서를 만든다(이미 있으면 그것 — 사람이 고친 자리를 덮지 않는다). 실사·그림은
   * 가운데 덮기 상자, 글자·도형은 비율로 옮기고 크기는 짧은 변 비율로, 컴포지션은 새 문서 크기를 받는다(`deriveFormatDoc`).
   */
  app.post('/doc/:docId/derive', (req, res) => {
    const body = req.body as { project?: unknown; format?: unknown };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const format = body.format;
    if (format !== 'landscape' && format !== 'portrait' && format !== 'square') {
      res.status(400).json({ ok: false, error: "format must be 'landscape', 'portrait' or 'square'" });
      return;
    }
    const read = videoService.readDoc(p, req.params.docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const source = videoService.refreshCompositions(p, read);
    const targetId = derivedDocId(source.derivedFrom?.docId ?? source.id, format as VideoFormatId);
    if (targetId === source.id) { res.json({ ok: true, doc: source, created: false }); return; }
    const existing = videoService.readDoc(p, targetId);
    if (existing) { res.json({ ok: true, doc: existing, created: false }); return; }
    // 파생의 파생이면 원본에서 다시 만든다(크기 왕복으로 자리가 닳지 않게).
    const origin = source.derivedFrom ? videoService.readDoc(p, source.derivedFrom.docId) ?? source : source;
    const doc = deriveFormatDoc(origin, format as VideoFormatId, Date.now());
    try {
      videoService.writeDoc(p, doc);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
      return;
    }
    res.json({ ok: true, doc, created: true });
  });

  app.post('/doc/:docId/render', (req, res) => {
    // §5.13 (W) 38-3 — `transparent:true` 면 투명 배경 WebM(알파). 사람이 시킬 때만((T-15)).
    const body = req.body as { project?: unknown; captions?: unknown; transparent?: unknown };
    const p = project(body.project);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    const read = videoService.readDoc(p, req.params.docId);
    if (!read) {
      res.status(404).json({ ok: false, error: 'unknown doc' }); return;
    }
    const doc = videoService.refreshCompositions(p, read);
    // §5.13 (T-8) — 코드를 고친 뒤 표지를 아직 안 모았으면 모으기를 먼저 건다 — 렌더는 그 뒤에 선다(낡은 시각으로 소리를 깔지 않는다).
    const after = videoService.cueJobsFor(p, doc);
    const job = videoService.enqueueRender(p, req.params.docId, after, body.captions === 'separate', body.transparent === true);
    res.json({ ok: true, job });
  });

  app.get('/jobs', (req, res) => {
    const raw = req.query['project'];
    const p = typeof raw === 'string' ? project(raw) : null;
    res.json({ ok: true, jobs: videoService.listJobs(p ?? undefined) });
  });

  app.get('/job/:jobId', (req, res) => {
    const job = videoService.getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ ok: false, error: 'unknown job' });
      return;
    }
    res.json({ ok: true, job });
  });

  /** 일꾼이 다음 일감을 가져간다. `lane` 을 주면 그 줄만(스틸 줄·렌더 줄 — T-4). */
  app.post('/jobs/claim', (req, res) => {
    // §5.13 (V) 37-17 — 일꾼 전용. 토큰을 가진 에이전트가 일꾼인 척 일감을 집어 결과를 꾸미지 못하게.
    if (rejectAgent(req, res, 'Jobs are processed by the Vibistudio worker window.')) return;
    const raw: unknown = req.body?.project;
    const p = raw === undefined ? undefined : project(raw);
    if (p === null) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const laneRaw: unknown = req.body?.lane;
    const lane = laneRaw === 'still' || laneRaw === 'render' ? laneRaw : undefined;
    const job = videoService.claimNext(p, lane);
    res.json({ ok: true, job });
  });

  app.put('/job/:jobId/output', express.raw({ type: 'application/octet-stream', limit: VIDEO_UPLOAD_LIMIT }), (req, res) => {
    if (rejectAgent(req, res, 'Job results come from the Vibistudio worker window.')) return;
    const job = videoService.getJob(req.params.jobId);
    if (!job) { res.status(404).json({ ok: false, error: 'unknown output job' }); return; }
    if (job.status !== 'running') { res.status(409).json({ ok: false, error: 'output job is not running' }); return; }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) { res.status(400).json({ ok: false, error: 'Expected output bytes.' }); return; }
    try {
      const result = job.kind === 'render'
        ? videoService.saveRenderOutput(job.projectPath, job.docId, req.body, job.transparent === true ? 'webm' : 'mp4')
        : `data:image/png;base64,${req.body.toString('base64')}`;
      res.json({ ok: true, job: videoService.updateJob(job.id, { status: 'done', progress: 1, result }) });
    } catch (error) { res.status(500).json({ ok: false, error: String(error) }); }
  });

  /** 일꾼이 진행률·결과를 돌려준다. 진행 보고는 임대(T-4)의 숨소리이기도 하다. */
  app.post('/job/:jobId/report', (req, res) => {
    if (rejectAgent(req, res, 'Job reports come from the Vibistudio worker window.')) return;
    const body = req.body as {
      status?: VideoJobStatus;
      progress?: number;
      image?: string;
      error?: string;
      note?: string;
      /** 렌더 완료 시 base64 mp4. */
      bytes?: string;
      /** §5.13 (V) 37-9 — 검수 표본(JSON 글). */
      data?: string;
    };
    const job = videoService.getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ ok: false, error: 'unknown job' });
      return;
    }

    let result: string | undefined;
    if (job.kind === 'render' && typeof body.bytes === 'string' && body.bytes.length > 0) {
      try {
        result = videoService.saveRenderOutput(job.projectPath, job.docId, Buffer.from(body.bytes, 'base64'), job.transparent === true ? 'webm' : 'mp4');
      } catch (err) {
        res.status(500).json({ ok: false, error: `결과를 저장하지 못했습니다: ${String(err)}` });
        return;
      }
    } else if ((job.kind === 'review' || job.kind === 'cues') && typeof body.data === 'string') {
      result = body.data;
    } else if (job.kind !== 'render' && typeof body.image === 'string') {
      result = body.image;
    }

    const updated = videoService.updateJob(req.params.jobId, {
      ...(body.status === undefined ? {} : { status: body.status }),
      ...(typeof body.progress === 'number' ? { progress: body.progress } : {}),
      ...(result === undefined ? {} : { result }),
      ...(body.error === undefined ? {} : { error: body.error }),
      ...(body.note === undefined ? {} : { note: body.note }),
    });
    res.json({ ok: true, job: updated });
  });

  h().info('[video] Vibistudio 라우트를 마운트했습니다.');
}
