/** §5.13 (T-4)(AA) — 렌더 걸기와 일감 줄(조회·집기·결과 받기·진행 보고). 일꾼 전용 길은 루프백 403(37-17). */
import path from 'node:path';
import express, { type Express } from 'express';
import { VIDEO_UPLOAD_LIMIT } from './assets.js';
import { resolveTimeline } from '../index.js';
import { isAgentRequest, rejectAgent } from './guards.js';
import { exportText } from '../exportValues.js';
import { normalizeRange, normalizeRenderOutput, normalizeRenderSpec } from '../renderSpec.js';
import { type VideoService, type VideoJobStatus, renderOutputRange } from './videoService.js';
import { segmentPruneBook } from './segmentCache.js';

export interface JobRoutesDeps {
  readonly project: (raw: unknown) => string | null;
  readonly service: VideoService;
}

export function mountJobRoutes(app: Express, deps: JobRoutesDeps): void {
  const { project, service } = deps;
  app.post('/doc/:docId/render', (req, res) => {
    // §5.13 (W) 38-3 — `transparent:true` 면 투명 배경 WebM(알파). 사람이 시킬 때만((T-15)).
    // §5.13 (AA) 42 — `spec`(그리는 방법) · `output`(놓는 방법) · `schedule`({ at?, hold? }) · `label`. 없으면 종전 렌더 그대로.
    const body = req.body as { project?: unknown; captions?: unknown; transparent?: unknown; spec?: unknown; output?: unknown; schedule?: unknown; label?: unknown };
    const p = project(body.project);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    const read = service.readDoc(p, req.params.docId);
    if (!read) {
      res.status(404).json({ ok: false, error: 'unknown doc' }); return;
    }
    const agent = isAgentRequest(req);
    const asked = body.output === undefined ? undefined : normalizeRenderOutput(body.output);
    // §5.13 (AA) 42-2·42-9 — 저장 위치·덮어쓰기는 사람만 정한다(토큰 보유 ≠ 사용자 의사, 37-17).
    if (asked && (asked.dir !== null || asked.conflict === 'overwrite') && agent) {
      res.status(403).json({ ok: false, error: 'renderer-only', hint: 'The output folder and overwrite are chosen by the user in the Vibistudio export window.' });
      return;
    }
    // 에이전트가 건 렌더는 사람의 화면에 무언가를 띄우지 않는다(알림·폴더 열기·절전 막기·노드 담기는 사람이 고른 것만).
    const output = asked && agent
      ? { ...asked, after: { reveal: false, notify: false, deliver: false }, keepAwake: false, notice: null }
      : asked;
    if (output?.dir && !path.isAbsolute(output.dir)) {
      res.status(400).json({ ok: false, error: 'output.dir must be an absolute folder' });
      return;
    }
    const doc = service.refreshCompositions(p, read);
    // §5.13 (T-8) — 코드를 고친 뒤 표지를 아직 안 모았으면 모으기를 먼저 건다 — 렌더는 그 뒤에 선다(낡은 시각으로 소리를 깔지 않는다).
    const after = service.cueJobsFor(p, doc);
    const rawSpec = body.spec === undefined ? undefined : normalizeRenderSpec(body.spec);
    const spec = rawSpec ? { ...rawSpec, range: normalizeRange(rawSpec.range, resolveTimeline(doc).duration) } : undefined;
    const schedule = (body.schedule !== null && typeof body.schedule === 'object' ? body.schedule : {}) as { at?: unknown; hold?: unknown };
    const at = typeof schedule.at === 'number' && Number.isFinite(schedule.at) && schedule.at > Date.now() ? schedule.at : undefined;
    const label = exportText(body.label);
    const hideCaptions = spec ? spec.captions !== 'burn' : body.captions === 'separate';
    const transparent = spec ? spec.format === 'webm-alpha' : body.transparent === true;
    const job = service.enqueueRender(p, req.params.docId, after, hideCaptions, transparent, {
      title: doc.title,
      ...(spec ? { spec } : {}),
      ...(output ? { output } : {}),
      ...(label ? { label } : {}),
      ...(schedule.hold === true ? { held: true } : {}),
      ...(at !== undefined ? { notBefore: at } : {}),
    });
    res.json({ ok: true, job });
  });

  app.get('/jobs', (req, res) => {
    const raw = req.query['project'];
    const p = typeof raw === 'string' ? project(raw) : null;
    // §5.13 (AA) 42-5 — `kind=render` 면 대기열만.
    const kindRaw = req.query['kind'];
    const kind = kindRaw === 'render' || kindRaw === 'still' || kindRaw === 'strip' || kindRaw === 'review' || kindRaw === 'cues' || kindRaw === 'stills' || kindRaw === 'compare' ? kindRaw : undefined;
    res.json({ ok: true, jobs: service.listJobs(p ?? undefined, kind) });
  });

  app.get('/job/:jobId', (req, res) => {
    const job = service.getJob(req.params.jobId);
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
    const job = service.claimNext(p, lane);
    res.json({ ok: true, job });
  });

  app.put('/job/:jobId/output', express.raw({ type: 'application/octet-stream', limit: VIDEO_UPLOAD_LIMIT }), (req, res) => {
    if (rejectAgent(req, res, 'Job results come from the Vibistudio worker window.')) return;
    const job = service.getJob(req.params.jobId);
    if (!job) { res.status(404).json({ ok: false, error: 'unknown output job' }); return; }
    if (job.status !== 'running') { res.status(409).json({ ok: false, error: 'output job is not running' }); return; }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) { res.status(400).json({ ok: false, error: 'Expected output bytes.' }); return; }
    if (job.kind === 'render') {
      const bytes = req.body;
      const header = req.get('Content-Range');
      const range = header === undefined ? undefined : renderOutputRange(header, bytes.length);
      if (range === null) { res.status(400).json({ ok: false, error: 'Invalid output byte range.' }); return; }
      void service.receiveRenderOutput(job, bytes, range)
        .then((done) => {
          if (done.status !== 200) res.status(done.status).json({ ok: false, error: done.error ?? 'output rejected' });
          else res.json({ ok: true, job: done.job });
        })
        .catch((error: unknown) => { res.status(500).json({ ok: false, error: String(error) }); });
      return;
    }
    try {
      const result = `data:image/png;base64,${req.body.toString('base64')}`;
      res.json({ ok: true, job: service.updateJob(job.id, { status: 'done', progress: 1, result }) });
    } catch (error) { res.status(500).json({ ok: false, error: String(error) }); }
  });

  /** §5.13 (AA) 42-11 — 흘려 보낸 렌더 결과의 끝맺음(전체 크기). */
  app.post('/job/:jobId/output/commit', (req, res) => {
    if (rejectAgent(req, res, 'Job results come from the Vibistudio worker window.')) return;
    const job = service.getJob(req.params.jobId);
    if (!job || job.kind !== 'render') { res.status(404).json({ ok: false, error: 'unknown output job' }); return; }
    if (job.status !== 'running') { res.status(409).json({ ok: false, error: 'output job is not running' }); return; }
    const total = (req.body as { total?: unknown } | undefined)?.total;
    if (typeof total !== 'number' || !Number.isSafeInteger(total) || total <= 0) { res.status(400).json({ ok: false, error: 'Expected total output size.' }); return; }
    void service.commitRenderOutput(job, total)
      .then((done) => {
        if (done.status !== 200) res.status(done.status).json({ ok: false, error: done.error ?? 'output rejected' });
        else res.json({ ok: true, job: done.job });
      })
      .catch((error: unknown) => { res.status(500).json({ ok: false, error: String(error) }); })
      // §5.13 (E-6) — 이 렌더가 쓴 구간 조각이 있으면 상한·나이 정리를 한 번 건다(응답을 붙잡지 않는다).
      .finally(() => { void segmentPruneBook.flush(job.projectPath); });
  });

  /** §5.13 (E-5) ③ — 올리던 렌더 결과를 버린다(구간을 이을 수 없어 처음부터 다시 굽기 전). */
  app.delete('/job/:jobId/output', (req, res) => {
    if (rejectAgent(req, res, 'Job results come from the Vibistudio worker window.')) return;
    const job = service.getJob(req.params.jobId);
    if (!job || job.kind !== 'render') { res.status(404).json({ ok: false, error: 'unknown output job' }); return; }
    if (job.status !== 'running') { res.status(409).json({ ok: false, error: 'output job is not running' }); return; }
    void service.resetRenderOutput(job)
      .then((done) => {
        if (done.status !== 200) res.status(done.status).json({ ok: false, error: done.error ?? 'output rejected' });
        else res.json({ ok: true, job: done.job });
      })
      .catch((error: unknown) => { res.status(500).json({ ok: false, error: String(error) }); });
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
      /** §5.13 (AA) 42-5 — 그린 프레임·전체 프레임(초당 프레임 계산). */
      frame?: number;
      totalFrames?: number;
    };
    const job = service.getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ ok: false, error: 'unknown job' });
      return;
    }
    const frameOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10_000_000 ? v : undefined);
    const frame = frameOf(body.frame);
    const totalFrames = frameOf(body.totalFrames);

    let result: string | undefined;
    if (job.kind === 'render' && typeof body.bytes === 'string' && body.bytes.length > 0) {
      try {
        result = service.saveRenderOutput(job.projectPath, job.docId, Buffer.from(body.bytes, 'base64'), job.transparent === true ? 'webm' : 'mp4');
      } catch (err) {
        res.status(500).json({ ok: false, error: `결과를 저장하지 못했습니다: ${String(err)}` });
        return;
      }
    } else if ((job.kind === 'review' || job.kind === 'cues' || job.kind === 'stills') && typeof body.data === 'string') {
      result = body.data;
    } else if (job.kind !== 'render' && typeof body.image === 'string') {
      result = body.image;
    }

    const updated = service.updateJob(req.params.jobId, {
      ...(body.status === undefined ? {} : { status: body.status }),
      ...(typeof body.progress === 'number' ? { progress: body.progress } : {}),
      ...(result === undefined ? {} : { result }),
      ...(body.error === undefined ? {} : { error: body.error }),
      ...(body.note === undefined ? {} : { note: body.note }),
      ...(frame === undefined ? {} : { frame }),
      ...(totalFrames === undefined ? {} : { totalFrames }),
    });
    res.json({ ok: true, job: updated });
  });
}
