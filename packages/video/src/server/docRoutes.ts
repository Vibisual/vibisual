/** §5.13 — 문서 목록·만들기·복사·읽기·판본·패치·삭제. */
import { createHash } from 'node:crypto';
import type { Express } from 'express';
import type { VersionBook } from './versionBook.js';
import { copyVideoTaskDocument } from './taskCopy.js';
import {
  applyPatch, bodyFix, diagnosticFixes, docUnreadableFix, expandPatchOps, isSafeFix, resolveTimeline, simulateOps, versionConflictFix,
  type ExpandedPatch, type VideoDoc, type VideoDocPatch, type VideoDocPatchResult,
} from '../index.js';
import { compositionRefreshOps } from './composition.js';
import type { AppServerHost } from '../host.js';
import { isSafeHistoryId } from '../history.js';
import { rejectAgent, requestAuthor } from './guards.js';
import type { VideoHistoryStore } from './historyStore.js';
import type { ActivityBook } from './historyRoutes.js';
import { readStyleFile } from './styleRoutes.js';
import { removeThumbsDir, thumbsDirFor } from './thumbCache.js';
import { removeSegmentDir, segmentDirFor } from './segmentCache.js';
import type { VideoService } from './videoService.js';
import { isSafeId } from './routeSupport.js';

export interface DocRoutesDeps {
  readonly project: (raw: unknown) => string | null;
  readonly host: () => AppServerHost;
  readonly service: VideoService;
  readonly history: VideoHistoryStore;
  readonly activity: ActivityBook;
  readonly versions: VersionBook;
  readonly ensureVersionRefresher: () => void;
}

/** 처음 요청이 올 때만 불린다(`appHost` 가 늦게 import) — 안 쓰면 이 파일이 로드되지 않아 비용이 0 이다. */
export const DEFAULT_DOC_TITLE = '새 영상';

/** §5.13 (V) 37-10 — 새 문서는 확정된 스타일 카드를 받아 태어난다(이미 손댄 문서는 그대로). */
export function createStyledDoc(service: VideoService, projectPath: string, title: string, requestedId?: string): VideoDoc {
  let doc = service.createDoc(projectPath, title, requestedId);
  const confirmed = readStyleFile(projectPath)?.style;
  if (confirmed && !doc.style && doc.version === 1) {
    doc = service.patchFresh(projectPath, doc.id, (current) => (current.style || current.version !== 1 ? [] : [{ op: 'setDoc', patch: { style: confirmed } }])) ?? doc;
  }
  return doc;
}

/** §5.13 (G) — 실패한 patch 의 본문: 종전 필드 그대로 + `fix`. 묶음 op 가 있으면 `opIndex` 를 요청 순번으로 옮긴다(묶음 하나 = 하나). */
function patchFailureBody(
  result: Extract<VideoDocPatchResult, { ok: false }>,
  doc: VideoDoc,
  baseVersion: unknown,
  plan: ExpandedPatch,
): Record<string, unknown> {
  // `result` 에도 ok:false 가 있으므로 펼친 뒤에 다시 못 박는다(순서가 바뀌면 조용히 덮인다).
  if (result.reason === 'version-conflict') return { ...result, ok: false, fix: versionConflictFix(baseVersion, doc, plan) };
  const opIndex = plan.origin[result.opIndex]?.opIndex ?? result.opIndex;
  return { ...result, opIndex, ok: false, fix: simulateOps(doc, plan).fixes };
}

const PATCH_BODY_ERROR = 'baseVersion 과 ops 가 필요합니다.';

export function mountDocRoutes(app: Express, deps: DocRoutesDeps): void {
  const { project, host, service, history, activity, versions, ensureVersionRefresher } = deps;
  app.get('/docs', (req, res) => {
    const p = project(req.query['project']);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    res.json({ ok: true, docs: service.listDocs(p) });
  });

  app.post('/docs', (req, res) => {
    const body = req.body as { project?: unknown; title?: unknown; id?: unknown };
    const p = project(body.project);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    const title = typeof body.title === 'string' && body.title.trim() !== '' ? body.title.trim() : DEFAULT_DOC_TITLE;
    // (R-3) — 파일에서 파생한 안정 id 로 열 때만 온다. 없으면 종전처럼 서버가 새 id 를 붙인다.
    const requestedId = typeof body.id === 'string' && body.id.trim() !== '' ? body.id.trim() : undefined;
    res.json({ ok: true, doc: createStyledDoc(service, p, title, requestedId) });
  });

  app.get('/doc/:docId/source-status', async (req, res) => {
    const p = project(req.query['project']);
    const doc = p ? service.readDoc(p, req.params.docId) : null;
    if (!p || !doc) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    // Repairs the index of a document saved by an older version — once per document per process, not per call.
    service.sourceSync.ensure(host(), p, doc);
    res.json(await service.sourceSync.status(p, doc.id));
  });

  app.post('/doc/:docId/copy', (req, res) => {
    const p = project(req.body?.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const { title, requestId } = req.body as { title?: unknown; requestId?: unknown };
    if (typeof title !== 'string' || !title.trim() || title.length > 200 || typeof requestId !== 'string'
      || !/^[A-Za-z0-9_.:-]{1,120}$/.test(requestId) || !isSafeId(req.params.docId)) {
      res.status(400).json({ ok: false, error: 'invalid task copy request' }); return;
    }
    const id = `copy-${createHash('sha256').update(`${req.params.docId}\0${requestId}`).digest('hex').slice(0, 40)}`;
    const existing = service.readDoc(p, id);
    if (existing) { res.json({ ok: true, doc: existing }); return; }
    const source = service.readDoc(p, req.params.docId);
    if (!source) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    try {
      const doc = copyVideoTaskDocument(p, source, id, title.trim());
      service.writeDoc(p, doc);
      res.json({ ok: true, doc });
    } catch (error) {
      host().warn(`[video] Task copy failed: ${String(error)}`);
      res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'task-copy-failed' });
    }
  });

  app.get('/doc/:docId', (req, res) => {
    const p = project(req.query['project']);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    const read = service.readDoc(p, req.params.docId);
    if (!read) {
      res.status(404).json({ ok: false, error: 'unknown doc' });
      return;
    }
    // 에이전트가 편집 전에 읽는 그 응답이다 — 지금 상태와 시간 해소 결과를 함께 준다.
    // 컴포지션 코드가 바뀌었으면 소재를 먼저 새로 적는다(그래야 읽은 version 이 곧 쓸 baseVersion 이다).
    // `peek=1` — 배경 일감(문서 갤러리 포스터)을 그리는 일꾼의 읽기: 디스크의 문서 그대로, 탐침·저장·표지 일감 없이.
    const doc = req.query['peek'] === '1' ? read : service.refreshCompositions(p, read);
    const timeline = resolveTimeline(doc);
    res.json({
      ok: true,
      doc,
      duration: timeline.duration,
      diagnostics: timeline.diagnostics,
      fix: diagnosticFixes(doc, timeline.diagnostics),
    });
  });

  /** §5.13 (T-7) — 문서의 판본만. 스튜디오·노드가 몇 초마다 물어 에이전트가 고친 것을 저절로 다시 읽는다(컴포지션 지문이 바뀌어도 판본이 오른다). */
  app.get('/doc/:docId/version', async (req, res) => {
    const p = project(req.query['project']);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    const docId = req.params.docId;
    if (!isSafeId(docId)) {
      res.status(404).json({ ok: false, error: 'unknown doc' });
      return;
    }
    try {
      // §5.13 (Y) 40-7 ② — 기억해 둔 판으로만 답한다(비동기 stat 한 번 — 동기 파일 시스템 ❌). 컴포지션 코드가 바뀌었는지는
      //   지켜보는 문서에 한해 서버가 2초마다 비동기로 재고, 바뀌면 적은 뒤 알린다(`refreshWatchedCompositions`).
      const name = typeof req.query['project'] === 'string' ? req.query['project'] : '';
      const info = await versions.version(p, docId, name);
      if (!info) {
        res.status(404).json({ ok: false, error: 'unknown doc' });
        return;
      }
      ensureVersionRefresher();
      res.json({
        ok: true,
        ...info,
        // §5.13 (V) 37-3 — 지금 하는 일(바퀴·만지는 장면). AI 패널 머리와 구슬 위성이 이것을 보인다.
        activity: activity.get(p, docId),
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: String(error) });
    }
  });

  app.post('/doc/:docId/patch', (req, res) => {
    const body = req.body as { project?: unknown; passId?: unknown; focus?: unknown } & Partial<VideoDocPatch>;
    const p = project(body.project);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    const doc = service.readDoc(p, req.params.docId);
    if (!doc) {
      res.status(404).json({ ok: false, error: 'unknown doc' });
      return;
    }
    if (typeof body.baseVersion !== 'number' || !Array.isArray(body.ops)) {
      res.status(400).json({ ok: false, error: PATCH_BODY_ERROR, fix: bodyFix(body, doc.version) });
      return;
    }
    // §5.13 (G) 묶음 op 를 기존 op 로 푼다. 묶음이 없으면 받은 ops 그대로다(종전 요청은 종전 길).
    const expanded = expandPatchOps(body.ops);
    if (!expanded.ok) {
      res.status(400).json({ ok: false, reason: 'invalid-op', opIndex: expanded.opIndex, message: expanded.message, fix: expanded.fix });
      return;
    }
    const plan = expanded.value;

    const result = applyPatch(doc, { baseVersion: body.baseVersion, ops: plan.ops });
    if (!result.ok) {
      // 409 = "그 사이 바뀌었으니 다시 읽고 오세요". 에이전트가 이 신호로 재시도한다.
      res.status(result.reason === 'version-conflict' ? 409 : 400).json(patchFailureBody(result, doc, body.baseVersion, plan));
      return;
    }

    // 새로 얹은 composition 소재가 아직 탐침되지 않았으면 여기서 채운다(길이·판형·lint) — 에이전트가 탐침을 잊어도
    // `duration:'auto'` 가 풀린다.
    const written = service.refreshCompositions(p, result.doc);
    if (written === result.doc) service.writeDoc(p, result.doc);
    // §5.13 (V) 37-3 — 바퀴의 이름으로 들어온 판본을 적는다. 처음 보는 바퀴면 고치기 직전 상태를 그 바퀴의 시작 판으로 남긴다
    //   (스튜디오를 거치지 않고 맡긴 바퀴도 [이 바퀴 되돌리기]가 된다).
    if (isSafeHistoryId(body.passId)) {
      const passId = body.passId;
      const focus = typeof body.focus === 'string' && body.focus.trim() !== '' ? body.focus.trim().slice(0, 80) : undefined;
      try {
        let startRev = history.findPass(p, doc.id, passId)?.startRev;
        if (!startRev) startRev = history.record(p, doc, { kind: 'pass-start', by: 'user', passId }).id;
        history.notePatch(p, doc.id, passId, written.version, focus, doc.version, startRev);
        activity.touch(p, doc.id, passId, focus, 'open');
      } catch (err) {
        host().warn(`[video] 바퀴 기록을 남기지 못했습니다: ${String(err)}`);
      }
    }
    const timeline = resolveTimeline(written);
    res.json({
      ok: true, doc: written, duration: timeline.duration, diagnostics: timeline.diagnostics, by: requestAuthor(req),
      fix: diagnosticFixes(written, timeline.diagnostics, resolveTimeline(doc).diagnostics),
      ...(plan.bundled ? { expanded: plan.ops } : {}),
    });
  });

  /**
   * §5.13 (G) 미리 검사 — patch 와 같은 본문·상태 코드로 답하되 아무것도 쓰지 않는다(문서·.bak·판 기록·활동·판 기억·일감).
   * 실패 응답은 patch 와 같은 필드 + `check`(적용 단계 409·400 은 `expanded` 도), 성공 응답은 `doc`·`by` 대신 `version` 만 싣는다(문서 전체를 되돌려 주지 않는다).
   * 그래서 `refreshCompositions`·`writeDoc`·`history`·`activity` 를 부르지 않고, 바뀐 컴포지션 탐침은 메모리 위 문서에만 얹는다.
   */
  app.post('/doc/:docId/patch/check', (req, res) => {
    const body = req.body as { project?: unknown } & Partial<VideoDocPatch>;
    const p = project(body.project);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project', check: true });
      return;
    }
    const doc = service.readDoc(p, req.params.docId);
    if (!doc) {
      res.status(404).json({ ok: false, error: 'unknown doc', check: true });
      return;
    }
    if (typeof body.baseVersion !== 'number' || !Array.isArray(body.ops)) {
      res.status(400).json({ ok: false, error: PATCH_BODY_ERROR, check: true, fix: bodyFix(body, doc.version) });
      return;
    }
    const expanded = expandPatchOps(body.ops);
    if (!expanded.ok) {
      res.status(400).json({ ok: false, reason: 'invalid-op', opIndex: expanded.opIndex, message: expanded.message, check: true, fix: expanded.fix });
      return;
    }
    const plan = expanded.value;
    const result = applyPatch(doc, { baseVersion: body.baseVersion, ops: plan.ops });
    if (!result.ok) {
      const status = result.reason === 'version-conflict' ? 409 : 400;
      res.status(status).json({ ...patchFailureBody(result, doc, body.baseVersion, plan), check: true, expanded: plan.ops });
      return;
    }
    let next = result.doc;
    const refresh = compositionRefreshOps(p, next);
    if (refresh.length > 0) {
      const probed = applyPatch(next, { baseVersion: next.version, ops: refresh });
      if (probed.ok) next = probed.doc;
    }
    const timeline = resolveTimeline(next);
    const fix = [
      ...simulateOps(doc, plan).fixes,
      ...docUnreadableFix(next),
      ...diagnosticFixes(next, timeline.diagnostics, resolveTimeline(doc).diagnostics),
    ];
    res.json({
      ok: true, check: true, version: next.version, duration: timeline.duration, diagnostics: timeline.diagnostics,
      expanded: plan.ops, fix, safe: isSafeFix(fix),
    });
  });

  app.delete('/doc/:docId', (req, res) => {
    if (rejectAgent(req, res, 'Only the user deletes a document.')) return;
    const p = project(req.query['project']);
    if (!p) {
      res.status(404).json({ ok: false, error: 'unknown project' });
      return;
    }
    // 대기열에 이 문서의 렌더가 남았으면 문서가 밑에서 사라진다 — 먼저 취소하게 거절한다(옆으로 치우는 삭제라 되돌릴 길은 있지만 일꾼이 그 문서를 못 읽는다).
    if (service.listJobs(p, 'render').some((j) => j.docId === req.params.docId && (j.status === 'queued' || j.status === 'running'))) {
      res.status(409).json({ ok: false, error: 'doc-in-use', reason: 'render' });
      return;
    }
    const ok = service.deleteDoc(p, req.params.docId);
    // §5.13 (X) 39-4 — 대표 프레임은 다시 구울 수 있는 기억이라 문서와 함께 걷는다(문서 본문은 옆으로 치워 되돌릴 길이 남는다).
    if (ok) void removeThumbsDir(thumbsDirFor(p, req.params.docId));
    // §5.13 (E-6) — 렌더 구간 조각도 다시 구우면 나오는 파생물이다.
    if (ok) void removeSegmentDir(segmentDirFor(p, req.params.docId));
    res.json({ ok });
  });
}
