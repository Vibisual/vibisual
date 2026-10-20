/**
 * §5.13 (AA) 42 — 내보내기 설정·내 프리셋·렌더 대기열 조작 REST(앱 라우트 — `/api/app/vibistudio/…`).
 *
 * - `GET    /export-settings?project=` — 마지막 설정 + 내 프리셋(없으면 기본값)
 * - `PUT    /export-settings { project, settings }` — 마지막 설정(사람만)
 * - `POST   /export-presets { project, name, settings }` — 내 프리셋 저장(같은 이름이면 덮는다 · 사람만)
 * - `DELETE /export-presets/:presetId?project=` — 내 프리셋 지우기(사람만)
 * - `POST   /job/:jobId/control { action }` — 일시정지·재개·취소·지금 시작·멈춤·위로·아래로·담았음(사람만)
 * - `POST   /jobs/control { project, action }` — 모두 시작·대기열 멈춤·모두 취소·끝난 것 지우기(사람만)
 *
 * 설정의 저장 위치는 OS 폴더 창으로만 고르고(42-2) 서버는 절대 경로인지만 본다. 루프백 유입(에이전트)은 전부 403 이다 —
 * 사람의 결정을 대신하지 못하게(37-17).
 */
import path from 'node:path';
import type { Express } from 'express';

import { EXPORT_PRESETS_MAX } from '../constants.js';
import { exportText, isSafePresetId, normalizeExportSettings, type ExportSettings } from '../exportSettings.js';
import type { ExportStore } from './exportStore.js';
import { rejectAgent } from './guards.js';
import { isQueueAction, isQueueBulkAction, type QueueAction, type QueueBulkAction } from './renderQueue.js';

export interface ExportRoutesDeps {
  readonly project: (raw: unknown) => string | null;
  readonly store: ExportStore;
  readonly controlJob: (jobId: string, action: QueueAction) => { status: number; job?: unknown; error?: string };
  readonly controlQueue: (projectPath: string, action: QueueBulkAction) => number;
}

const HINT = 'Export settings and the render queue are controlled by the user in the Vibistudio export window.';

/** 서버가 받는 설정 — 저장 위치는 절대 경로만(아니면 기본 자리로 되돌린다). */
function acceptSettings(raw: unknown): ExportSettings {
  const settings = normalizeExportSettings(raw);
  return settings.outputDir !== null && !path.isAbsolute(settings.outputDir) ? { ...settings, outputDir: null } : settings;
}

let presetSeq = 0;
function newPresetId(): string {
  presetSeq = (presetSeq + 1) % 1_000_000;
  return `preset-${Date.now().toString(36)}-${presetSeq.toString(36)}`;
}

export function mountExportRoutes(app: Express, deps: ExportRoutesDeps): void {
  app.get('/export-settings', (req, res) => {
    const p = deps.project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    res.json({ ok: true, ...deps.store.readSettings(p) });
  });

  app.put('/export-settings', (req, res) => {
    if (rejectAgent(req, res, HINT)) return;
    const body = (req.body ?? {}) as { project?: unknown; settings?: unknown };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const current = deps.store.readSettings(p);
    const next = { ...current, last: acceptSettings(body.settings) };
    try {
      deps.store.writeSettings(p, next);
      res.json({ ok: true, ...next });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post('/export-presets', (req, res) => {
    if (rejectAgent(req, res, HINT)) return;
    const body = (req.body ?? {}) as { project?: unknown; name?: unknown; settings?: unknown };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const name = exportText(body.name);
    if (name === null) { res.status(400).json({ ok: false, error: 'name required' }); return; }
    const current = deps.store.readSettings(p);
    const settings = acceptSettings(body.settings);
    const same = current.presets.find((x) => x.name === name);
    const presets = same
      ? current.presets.map((x) => (x.id === same.id ? { ...x, settings } : x))
      : [...current.presets, { id: newPresetId(), name, settings }];
    if (presets.length > EXPORT_PRESETS_MAX) { res.status(409).json({ ok: false, error: 'preset-limit' }); return; }
    const next = { ...current, presets };
    try {
      deps.store.writeSettings(p, next);
      res.json({ ok: true, ...next });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.delete('/export-presets/:presetId', (req, res) => {
    if (rejectAgent(req, res, HINT)) return;
    const p = deps.project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const id = req.params.presetId;
    if (!isSafePresetId(id)) { res.status(400).json({ ok: false, error: 'invalid preset id' }); return; }
    const current = deps.store.readSettings(p);
    const next = { ...current, presets: current.presets.filter((x) => x.id !== id) };
    try {
      deps.store.writeSettings(p, next);
      res.json({ ok: true, ...next });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post('/job/:jobId/control', (req, res) => {
    if (rejectAgent(req, res, HINT)) return;
    const action: unknown = (req.body ?? {})['action'];
    if (!isQueueAction(action)) { res.status(400).json({ ok: false, error: 'unknown action' }); return; }
    const result = deps.controlJob(req.params.jobId, action);
    if (result.status !== 200) { res.status(result.status).json({ ok: false, error: result.error ?? 'rejected', ...(result.job ? { job: result.job } : {}) }); return; }
    res.json({ ok: true, job: result.job });
  });

  app.post('/jobs/control', (req, res) => {
    if (rejectAgent(req, res, HINT)) return;
    const body = (req.body ?? {}) as { project?: unknown; action?: unknown };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    if (!isQueueBulkAction(body.action)) { res.status(400).json({ ok: false, error: 'unknown action' }); return; }
    res.json({ ok: true, changed: deps.controlQueue(p, body.action) });
  });
}
