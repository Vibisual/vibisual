/** §5.13 — 문서를 고치는 데 쓰는 도구 길: 대본·자막 가져오기·표지 모으기·소재 사실·판형 파생. */
import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import { resolveInsideProject } from './composition.js';
import { CAPTION_IMPORT_MAX_BYTES, captionFormatOf, captionImportOps, parseCaptionText, buildCutOps, buildTranscript, deriveFormatDoc, derivedDocId, resolveTimeline, sentenceCutRanges, type VideoAsset, type VideoFormatId } from '../index.js';
import type { VideoService } from './videoService.js';

export interface DocToolsRoutesDeps {
  readonly project: (raw: unknown) => string | null;
  readonly service: VideoService;
}

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

export function mountDocToolsRoutes(app: Express, deps: DocToolsRoutesDeps): void {
  const { project, service } = deps;
  /**
   * §5.13 (V) 37-13 — 대본: 자막 큐를 문장 목록으로(문서 시각 · 그 문장 동안 나오는 영상·소리 아이템). 실사를 편집할 때 에이전트는
   * 프레임보다 이것을 먼저 읽는다.
   */
  app.get('/doc/:docId/transcript', (req, res) => {
    const p = project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const read = service.readDoc(p, req.params.docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const doc = service.refreshCompositions(p, read);
    const timeline = resolveTimeline(doc);
    res.json({ ok: true, version: doc.version, duration: timeline.duration, sentences: buildTranscript(doc, timeline) });
  });

  /** §5.13 (V) 37-13 — 계산만 한다(쓰지 않는다). 경계는 문장 경계 — 에이전트는 받은 `ops` 를 `baseVersion` 과 함께 `/patch` 로 보낸다(쓰는 문은 하나). */
  app.post('/doc/:docId/transcript/cut', (req, res) => {
    const body = req.body as { project?: unknown; sentenceIds?: unknown };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const read = service.readDoc(p, req.params.docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    if (!Array.isArray(body.sentenceIds) || body.sentenceIds.length === 0) {
      res.status(400).json({ ok: false, error: 'sentenceIds required (ids from GET /transcript)' });
      return;
    }
    const doc = service.refreshCompositions(p, read);
    const timeline = resolveTimeline(doc);
    const sentences = buildTranscript(doc, timeline);
    const wanted = new Set(body.sentenceIds.filter((id): id is string => typeof id === 'string'));
    const unknown = [...wanted].filter((id) => !sentences.some((s) => s.id === id));
    if (unknown.length > 0) { res.status(400).json({ ok: false, error: `unknown sentence ids: ${unknown.slice(0, 5).join(', ')}` }); return; }
    const plan = buildCutOps(doc, timeline, sentenceCutRanges(sentences, wanted));
    res.json({ ok: true, baseVersion: doc.version, ...plan });
  });

  /** §5.13 (W) 38-6 — 자막 파일(SRT·VTT·낱말 시각 JSON)을 얹는 연산을 계산만 한다. 앱은 음성 모델을 품지 않는다((H)) — 받아쓰기는 바깥 도구가 만든 파일을 들인다. */
  app.post('/doc/:docId/captions/import', (req, res) => {
    const body = req.body as { project?: unknown; path?: unknown; label?: unknown };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const read = service.readDoc(p, req.params.docId);
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
    const doc = service.refreshCompositions(p, read);
    const label = typeof body.label === 'string' && body.label.trim() !== '' ? body.label.trim().slice(0, 120) : path.basename(rel);
    const ops = captionImportOps(doc, parsed.cues, label);
    if (ops.length === 0) { res.status(400).json({ ok: false, error: 'no usable caption cues in the file' }); return; }
    res.json({ ok: true, baseVersion: doc.version, ops, cues: parsed.cues.length, words: parsed.words });
  });

  /** §5.13 (T-8) — 표지를 지금 모은다(끝날 때까지 기다린다). `assetId` 면 그 컴포지션만(낡지 않았어도), 없으면 낡은 것 전부. 평소에는 판본을 물을 때 저절로 걸린다. */
  app.post('/doc/:docId/cues', (req, res) => {
    const body = req.body as { project?: unknown; assetId?: unknown; all?: unknown };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const read = service.readDoc(p, req.params.docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const doc = service.refreshCompositions(p, read);
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
    service
      .collectCuesNow(p, doc, assetId, all)
      .then((results) => res.json({ ok: results.every((r) => r.ok), results }))
      .catch((err: unknown) => res.status(500).json({ ok: false, error: String(err) }));
  });

  /**
   * §5.13 (V) 37-12 — 화면이 잰 소재 사실(음악 비트)을 판본 없이 최신 문서의 그 칸에만 합친다 — 사람의 편집과 부딪히지 않고 되돌리기 이력에도
   * 들지 않는다(길이 실측과 같은 성격). 허용 칸만 받는다.
   */
  app.post('/doc/:docId/asset-facts', (req, res) => {
    const body = req.body as { project?: unknown; assetId?: unknown; facts?: unknown };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const assetId = typeof body.assetId === 'string' ? body.assetId : '';
    const facts = sanitizeBeatFacts(body.facts);
    if (assetId === '' || !facts) { res.status(400).json({ ok: false, error: 'assetId and beat facts required' }); return; }
    let found = false;
    const updated = service.patchFresh(p, req.params.docId, (doc) => {
      const asset = doc.assets[assetId];
      if (!asset || (asset.kind !== 'audio' && asset.kind !== 'video')) return [];
      found = true;
      return [{ op: 'setAsset', asset: { ...asset, ...facts } }];
    });
    if (!updated) { res.status(409).json({ ok: false, error: 'the document kept changing' }); return; }
    if (!found) { res.status(404).json({ ok: false, error: 'unknown audio asset' }); return; }
    res.json({ ok: true, doc: updated });
  });

  /** §5.13 (V) 37-15 — 판형 파생 `<docId>-<판형>`(이미 있으면 그것 — 사람이 고친 자리를 덮지 않는다). 옮기는 규칙은 `deriveFormatDoc`. */
  app.post('/doc/:docId/derive', (req, res) => {
    const body = req.body as { project?: unknown; format?: unknown };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const format = body.format;
    if (format !== 'landscape' && format !== 'portrait' && format !== 'square') {
      res.status(400).json({ ok: false, error: "format must be 'landscape', 'portrait' or 'square'" });
      return;
    }
    const read = service.readDoc(p, req.params.docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const source = service.refreshCompositions(p, read);
    const targetId = derivedDocId(source.derivedFrom?.docId ?? source.id, format as VideoFormatId);
    if (targetId === source.id) { res.json({ ok: true, doc: source, created: false }); return; }
    const existing = service.readDoc(p, targetId);
    if (existing) { res.json({ ok: true, doc: existing, created: false }); return; }
    // 파생의 파생이면 원본에서 다시 만든다(크기 왕복으로 자리가 닳지 않게).
    const origin = source.derivedFrom ? service.readDoc(p, source.derivedFrom.docId) ?? source : source;
    const doc = deriveFormatDoc(origin, format as VideoFormatId, Date.now());
    try {
      service.writeDoc(p, doc);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
      return;
    }
    res.json({ ok: true, doc, created: true });
  });
}
