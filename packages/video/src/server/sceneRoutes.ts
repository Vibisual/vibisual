/**
 * §5.13 (V) 37-23 — 장면 단위 받기·되돌리기 REST. 되돌리기는 평소 편집과 같은 연산이라 판본 충돌(409) 규칙을 그대로 지나고,
 * 받기·되돌리기는 사람의 결정이라 루프백 유입(에이전트)은 403 이다. 파일 계획은 아무것도 쓰지 않는다.
 */
import type { Express, Response } from 'express';

import { isSafeHistoryId } from '../history.js';
import { applyPatch } from '../ops.js';
import { expandPatchOps } from '../patchBundles.js';
import { bodyFix, versionConflictFix } from '../patchFix.js';
import { sceneRestoreOps, sceneSignature } from '../sceneChange.js';
import type { VideoDoc } from '../types.js';
import { rejectAgent } from './guards.js';
import type { VideoHistoryStore } from './historyStore.js';
import { inFolders, sceneFilePlan, sceneFolders, type SceneFilePlan } from './sceneRestore.js';
import type { VideoService } from './videoService.js';

export interface SceneRoutesDeps {
  readonly project: (raw: unknown) => string | null;
  readonly service: VideoService;
  readonly history: VideoHistoryStore;
}

/** 장면 id 상한(글자) — 문서가 정한 이름이라 모양은 묻지 않고 길이만 묶는다. */
const CHAPTER_ID_MAX_CHARS = 80;

function chapterIdOf(raw: unknown): string | null {
  return typeof raw === 'string' && raw !== '' && raw.length <= CHAPTER_ID_MAX_CHARS ? raw : null;
}

function hasChapter(doc: VideoDoc, chapterId: string): boolean {
  return (doc.chapters ?? []).some((c) => c.id === chapterId);
}

export function mountSceneRoutes(app: Express, deps: SceneRoutesDeps): void {
  const { project, service, history } = deps;

  /** 지금 문서와 그 판 — 장면이 둘 중 하나에는 있어야 한다. 없으면 404 로 끝내고 null. */
  const open = (p: string | null, docId: string, revId: string, chapterId: string | null, res: Response): { current: VideoDoc; start: VideoDoc } | null => {
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return null; }
    const read = service.readDoc(p, docId);
    const start = history.readSnapshot(p, docId, revId);
    if (!read || !start) { res.status(404).json({ ok: false, error: 'unknown doc or revision' }); return null; }
    if (!chapterId || (!hasChapter(read, chapterId) && !hasChapter(start, chapterId))) {
      res.status(404).json({ ok: false, error: 'unknown chapter' });
      return null;
    }
    return { current: read, start };
  };

  const planOf = (p: string, docId: string, revId: string, current: VideoDoc, start: VideoDoc, chapterId: string): { plan: SceneFilePlan; own: readonly string[] } => {
    const folders = sceneFolders(start, current, chapterId, process.platform);
    const plan = sceneFilePlan(p, history.readManifest(p, docId, revId), folders, (sha) => {
      const blob = history.blobPath(p, docId, sha);
      return blob !== null && history.hasBlob(blob);
    }, process.platform);
    return { plan, own: folders.own };
  };

  app.get('/doc/:docId/history/:revId/scene/:chapterId/files', (req, res) => {
    const p = project(req.query['project']);
    const chapterId = chapterIdOf(req.params.chapterId);
    const both = open(p, req.params.docId, req.params.revId, chapterId, res);
    if (!p || !chapterId || !both) return;
    res.json({ ok: true, plan: planOf(p, req.params.docId, req.params.revId, both.current, both.start, chapterId).plan });
  });

  app.post('/doc/:docId/history/:revId/scene-restore', (req, res) => {
    if (rejectAgent(req, res, 'Only the user restores a scene. Patch the document instead.')) return;
    const body = req.body as { project?: unknown; chapterId?: unknown; baseVersion?: unknown };
    const p = project(body.project);
    const docId = req.params.docId;
    const revId = req.params.revId;
    const chapterId = chapterIdOf(body.chapterId);
    const both = open(p, docId, revId, chapterId, res);
    if (!p || !chapterId || !both) return;
    // 컴포지션 코드가 방금 바뀌었으면 소재 지문부터 새로 적는다 — 그래야 '바뀐 것'을 빠짐없이 되돌린다(판본이 오르면 아래에서 409).
    const current = service.refreshCompositions(p, both.current);
    if (typeof body.baseVersion !== 'number') {
      res.status(400).json({ ok: false, error: 'baseVersion is required', fix: bodyFix({ baseVersion: body.baseVersion, ops: [] }, current.version) });
      return;
    }
    const ops = sceneRestoreOps(current, both.start, chapterId);
    const expanded = expandPatchOps(ops);
    if (body.baseVersion !== current.version) {
      // 409 = "그 사이 바뀌었으니 다시 읽고 오세요" — patch 와 같은 본문. 아무것도 쓰지 않았다.
      res.status(409).json({
        ok: false, reason: 'version-conflict', currentVersion: current.version,
        fix: expanded.ok ? versionConflictFix(body.baseVersion, current, expanded.value) : [],
      });
      return;
    }
    const { plan, own } = planOf(p, docId, revId, current, both.start, chapterId);
    if (ops.length === 0 && plan.changed === 0) {
      res.json({ ok: true, doc: current, unchanged: true, filesRestored: 0, plan });
      return;
    }
    let next = current;
    if (ops.length > 0) {
      const result = applyPatch(current, { baseVersion: current.version, ops });
      if (!result.ok) {
        res.status(400).json({ ok: false, error: 'the scene could not be restored', reason: result.reason, ...(result.reason === 'invalid-op' ? { message: result.message } : {}) });
        return;
      }
      next = result.doc;
    }
    // 마지막 판 뒤에 고친 것이 있으면 되돌리기 직전 상태를 먼저 남긴다 — 되돌림이 사람 손을 지우지 않게(전체 되돌리기와 같은 규칙).
    const entries = history.list(p, docId);
    const last = entries[entries.length - 1];
    if (!last || last.docVersion !== current.version) history.record(p, current, { kind: 'checkpoint', by: 'user', label: 'before-restore' });
    const filesRestored = own.length > 0 ? history.restoreFiles(p, docId, revId, (rel) => inFolders(rel, own, process.platform)) : 0;
    const written = service.refreshCompositions(p, next);
    if (written === next && next !== current) service.writeDoc(p, next);
    const entry = history.record(p, written, { kind: 'restore', by: 'user', restoredFrom: revId, chapterId });
    const owner = history.listPasses(p, docId).find((pass) => pass.startRev === revId);
    const pass = owner
      ? history.decideScene(p, docId, owner.id, chapterId, { how: 'restored', signature: sceneSignature(written, chapterId), at: Date.now() })
      : null;
    res.json({ ok: true, doc: written, entry, filesRestored, plan, ...(pass ? { pass } : {}) });
  });

  app.post('/doc/:docId/pass/:passId/scene', (req, res) => {
    if (rejectAgent(req, res, 'Only the user accepts or reopens a scene.')) return;
    const body = req.body as { project?: unknown; chapterId?: unknown; decision?: unknown; signature?: unknown };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = req.params.docId;
    const passId = req.params.passId;
    const doc = service.readDoc(p, docId);
    if (!doc) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const chapterId = chapterIdOf(body.chapterId);
    if (!isSafeHistoryId(passId) || !chapterId) { res.status(400).json({ ok: false, error: 'passId and chapterId are required' }); return; }
    if (body.decision !== 'keep' && body.decision !== 'reopen') { res.status(400).json({ ok: false, error: "decision must be 'keep' or 'reopen'" }); return; }
    if (body.decision === 'keep') {
      // 사람이 본 그 내용만 받는다 — 그 사이 장면이 또 바뀌었으면 받지 않고 알린다.
      const signature = sceneSignature(doc, chapterId);
      if (body.signature !== signature) { res.status(409).json({ ok: false, error: 'scene-changed', reason: 'version-conflict' }); return; }
      const pass = history.decideScene(p, docId, passId, chapterId, { how: 'kept', signature, at: Date.now() });
      if (!pass) { res.status(404).json({ ok: false, error: 'unknown pass' }); return; }
      res.json({ ok: true, pass });
      return;
    }
    const pass = history.decideScene(p, docId, passId, chapterId, null);
    if (!pass) { res.status(404).json({ ok: false, error: 'unknown pass' }); return; }
    res.json({ ok: true, pass });
  });
}
