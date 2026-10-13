/**
 * §5.13 (V) 37-3 — 판 기록·바퀴 보고 REST(앱 라우트 — `/api/app/vibistudio/…`).
 *
 * - `GET  /doc/:docId/history` · `GET /doc/:docId/history/:revId` — 목록·그 판의 문서
 * - `POST /doc/:docId/history { kind:'checkpoint'|'pass-start', passId?, request?, label?, mode?, chapterId? }`
 * - `POST /doc/:docId/history/:revId/restore` — 그 판으로 돌아가기(사람만 — 되돌림도 새 판)
 * - `DELETE /doc/:docId/history/:revId` — 사람만(자동 삭제는 없다 — (K))
 * - `GET  /doc/:docId/history/:revId/still?t=` — 그 판의 문서·코드로 찍은 정지 화면
 * - `GET  /doc/:docId/passes` · `POST /doc/:docId/pass { passId, summary, suggestions[], warnings[], notesFixed[] }`
 */
import type { Express } from 'express';
import { pathKey } from '@vibisual/shared';

import {
  PASS_LIST_ITEM_MAX_CHARS,
  PASS_LIST_MAX_ITEMS,
  PASS_SUMMARY_MAX_CHARS,
  STILL_MAX_EDGE,
} from '../constants.js';
import { isSafeHistoryId, restoreOps, type DocActivity, type PassReport } from '../history.js';
import { applyPatch } from '../ops.js';
import { resolveTimeline } from '../resolveTimeline.js';
import type { VideoDoc } from '../types.js';
import { rejectAgent, requestAuthor } from './guards.js';
import type { VideoHistoryStore } from './historyStore.js';

/** 스틸 일감의 결과(일꾼이 돌려준 것). */
export interface StillJobResult {
  readonly status: string;
  readonly result?: string;
  readonly error?: string;
  readonly t?: number;
}

export interface HistoryRouteDeps {
  project(raw: unknown): string | null;
  readDoc(projectPath: string, docId: string): VideoDoc | null;
  writeDoc(projectPath: string, doc: VideoDoc): void;
  requestStill(projectPath: string, docId: string, t: number, opts: { maxEdge?: number; revId?: string }): Promise<StillJobResult>;
  readonly history: VideoHistoryStore;
  readonly activity: ActivityBook;
  /** §5.13 (V) 37-7 — 바퀴 보고의 `notesFixed` 를 메모에 반영한다(메모 저장소가 붙인다). */
  onNotesFixed?(projectPath: string, docId: string, noteIds: readonly string[], passId: string): void;
}

/** 지금 하는 일 — 문서마다 마지막 바퀴의 상태(메모리, 프로젝트로 가른다 — §3.5). */
export class ActivityBook {
  private readonly map = new Map<string, DocActivity>();
  private key(projectPath: string, docId: string): string {
    return `${pathKey(projectPath, process.platform)}::${docId}`;
  }
  get(projectPath: string, docId: string): DocActivity | null {
    return this.map.get(this.key(projectPath, docId)) ?? null;
  }
  touch(projectPath: string, docId: string, passId: string, focus: string | undefined, status: 'open' | 'done'): void {
    const prev = this.map.get(this.key(projectPath, docId));
    const keepFocus = prev?.passId === passId ? prev.focus : undefined;
    const nextFocus = focus ?? keepFocus;
    this.map.set(this.key(projectPath, docId), { passId, at: Date.now(), status, ...(nextFocus ? { focus: nextFocus } : {}) });
  }
}

function text(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

function list(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .slice(0, PASS_LIST_MAX_ITEMS)
    .map((x) => x.trim().slice(0, PASS_LIST_ITEM_MAX_CHARS));
}

/** 판 정지 화면의 기본 시각 — 길이의 35%(첫 프레임은 등장 전인 일이 흔하다 — 노드 포스터와 같은 규칙). */
function posterTime(doc: VideoDoc): number {
  const duration = resolveTimeline(doc).duration;
  if (!(duration > 0)) return 0;
  return Math.max(0, Math.min(duration * 0.35, duration - 1 / Math.max(1, doc.fps)));
}

export function mountHistoryRoutes(app: Express, deps: HistoryRouteDeps): void {
  const { history } = deps;

  app.get('/doc/:docId/history', (req, res) => {
    const p = deps.project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = req.params.docId;
    if (!deps.readDoc(p, docId)) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    res.json({ ok: true, entries: history.list(p, docId), passes: history.listPasses(p, docId).slice(-50) });
  });

  app.get('/doc/:docId/history/:revId', (req, res) => {
    const p = deps.project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const doc = history.readSnapshot(p, req.params.docId, req.params.revId);
    if (!doc) { res.status(404).json({ ok: false, error: 'unknown revision' }); return; }
    res.json({ ok: true, doc, manifest: history.readManifest(p, req.params.docId, req.params.revId) });
  });

  app.post('/doc/:docId/history', (req, res) => {
    const body = req.body as { project?: unknown; kind?: unknown; passId?: unknown; request?: unknown; label?: unknown; mode?: unknown; chapterId?: unknown };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = req.params.docId;
    const doc = deps.readDoc(p, docId);
    if (!doc) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const by = requestAuthor(req);
    if (body.kind === 'pass-start') {
      if (!isSafeHistoryId(body.passId)) { res.status(400).json({ ok: false, error: 'passId must match [A-Za-z0-9_-]{1,80}' }); return; }
      const passId = body.passId;
      const existing = history.findPass(p, docId, passId);
      if (existing?.startRev) { res.json({ ok: true, pass: existing }); return; }
      const request = text(body.request, PASS_SUMMARY_MAX_CHARS);
      const entry = history.record(p, doc, { kind: 'pass-start', by, passId, ...(request ? { request } : {}) });
      const mode = text(body.mode, 40);
      const chapterId = text(body.chapterId, 80);
      const pass = history.upsertPass(p, docId, passId, (prev) => ({
        ...(prev ?? { id: passId, startedAt: Date.now(), status: 'open' as const, versions: [] }),
        startRev: entry.id,
        startVersion: doc.version,
        ...(request ? { request } : {}),
        ...(mode ? { mode } : {}),
        ...(chapterId ? { chapterId } : {}),
      }));
      deps.activity.touch(p, docId, passId, chapterId || undefined, 'open');
      res.json({ ok: true, entry, pass });
      return;
    }
    if (body.kind !== 'checkpoint') { res.status(400).json({ ok: false, error: "kind must be 'checkpoint' or 'pass-start'" }); return; }
    const label = text(body.label, 120);
    const entry = history.record(p, doc, { kind: 'checkpoint', by, ...(label ? { label } : {}) });
    res.json({ ok: true, entry });
  });

  app.post('/doc/:docId/history/:revId/restore', (req, res) => {
    if (rejectAgent(req, res, 'Only the user restores a revision. Patch the document instead.')) return;
    const body = req.body as { project?: unknown };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = req.params.docId;
    const revId = req.params.revId;
    const current = deps.readDoc(p, docId);
    const snapshot = history.readSnapshot(p, docId, revId);
    if (!current || !snapshot) { res.status(404).json({ ok: false, error: 'unknown doc or revision' }); return; }
    // 마지막 판 뒤에 고친 것이 있으면 되돌리기 직전 상태를 먼저 남긴다 — 되돌림이 사람 손을 지우지 않게.
    const entries = history.list(p, docId);
    const last = entries[entries.length - 1];
    if (!last || last.docVersion !== current.version) history.record(p, current, { kind: 'checkpoint', by: 'user', label: 'before-restore' });
    const result = applyPatch(current, { baseVersion: current.version, ops: restoreOps(current, snapshot) });
    if (!result.ok) { res.status(409).json({ ok: false, error: 'the document could not be restored', reason: result.reason }); return; }
    const files = history.restoreFiles(p, docId, revId);
    deps.writeDoc(p, result.doc);
    const entry = history.record(p, result.doc, { kind: 'restore', by: 'user', restoredFrom: revId });
    res.json({ ok: true, doc: result.doc, entry, filesRestored: files });
  });

  app.delete('/doc/:docId/history/:revId', (req, res) => {
    if (rejectAgent(req, res, 'Only the user deletes revisions.')) return;
    const p = deps.project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    res.json({ ok: history.remove(p, req.params.docId, req.params.revId) });
  });

  app.get('/doc/:docId/history/:revId/still', (req, res) => {
    const p = deps.project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = req.params.docId;
    const revId = req.params.revId;
    const snapshot = history.readSnapshot(p, docId, revId);
    if (!snapshot) { res.status(404).json({ ok: false, error: 'unknown revision' }); return; }
    const raw = typeof req.query['t'] === 'string' && req.query['t'] !== '' ? Number(req.query['t']) : Number.NaN;
    const poster = !Number.isFinite(raw);
    const t = poster ? posterTime(snapshot) : Math.max(0, raw);
    deps.requestStill(p, docId, t, { maxEdge: STILL_MAX_EDGE, revId })
      .then((job) => {
        if (job.status !== 'done' || typeof job.result !== 'string') {
          res.status(504).json({ ok: false, error: job.error ?? 'no still' });
          return;
        }
        if (poster) {
          history.saveStill(p, docId, revId, job.result);
          history.update(p, docId, revId, { hasStill: true });
        }
        res.json({ ok: true, t, image: job.result });
      })
      .catch((err: unknown) => res.status(500).json({ ok: false, error: String(err) }));
  });

  app.get('/doc/:docId/passes', (req, res) => {
    const p = deps.project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    res.json({ ok: true, passes: history.listPasses(p, req.params.docId).slice(-50), activity: deps.activity.get(p, req.params.docId) });
  });

  app.post('/doc/:docId/pass', (req, res) => {
    const body = req.body as { project?: unknown; passId?: unknown; summary?: unknown; suggestions?: unknown; warnings?: unknown; notesFixed?: unknown };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = req.params.docId;
    const doc = deps.readDoc(p, docId);
    if (!doc) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    if (!isSafeHistoryId(body.passId)) { res.status(400).json({ ok: false, error: 'passId (from the request context) is required' }); return; }
    const passId = body.passId;
    const report: PassReport = {
      summary: text(body.summary, PASS_SUMMARY_MAX_CHARS),
      suggestions: list(body.suggestions),
      warnings: list(body.warnings),
      notesFixed: list(body.notesFixed),
      reportedAt: Date.now(),
    };
    const entry = history.record(p, doc, { kind: 'pass-end', by: requestAuthor(req), passId, ...(report.summary ? { summary: report.summary } : {}) });
    const pass = history.closePass(p, docId, passId, report, entry.id, doc.version);
    if (report.notesFixed.length > 0) deps.onNotesFixed?.(p, docId, report.notesFixed, passId);
    deps.activity.touch(p, docId, passId, undefined, 'done');
    res.json({ ok: true, entry, pass });
  });
}
