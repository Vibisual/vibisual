/** §5.13 (V) 37-1 — 문서 갤러리 포스터: 문서마다 대표 한 장(디스크 기억 → 없으면 한 장만 배경으로 굽는다). */
import type { Express } from 'express';
import { CHAPTER_THUMB_MAX_EDGE, chapterFrameTime, chapterThumbWants, docPosterWant, resolveTimeline, type DocPosterWant, type VideoDoc } from '../index.js';
import { pruneThumbs, readThumbs, removeThumbsDir, thumbsDirFor, writeThumb } from './thumbCache.js';
import type { VersionBook } from './versionBook.js';
import type { VideoService } from './videoService.js';
import { isSafeId } from './routeSupport.js';

export interface PosterRoutesDeps {
  readonly project: (raw: unknown) => string | null;
  readonly service: VideoService;
  readonly versions: VersionBook;
}

type PosterState = 'hit' | 'baked' | 'missing' | 'failed' | 'empty';

/** 같은 열쇠를 여러 창·카드가 동시에 청해도 굽기는 한 번. */
const baking = new Map<string, Promise<string | null>>();

function isImage(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

/** 일감 줄에는 `background` 로 선다 — 에이전트·스튜디오의 스틸 뒤. 못 얻으면 `null`. */
async function bakePoster(service: VideoService, p: string, doc: VideoDoc, want: DocPosterWant): Promise<string | null> {
  if (want.source.kind === 'frame') {
    if (want.chapterId === null) return null;
    const job = await service.requestFrame(p, doc.id, want.chapterId, chapterFrameTime(doc, want.chapterId), CHAPTER_THUMB_MAX_EDGE, { background: true });
    return job.status === 'done' && isImage(job.result) ? job.result : null;
  }
  const job = await service.requestStills(p, doc.id, [want.source.t], CHAPTER_THUMB_MAX_EDGE, 'webp', { background: true });
  if (job.status !== 'done' || typeof job.result !== 'string') return null;
  try {
    const images: unknown = JSON.parse(job.result);
    return Array.isArray(images) && isImage(images[0]) ? images[0] : null;
  } catch { return null; }
}

export function mountPosterRoutes(app: Express, deps: PosterRoutesDeps): void {
  const { project, service, versions } = deps;
  /**
   * `render=0` 은 디스크에 있는 것만 읽는다(문서도 고치지 않는다 — 갤러리를 연다고 컴포지션 탐침·표지 모으기가 도는 일이 없게).
   * `render=1` 은 디스크에 없을 때만 그 한 장을 굽는다(문서는 어느 경우에도 쓰지 않는다). 열쇠는 보이는 내용에서만 나와 제목 고치기는 다시 굽지 않는다.
   */
  app.get('/doc/:docId/poster', (req, res) => {
    const p = project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = req.params.docId;
    if (!isSafeId(docId)) { res.status(400).json({ ok: false, error: 'invalid doc id' }); return; }
    const render = req.query['render'] === '1';
    void (async () => {
      // 판 기억(비동기 stat + 읽기) — 갤러리가 문서마다 묻는 길이라 창 스레드를 동기 읽기로 막지 않는다.
      const doc = await versions.doc(p, docId);
      if (!doc) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
      const dir = thumbsDirFor(p, docId);
      const timeline = resolveTimeline(doc);
      const want = docPosterWant(doc, timeline);
      let state: PosterState = 'empty';
      let image: string | null = null;
      if (want) {
        image = (await readThumbs(dir, [want.key])).get(want.key) ?? null;
        state = image ? 'hit' : 'missing';
      }
      if (!image && render && want) {
        // 포스터 경로는 문서를 쓰지 않는다 — 디스크에 있는 문서 그대로 열쇠를 만들고, 일꾼도 같은 문서를 저장 없이 읽는다.
        const slot = `${p}\u0000${docId}\u0000${want.key}`;
        let run = baking.get(slot);
        if (!run) {
          run = bakePoster(service, p, doc, want).then(async (baked) => {
            // 굽는 사이 문서가 지워졌으면 thumbs 디렉터리를 되살리지 않는다(쓰는 틈에 지워졌어도 곧바로 걷는다).
            if (baked && service.readDoc(p, docId) && await writeThumb(dir, want.key, baked)) {
              if (!service.readDoc(p, docId)) await removeThumbsDir(dir);
              else await pruneThumbs(dir, new Set([want.key, ...chapterThumbWants(doc, timeline).map((w) => w.key)]));
            }
            return baked;
          }).finally(() => { baking.delete(slot); });
          baking.set(slot, run);
        }
        image = await run;
        state = image ? 'baked' : 'failed';
      }
      res.json({ ok: true, state, version: doc.version, image });
    })().catch((err: unknown) => res.status(500).json({ ok: false, error: String(err) }));
  });
}
