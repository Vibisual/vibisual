/**
 * §5.13 (G) 스스로 판정할 재료 셋 — 전후 비교(그림)·배치 요약(글)·검수 점수(숫자). 그림은 스틸과 같은 일꾼 일감으로 찍고(38-1 같은 길),
 * 글·숫자는 순수 함수다. 그리는 쪽이 없으면 스틸과 같은 규칙(일감이 이유와 함께 닫힘 → 504, 그림 없이 낼 몫은 200 + 빠진 이유).
 */
import type { Express, Response } from 'express';
import {
  DIFF_LINE_LIMIT,
  REVIEW_MAX_SAMPLES,
  REVIEW_SCORE_FINDINGS_MAX,
  REVIEW_SCORE_FORMULA,
  REVIEW_SCORE_RESOLVED_MAX,
  REVIEW_SCORE_TREND_MAX,
  REVIEW_SCORE_WEIGHTS,
  STILL_MAX_EDGE,
  STILL_TIMEOUT_MS,
  compareFindings,
  compositionsAt,
  diffDoc,
  isSafeHistoryId,
  resolveTimeline,
  reviewMotion,
  reviewSampleTimes,
  scoreFindings,
  summarizeDiff,
  summarizeLayout,
  type FrameProbe,
  type HistoryEntry,
  type MotionFinding,
  type VideoDoc,
} from '../index.js';
import type { AppServerHost } from '../host.js';
import { posterTime } from './historyRoutes.js';
import type { VideoHistoryStore } from './historyStore.js';
import { saveReviewImage } from './previewRoutes.js';
import { numQuery, secondsTag } from './routeSupport.js';
import type { VideoJob, VideoService } from './videoService.js';

export interface SelfCheckRoutesDeps {
  readonly project: (raw: unknown) => string | null;
  readonly host: () => AppServerHost;
  readonly service: VideoService;
  readonly history: VideoHistoryStore;
}

/** 비교 대상 한 쪽 — 판 기록의 한 판이거나 지금 문서(`rev: null`). */
interface Side {
  readonly rev: string | null;
  readonly doc: VideoDoc;
  readonly entry?: HistoryEntry;
}

/**
 * `target` 보다 앞에 적힌 판 중 판본이 다른 가장 최근 판 — 바퀴 중이면 대개 그 바퀴의 `pass-start`("이 바퀴 시작 전").
 * `target.rev` 가 없으면(지금 문서) 목록 전체에서 찾는다. 목록에 없는 판이면 위치를 모르므로 null(호출 쪽이 `positionKnown` 으로 구분한다).
 */
export function earlierRevision(entries: readonly HistoryEntry[], target: { readonly rev: string | null; readonly version: number }): HistoryEntry | null {
  const at = target.rev === null ? entries.length : entries.findIndex((e) => e.id === target.rev);
  for (let i = at - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (e && e.docVersion !== target.version) return e;
  }
  return null;
}

/** 지금 문서이거나 판 기록 목록에 있는 판인가 — 아니면 "앞 판"을 추측할 수 없다. */
export function positionKnown(entries: readonly HistoryEntry[], rev: string | null): boolean {
  return rev === null || entries.some((e) => e.id === rev);
}

const UNKNOWN_POSITION = {
  ok: false,
  error: 'revision-not-in-history',
  hint: 'This revision has a snapshot but is not in the revision list, so its previous revision cannot be chosen by default. Pass from=<revId> (compare) or base=<revId>|none (score).',
} as const;

type RefQuery = { readonly ok: true; readonly ref: string | null | undefined } | { readonly ok: false };

/** `current` = 지금 문서(null), 판 id, 없음(undefined). 모양이 틀리면 거절. */
function refQuery(raw: unknown): RefQuery {
  if (raw === undefined || raw === '') return { ok: true, ref: undefined };
  if (raw === 'current') return { ok: true, ref: null };
  return isSafeHistoryId(raw) ? { ok: true, ref: raw } : { ok: false };
}

function sideInfo(side: Side): { rev: string | null; version: number; kind?: string } {
  return { rev: side.rev, version: side.doc.version, ...(side.entry ? { kind: side.entry.kind } : {}) };
}

function sideLabel(side: Side): string {
  return side.rev === null ? `current v${side.doc.version}` : `${side.rev} v${side.doc.version}${side.entry ? ` (${side.entry.kind})` : ''}`;
}

function parseProbes(job: VideoJob): FrameProbe[] | null {
  if (job.status !== 'done' || typeof job.result !== 'string') return null;
  try {
    const parsed = JSON.parse(job.result) as unknown;
    return Array.isArray(parsed) ? (parsed as FrameProbe[]).filter((x) => x && typeof x.t === 'number' && Array.isArray(x.texts)) : null;
  } catch {
    return null;
  }
}

function clampTime(doc: VideoDoc, t: number): number {
  const duration = resolveTimeline(doc).duration;
  const last = Math.max(0, duration - 1 / Math.max(1, doc.fps));
  return Math.max(0, Math.min(Number.isFinite(t) ? t : 0, last));
}

export function mountSelfCheckRoutes(app: Express, deps: SelfCheckRoutesDeps): void {
  const { project, host, service, history } = deps;

  /** 지금 문서(컴포지션 지문이 바뀌었으면 다시 탐침한 판)와 판 id 를 한 쪽으로. 없는 판이면 null. */
  const sideOf = (p: string, docId: string, current: VideoDoc, entries: readonly HistoryEntry[], ref: string | null): Side | null => {
    if (ref === null) return { rev: null, doc: current };
    const doc = history.readSnapshot(p, docId, ref);
    if (!doc) return null;
    const entry = entries.find((e) => e.id === ref);
    return { rev: ref, doc, ...(entry ? { entry } : {}) };
  };

  const openDoc = (p: string | null, docId: string, res: Response): VideoDoc | null => {
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return null; }
    const read = service.readDoc(p, docId);
    if (!read) { res.status(404).json({ ok: false, error: 'unknown doc' }); return null; }
    return service.refreshCompositions(p, read);
  };

  /**
   * 전후 비교 — 두 판의 같은 시각을 한 장에(왼쪽 = 전, 오른쪽 = 후). 스틸 일감 둘(스틸·판 스틸과 같은 일감)을 차례로 걸고
   * 일꾼이 두 장을 붙인다. 기본 `to=current`, `from` = 그보다 앞의 판본이 다른 가장 최근 판.
   */
  app.get('/doc/:docId/compare', async (req, res) => {
    const p = project(req.query['project']);
    const docId = req.params.docId;
    const current = openDoc(p, docId, res);
    if (!p || !current) return;
    const entries = history.list(p, docId);
    const toQ = refQuery(req.query['to']);
    const fromQ = refQuery(req.query['from']);
    if (!toQ.ok || !fromQ.ok) { res.status(400).json({ ok: false, error: "from/to must be a revision id or 'current'" }); return; }
    const to = sideOf(p, docId, current, entries, toQ.ref ?? null);
    if (!to) { res.status(404).json({ ok: false, error: `unknown revision '${String(toQ.ref)}'` }); return; }
    let fromRef = fromQ.ref;
    if (fromRef === undefined) {
      if (!positionKnown(entries, to.rev)) { res.status(400).json(UNKNOWN_POSITION); return; }
      const earlier = earlierRevision(entries, { rev: to.rev, version: to.doc.version });
      if (!earlier) {
        res.status(400).json({ ok: false, error: 'no-earlier-revision', hint: 'No earlier revision with a different version. POST /doc/:docId/history {kind:"checkpoint"} before editing, or pass from=<revId>.' });
        return;
      }
      fromRef = earlier.id;
    }
    const from = sideOf(p, docId, current, entries, fromRef);
    if (!from) { res.status(404).json({ ok: false, error: `unknown revision '${String(fromRef)}'` }); return; }
    if (from.rev === to.rev) { res.status(400).json({ ok: false, error: 'from and to are the same revision' }); return; }
    // 두 판 길이가 다를 수 있다 — 짧은 쪽 끝 안으로 맞춰야 양쪽 다 그 시각이 있다.
    const asked = numQuery(req.query['t'], posterTime(to.doc));
    const t = Math.min(clampTime(from.doc, asked), clampTime(to.doc, asked));
    const full = req.query['full'] === '1';
    const wantData = req.query['format'] === 'dataurl';
    const maxEdge = full ? 0 : STILL_MAX_EDGE;
    try {
      const shots: string[] = [];
      for (const [name, side] of [['before', from], ['after', to]] as const) {
        const job = await service.requestStill(p, docId, t, { maxEdge, ...(side.rev ? { revId: side.rev } : {}) });
        if (job.status !== 'done' || typeof job.result !== 'string') {
          res.status(504).json({ ok: false, side: name, error: job.error ?? '스틸을 얻지 못했습니다.' });
          return;
        }
        shots.push(job.result);
      }
      const at = `t=${t.toFixed(2)}s`;
      const joined = await service.requestCompare(p, docId, [shots[0]!, shots[1]!], [`BEFORE · ${sideLabel(from)} · ${at}`, `AFTER · ${sideLabel(to)} · ${at}`]);
      if (joined.status !== 'done' || typeof joined.result !== 'string') {
        res.status(504).json({ ok: false, side: 'compose', error: joined.error ?? '전후 비교 그림을 얻지 못했습니다.' });
        return;
      }
      const tag = (side: Side): string => side.rev ?? 'current';
      const file = wantData ? null : saveReviewImage(host, p, docId, `compare-${tag(from)}-${tag(to)}-${secondsTag(t)}s${full ? '-full' : ''}.png`, joined.result);
      const changes = summarizeDiff(diffDoc(from.doc, to.doc), from.doc, to.doc);
      res.json({
        ok: true,
        t,
        layout: 'left=before right=after',
        before: sideInfo(from),
        after: sideInfo(to),
        ...(file ? { file } : {}),
        ...(wantData || !file ? { image: joined.result } : {}),
        changes: changes.slice(0, DIFF_LINE_LIMIT),
        changesTotal: changes.length,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  /**
   * 배치 요약 — 그 시각 화면 요소의 이름·상자·글자를 글로. 문서 아이템은 순수 함수로, 컴포지션 안쪽은 검수 일감(표본 한 장)의
   * 무대 `inspect` 로. 일꾼 몫이 빠지면 문서 몫만 200 + `innerError`(`/review?frames=1` 과 같은 규칙).
   */
  app.get('/doc/:docId/layout', async (req, res) => {
    const p = project(req.query['project']);
    const docId = req.params.docId;
    const current = openDoc(p, docId, res);
    if (!p || !current) return;
    const revQ = refQuery(req.query['rev']);
    if (!revQ.ok) { res.status(400).json({ ok: false, error: "rev must be a revision id or 'current'" }); return; }
    const rev = revQ.ref ?? null;
    const side = sideOf(p, docId, current, [], rev);
    if (!side) { res.status(404).json({ ok: false, error: `unknown revision '${String(rev)}'` }); return; }
    const doc = side.doc;
    const timeline = resolveTimeline(doc);
    const t = clampTime(doc, numQuery(req.query['t'], posterTime(doc)));
    const itemId = typeof req.query['item'] === 'string' && req.query['item'] !== '' ? req.query['item'] : undefined;
    const askInner = req.query['inner'] !== '0' && compositionsAt(doc, timeline, t);
    let probeTexts: FrameProbe['texts'] = [];
    let innerError: string | undefined;
    try {
      if (askInner) {
        const job = await service.requestReview(p, docId, [t], { ...(rev ? { revId: rev } : {}), timeoutMs: STILL_TIMEOUT_MS });
        const probes = parseProbes(job);
        if (probes) probeTexts = probes[0]?.texts ?? [];
        else innerError = job.error ?? 'the worker did not return the composition elements';
      }
      const summary = summarizeLayout({ doc, timeline, t, probeTexts, ...(itemId ? { itemId } : {}) });
      const asJson = req.query['format'] === 'json';
      res.json({
        ok: true,
        t: summary.t,
        version: doc.version,
        rev,
        size: summary.size,
        safeArea: summary.safeArea,
        total: summary.total,
        listed: summary.listed,
        flags: summary.flags,
        inner: askInner && innerError === undefined,
        ...(innerError ? { innerError } : {}),
        ...(asJson ? { elements: summary.elements } : { text: summary.text }),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  /**
   * 검수 점수 — 대상 판(기본 지금)과 기준 판(기본 그 앞의 판본이 다른 가장 최근 판)을 같은 코드로 그 자리에서 매긴다(저장하지 않는다 —
   * 판 문서는 바뀌지 않으므로 같은 판이면 같은 숫자). `frames=1` 은 두 쪽 모두 표본이 와야 쓴다(한쪽만이면 불공정).
   */
  app.get('/doc/:docId/review/score', async (req, res) => {
    const p = project(req.query['project']);
    const docId = req.params.docId;
    const current = openDoc(p, docId, res);
    if (!p || !current) return;
    const entries = history.list(p, docId);
    const targetQ = refQuery(req.query['rev']);
    const baseQ = req.query['base'] === 'none' ? ({ ok: true, ref: undefined } as const) : refQuery(req.query['base']);
    if (!targetQ.ok || !baseQ.ok) { res.status(400).json({ ok: false, error: "rev/base must be a revision id, 'current' (or base=none)" }); return; }
    const target = sideOf(p, docId, current, entries, targetQ.ref ?? null);
    if (!target) { res.status(404).json({ ok: false, error: `unknown revision '${String(targetQ.ref)}'` }); return; }
    let base: Side | null = null;
    if (req.query['base'] !== 'none') {
      if (baseQ.ref === undefined && !positionKnown(entries, target.rev)) { res.status(400).json(UNKNOWN_POSITION); return; }
      const ref = baseQ.ref !== undefined ? baseQ.ref : earlierRevision(entries, { rev: target.rev, version: target.doc.version })?.id;
      if (ref !== undefined) {
        base = sideOf(p, docId, current, entries, ref);
        if (!base) { res.status(404).json({ ok: false, error: `unknown revision '${String(ref)}'` }); return; }
      }
    }
    try {
      let framesError: string | undefined;
      const probes = new Map<Side, FrameProbe[]>();
      if (req.query['frames'] === '1') {
        for (const side of base ? [target, base] : [target]) {
          const times = reviewSampleTimes(resolveTimeline(side.doc), REVIEW_MAX_SAMPLES);
          if (times.length === 0) { probes.set(side, []); continue; }
          const job = await service.requestReview(p, docId, times, side.rev ? { revId: side.rev } : {});
          const got = parseProbes(job);
          if (!got) { framesError = job.error ?? 'the worker did not return frames'; break; }
          probes.set(side, got);
        }
      }
      const frames = req.query['frames'] === '1' && framesError === undefined;
      const findingsOf = (side: Side): MotionFinding[] => reviewMotion(side.doc, resolveTimeline(side.doc), frames ? probes.get(side) ?? [] : []);
      const targetFindings = findingsOf(target);
      const baseFindings = base ? findingsOf(base) : null;
      const comparison = baseFindings ? compareFindings(targetFindings, baseFindings) : null;
      const listed = comparison ? comparison.findings : targetFindings;
      const trendN = Math.min(REVIEW_SCORE_TREND_MAX, Math.max(0, Math.floor(numQuery(req.query['trend'], 0))));
      // 추세는 문서 검사만 — 판 수만큼 일꾼을 돌리지 않고, 같은 판이면 같은 숫자.
      const docScore = (doc: VideoDoc) => scoreFindings(reviewMotion(doc, resolveTimeline(doc)));
      let trend: unknown[] | undefined;
      if (trendN > 0) {
        trend = entries.slice(-trendN).flatMap((e) => {
          const doc = history.readSnapshot(p, docId, e.id);
          if (!doc) return [];
          const s = docScore(doc);
          return [{ rev: e.id, kind: e.kind, by: e.by, version: e.docVersion, createdAt: e.createdAt, score: s.score, penalty: s.penalty }];
        });
        const now = docScore(current);
        trend.push({ rev: null, version: current.version, score: now.score, penalty: now.penalty });
      }
      res.json({
        ok: true,
        frames,
        ...(framesError ? { framesError } : {}),
        formula: REVIEW_SCORE_FORMULA,
        weights: REVIEW_SCORE_WEIGHTS,
        target: { ...sideInfo(target), ...scoreFindings(targetFindings) },
        base: base && baseFindings ? { ...sideInfo(base), ...scoreFindings(baseFindings) } : null,
        delta: comparison?.delta ?? null,
        findings: listed.slice(0, REVIEW_SCORE_FINDINGS_MAX),
        findingsTotal: listed.length,
        ...(comparison ? { resolved: comparison.resolved.slice(0, REVIEW_SCORE_RESOLVED_MAX), resolvedTotal: comparison.resolved.length } : {}),
        ...(trend ? { trend, trendNote: 'document checks only (no frames)' } : {}),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });
}
