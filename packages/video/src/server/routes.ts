/**
 * §5.13 Vibistudio — 서버 서비스.
 *
 * 코어(`index.ts`)는 `mountVideoRoutes(app)` 한 줄만 안다(플러그인 호스트 선례).
 *
 * **서버는 그리지 않는다.** 그리기는 캔버스와 WebCodecs 가 있는 렌더러 몫이고, 여기서는
 * 문서를 보관하고 편집을 중재하고 작업을 줄 세운다. §3.7 단일 프로세스 원칙상 렌더용
 * 자식 프로세스를 띄우지 않으므로, 렌더 요청은 **일감(job)** 으로 쌓아 두고 스튜디오
 * 창이 가져가 처리한 뒤 결과를 돌려준다.
 *
 * 편집 중재의 핵심은 낙관적 잠금이다 — 여러 에이전트가 같은 문서를 동시에 만지는 것이
 * 이 앱의 기본 상황이라, 마지막에 쓴 쪽이 조용히 이기면 작업이 소리 없이 사라진다.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';

import {
  VIDEO_DIR,
  VIDEO_OUT_DIR,
  applyPatch,
  createEmptyDoc,
  resolveTimeline,
  validateDoc,
  type VideoDoc,
  type VideoDocPatch,
} from '../index.js';

import type { AppServerHost } from '../host.js';

/** 스틸 요청이 응답을 기다리는 최대 시간(ms). 넘으면 스튜디오가 없다고 본다. */
const STILL_TIMEOUT_MS = 30_000;
/** 끝난 일감을 얼마나 들고 있을지(ms). 결과를 가져갈 시간은 주되 무한정 쌓지 않는다. */
const JOB_RETENTION_MS = 10 * 60_000;

export type VideoJobKind = 'render' | 'still';
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
  /** `still` 이면 data URL, `render` 면 만들어진 파일 경로. */
  result?: string;
  error?: string;
  /** `still` 전용 — 뽑을 시각(초). */
  t?: number;
  /** 렌더 방식이 강등됐다면 그 사실. 조용히 느려지지 않게 그대로 올린다. */
  note?: string;
}

interface PendingStill {
  resolve: (job: VideoJob) => void;
  timer: NodeJS.Timeout;
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
  private readonly pendingStills = new Map<string, PendingStill>();
  private seq = 0;

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

  // ─── 일감 ───

  private newJob(kind: VideoJobKind, projectPath: string, docId: string, t?: number): VideoJob {
    const job: VideoJob = {
      id: `job-${Date.now().toString(36)}-${(this.seq++).toString(36)}`,
      kind,
      projectPath,
      docId,
      status: 'queued',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(t === undefined ? {} : { t }),
    };
    this.jobs.set(job.id, job);
    this.sweep();
    return job;
  }

  enqueueRender(projectPath: string, docId: string): VideoJob {
    return this.newJob('render', projectPath, docId);
  }

  /** 스튜디오가 가져갈 다음 일감. 먼저 들어온 것부터. */
  claimNext(): VideoJob | null {
    for (const job of this.jobs.values()) {
      if (job.status === 'queued') {
        job.status = 'running';
        job.updatedAt = Date.now();
        return job;
      }
    }
    return null;
  }

  getJob(jobId: string): VideoJob | undefined {
    return this.jobs.get(jobId);
  }

  listJobs(projectPath?: string): VideoJob[] {
    const all = [...this.jobs.values()];
    return projectPath === undefined ? all : all.filter((j) => j.projectPath === projectPath);
  }

  updateJob(jobId: string, patch: Partial<Pick<VideoJob, 'status' | 'progress' | 'result' | 'error' | 'note'>>): VideoJob | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    Object.assign(job, patch);
    job.updatedAt = Date.now();

    if (job.kind === 'still' && (job.status === 'done' || job.status === 'error')) {
      const pending = this.pendingStills.get(jobId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingStills.delete(jobId);
        pending.resolve(job);
      }
    }
    return job;
  }

  /** 렌더 결과 바이트를 프로젝트 안에 쓴다. 경로를 돌려준다. */
  saveRenderOutput(projectPath: string, docId: string, bytes: Buffer): string {
    const dir = outDirFor(projectPath);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${docId}-${Date.now()}.mp4`);
    fs.writeFileSync(file, bytes);
    return file;
  }

  /**
   * 스틸 한 장을 요청하고 기다린다.
   *
   * 에이전트가 "2.4초 지점 보여 줘"라고 물으면 그 자리에서 답이 와야 루프가 성립하므로,
   * 권한 승인 팝업과 같은 방식으로 일감을 걸어 두고 응답을 기다린다. 스튜디오가 안 떠
   * 있으면 시간이 지나 실패로 끝난다 — 영원히 매달리지 않는다.
   */
  requestStill(projectPath: string, docId: string, t: number): Promise<VideoJob> {
    const job = this.newJob('still', projectPath, docId, t);
    return new Promise<VideoJob>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingStills.delete(job.id);
        job.status = 'error';
        job.error = '스튜디오가 응답하지 않았습니다. 영상 편집 창이 열려 있는지 확인하세요.';
        job.updatedAt = Date.now();
        resolve(job);
      }, STILL_TIMEOUT_MS);
      this.pendingStills.set(job.id, { resolve, timer });
    });
  }

  private sweep(): void {
    const cutoff = Date.now() - JOB_RETENTION_MS;
    for (const [id, job] of this.jobs) {
      const finished = job.status === 'done' || job.status === 'error' || job.status === 'canceled';
      if (finished && job.updatedAt < cutoff) this.jobs.delete(id);
    }
  }
}

export const videoService = new VideoService();

/** 프로젝트 해소는 호스트가 한다 — 앱은 프로젝트가 무엇인지 모른다. */
function resolveProjectPath(raw: unknown): string | null {
  return h().resolveProjectPath(raw);
}

/**
 * 이 앱의 서버 몫을 붙인다.
 *
 * **설치되어 있을 때만 불린다** — 안 깔았으면 이 파일 자체가 로드되지 않는다
 * (`appHost` 가 늦게 import 한다). 그래서 안 쓰는 사용자는 이 코드의 비용을 0으로 낸다.
 */
export function mountVideoRoutes(app: Express, serverHost: AppServerHost): void {
  host = serverHost;
  /** 공통 — 프로젝트를 못 찾으면 404. */
  const project = (raw: unknown): string | null => resolveProjectPath(raw);

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
    const doc = videoService.createDoc(p, title, requestedId);
    res.json({ ok: true, doc });
  });

  app.get('/doc/:docId', (req, res) => {
    const p = project(req.query['project']);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    const doc = videoService.readDoc(p, req.params.docId);
    if (!doc) {
      res.status(404).json({ ok: false, error: 'unknown doc' });
      return;
    }
    // 에이전트가 편집 전에 읽는 그 응답이다 — 지금 상태와 시간 해소 결과를 함께 준다.
    const timeline = resolveTimeline(doc);
    res.json({
      ok: true,
      doc,
      duration: timeline.duration,
      diagnostics: timeline.diagnostics,
    });
  });

  app.post('/doc/:docId/patch', (req, res) => {
    const body = req.body as { project?: unknown } & Partial<VideoDocPatch>;
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

    videoService.writeDoc(p, result.doc);
    const timeline = resolveTimeline(result.doc);
    res.json({ ok: true, doc: result.doc, duration: timeline.duration, diagnostics: timeline.diagnostics });
  });

  app.delete('/doc/:docId', (req, res) => {
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
  app.get('/asset', (req, res) => {
    const p = project(req.query['project']);
    const rel = req.query['path'];
    if (!p || typeof rel !== 'string' || rel === '') {
      res.status(404).json({ ok: false, error: 'unknown project or path' });
      return;
    }
    const root = path.resolve(p);
    const target = path.resolve(root, rel);
    const inside = target === root || target.startsWith(root + path.sep);
    if (!inside || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    res.sendFile(target);
  });

  // ─── 스틸 · 렌더 ───

  app.get('/doc/:docId/still', (req, res) => {
    const p = project(req.query['project']);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    const t = Number(req.query['t'] ?? 0);
    videoService
      .requestStill(p, req.params.docId, Number.isFinite(t) ? t : 0)
      .then((job) => {
        if (job.status === 'done') res.json({ ok: true, t: job.t, image: job.result });
        else res.status(504).json({ ok: false, error: job.error ?? '스틸을 얻지 못했습니다.' });
      })
      .catch((err: unknown) => res.status(500).json({ ok: false, error: String(err) }));
  });

  app.post('/doc/:docId/render', (req, res) => {
    const body = req.body as { project?: unknown };
    const p = project(body.project);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    const job = videoService.enqueueRender(p, req.params.docId);
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

  /** 스튜디오가 다음 일감을 가져간다. */
  app.post('/jobs/claim', (_req, res) => {
    const job = videoService.claimNext();
    res.json({ ok: true, job });
  });

  /** 스튜디오가 진행률·결과를 돌려준다. */
  app.post('/job/:jobId/report', (req, res) => {
    const body = req.body as {
      status?: VideoJobStatus;
      progress?: number;
      image?: string;
      error?: string;
      note?: string;
      /** 렌더 완료 시 base64 mp4. */
      bytes?: string;
    };
    const job = videoService.getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ ok: false, error: 'unknown job' });
      return;
    }

    let result: string | undefined;
    if (job.kind === 'render' && typeof body.bytes === 'string' && body.bytes.length > 0) {
      try {
        result = videoService.saveRenderOutput(job.projectPath, job.docId, Buffer.from(body.bytes, 'base64'));
      } catch (err) {
        res.status(500).json({ ok: false, error: `결과를 저장하지 못했습니다: ${String(err)}` });
        return;
      }
    } else if (job.kind === 'still' && typeof body.image === 'string') {
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
