/** §5.13 — 스틸·장면 정지 화면·장면 대표 프레임·프레임 띠·모션 검수(숨은 일꾼 창이 그리는 읽기 길). */
import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import { resolveInsideProject } from './composition.js';
import { CHAPTER_THUMB_MAX_EDGE, chapterThumbWants, chapterFrameDoc, chapterFrameTime, REVIEW_MAX_SAMPLES, reviewMotion, checkVideoRequirements, reviewSampleTimes, type FrameProbe, STILL_MAX_EDGE, STRIP_DEFAULT_FRAMES, STRIP_MAX_EDGE, STRIP_MAX_FRAMES, VIDEO_REVIEW_DIR, resolveTimeline } from '../index.js';
import type { AppServerHost } from '../host.js';
import { pruneThumbs, readThumbs, thumbsDirFor, writeThumb } from './thumbCache.js';
import type { VideoService } from './videoService.js';
import { numQuery, secondsTag, isSafeId } from './routeSupport.js';

export interface PreviewRoutesDeps {
  readonly project: (raw: unknown) => string | null;
  readonly host: () => AppServerHost;
  readonly service: VideoService;
}

/** A project-relative evidence frame exists as a regular file inside the project (asynchronous stat). */
async function evidenceFrameExists(projectPath: string, rel: string): Promise<boolean> {
  const abs = resolveInsideProject(projectPath, rel);
  if (!abs) return false;
  try { return (await fs.promises.stat(abs)).isFile(); } catch { return false; }
}

/**
 * §5.13 (G)(T-9) — PNG 를 프로젝트 안에 쓴다 — 에이전트가 Read 로 열어 본다(수백 KB data URL 을 응답에 실으면 문맥만 태운다).
 * 같은 이름은 덮어써 지우는 코드 없이도 끝없이 쌓이지 않는다((K) 자동 삭제 없음).
 */
export function saveReviewImage(host: () => AppServerHost, projectPath: string, docId: string, name: string, dataUrl: string | undefined): string | null {
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
    host().warn(`[video] 검수 그림을 쓰지 못했습니다: ${String(err)}`);
    return null;
  }
}

export function mountPreviewRoutes(app: Express, deps: PreviewRoutesDeps): void {
  const { project, host, service } = deps;
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
    const read = service.readDoc(p, docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    service.refreshCompositions(p, read);
    const t = numQuery(req.query['t'], 0);
    const wantData = req.query['format'] === 'dataurl';
    const full = req.query['full'] === '1';
    service
      .requestStill(p, docId, Math.max(0, t), { maxEdge: full ? 0 : STILL_MAX_EDGE })
      .then((job) => {
        if (job.status !== 'done') {
          res.status(504).json({ ok: false, error: job.error ?? '스틸을 얻지 못했습니다.' });
          return;
        }
        const file = wantData ? null : saveReviewImage(host, p, docId, `still-${secondsTag(job.t ?? t)}s${full ? '-full' : ''}.png`, job.result);
        res.json({
          ok: true,
          t: job.t,
          ...(file ? { file } : {}),
          ...(wantData || !file ? { image: job.result } : {}),
        });
      })
      .catch((err: unknown) => res.status(500).json({ ok: false, error: String(err) }));
  });

  /** §5.13 (W) 38-7 — 장면 정지 화면 한 장(`chapter` 의 `frame` 컴포지션 — 스틸과 같은 일꾼·응답 모양). 없거나 컴포지션이 아니면 400 + 이유. */
  app.get('/doc/:docId/frame', (req, res) => {
    const p = project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = req.params.docId;
    const read = service.readDoc(p, docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const doc = service.refreshCompositions(p, read);
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
    service
      .requestFrame(p, docId, chapterId, t, full ? 0 : STILL_MAX_EDGE)
      .then((job) => {
        if (job.status !== 'done') {
          res.status(504).json({ ok: false, error: job.error ?? '정지 화면을 얻지 못했습니다.' });
          return;
        }
        const file = wantData ? null : saveReviewImage(host, p, docId, `frame-${chapterId}${full ? '-full' : ''}.png`, job.result);
        res.json({ ok: true, chapter: chapterId, t, ...(file ? { file } : {}), ...(wantData || !file ? { image: job.result } : {}) });
      })
      .catch((err: unknown) => res.status(500).json({ ok: false, error: String(err) }));
  });

  /**
   * §5.13 (X) 39-4 — 장면 대표 프레임 한 번에. 디스크에 있는 것은 바로 준다(`thumbs`). `render=1` 이면 빠진 것을 굽는다 — 일반 장면은 일감 하나(`stills`),
   * 기획 장면 정지 화면은 장면마다(서로 다른 문서라 무대를 나눠 쓸 수 없다). 상한을 넘으면 지금 장면이 안 쓰는 옛 그림부터 지운다. `missing` = 그래도 없는 열쇠.
   */
  app.get('/doc/:docId/chapter-thumbs', (req, res) => {
    const p = project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = req.params.docId;
    if (!isSafeId(docId)) { res.status(400).json({ ok: false, error: 'invalid doc id' }); return; }
    const read = service.readDoc(p, docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const doc = service.refreshCompositions(p, read);
    const wants = chapterThumbWants(doc, resolveTimeline(doc));
    const dir = thumbsDirFor(p, docId);
    const render = req.query['render'] === '1';
    void (async () => {
      const found = await readThumbs(dir, wants.map((w) => w.key));
      if (render) {
        const missing = wants.filter((w) => !found.has(w.key));
        const stills = missing.flatMap((w) => (w.source.kind === 'still' ? [{ key: w.key, t: w.source.t }] : []));
        if (stills.length > 0) {
          const job = await service.requestStills(p, docId, stills.map((s) => s.t), CHAPTER_THUMB_MAX_EDGE, 'webp');
          let images: unknown = [];
          if (job.status === 'done' && typeof job.result === 'string') {
            try { images = JSON.parse(job.result); } catch { images = []; }
          }
          if (Array.isArray(images)) {
            for (let i = 0; i < stills.length; i += 1) {
              const image = images[i];
              const s = stills[i];
              if (!s || typeof image !== 'string' || !image.startsWith('data:image/')) continue;
              found.set(s.key, image);
              await writeThumb(dir, s.key, image);
            }
          }
        }
        for (const w of missing) {
          if (w.source.kind !== 'frame') continue;
          const job = await service.requestFrame(p, docId, w.chapterId, chapterFrameTime(doc, w.chapterId), CHAPTER_THUMB_MAX_EDGE);
          if (job.status !== 'done' || typeof job.result !== 'string' || !job.result.startsWith('data:image/')) continue;
          found.set(w.key, job.result);
          await writeThumb(dir, w.key, job.result);
        }
        await pruneThumbs(dir, new Set(wants.map((w) => w.key)));
      }
      const thumbs: Record<string, string> = {};
      for (const [key, image] of found) thumbs[key] = image;
      res.json({ ok: true, version: doc.version, thumbs, missing: wants.filter((w) => !found.has(w.key)).map((w) => w.key) });
    })().catch((err: unknown) => res.status(500).json({ ok: false, error: String(err) }));
  });

  /** §5.13 (T-9) — 프레임 띠: 구간에서 고르게 고른 시각 N 개를 시각이 적힌 격자 한 장으로. `item` 이면 그 구간, 아니면 `from`/`to`(초). 끝 시각은 한 프레임 앞으로 당긴다. */
  app.get('/doc/:docId/strip', (req, res) => {
    const p = project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = req.params.docId;
    const read = service.readDoc(p, docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const doc = service.refreshCompositions(p, read);
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
    service
      .requestStrip(p, docId, times, STRIP_MAX_EDGE)
      .then((job) => {
        if (job.status !== 'done') {
          res.status(504).json({ ok: false, error: job.error ?? '프레임 띠를 얻지 못했습니다.', times });
          return;
        }
        const label = itemId ? itemId.replace(/[^A-Za-z0-9_-]+/g, '-') : `${secondsTag(from)}-${secondsTag(to)}`;
        const file = wantData ? null : saveReviewImage(host, p, docId, `strip-${label}-${count}.png`, job.result);
        res.json({
          ok: true,
          times,
          ...(file ? { file } : {}),
          ...(wantData || !file ? { image: job.result } : {}),
        });
      })
      .catch((err: unknown) => res.status(500).json({ ok: false, error: String(err) }));
  });

  /** §5.13 (V) 37-9 — 모션 검수. 기본은 문서만, `frames=1` 이면 일꾼이 표본을 찍어 대비·평평한 화면·컴포지션 안 글자까지 본다(스튜디오 표시와 같은 결과). */
  app.get('/doc/:docId/review', async (req, res) => {
    const p = project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = req.params.docId;
    const read = service.readDoc(p, docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const doc = service.refreshCompositions(p, read);
    const timeline = resolveTimeline(doc);
    // §5.13 (R-10) — asynchronous (one shared frame budget, yields between slices) so this thread keeps serving;
    // a visual verdict counts only when its frame file is really in the project.
    let requestChecks: Awaited<ReturnType<typeof checkVideoRequirements>>;
    try {
      requestChecks = await checkVideoRequirements(doc, timeline, { frameExists: (rel) => evidenceFrameExists(p, rel) });
    } catch (err) { res.status(500).json({ ok: false, error: String(err) }); return; }
    if (req.query['frames'] !== '1' || timeline.duration <= 0) {
      res.json({ ok: true, version: doc.version, frames: false, findings: reviewMotion(doc, timeline), requestChecks });
      return;
    }
    const times = reviewSampleTimes(timeline, REVIEW_MAX_SAMPLES);
    service
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
          requestChecks,
        });
      })
      .catch((err: unknown) => res.status(500).json({ ok: false, error: String(err) }));
  });
}
