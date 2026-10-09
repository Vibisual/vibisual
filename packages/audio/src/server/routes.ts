import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { AudioServerHost } from '../host.js';
import { AUDIO_UPLOAD_MAX_BYTES } from './assets.js';
import { AudioServiceError, object } from './errors.js';
import { AudioService } from './service.js';

const CAPABILITIES = {
  ok: true, appId: 'vibisound', schemaVersion: 1, providersActive: false,
  audioImportMaxBytes: AUDIO_UPLOAD_MAX_BYTES, undoSteps: 50, requestReplayWindow: 512,
  rules: [
    'Use project (registered name or absolute root) on document and asset requests.',
    'Import/upload assets first; only use returned immutable asset metadata in setAsset.',
    'Read the document then POST patch with baseVersion, unique requestId and ops.',
    'On 409 version-conflict, read again and preserve newer human edits.',
    'An identical requestId returns the latest document without applying twice.',
    'splitClip.at and cropClip/deleteClipRange start/end are clip-local seconds.',
    'Selection/playhead belong to window context, not the document version.',
    'Undo/redo targets the latest edit group and requires baseVersion/requestId.',
  ],
  operations: [
    { op: 'setAsset', asset: '<asset returned by import/upload>' },
    { op: 'removeAsset', assetId: 'asset-id' },
    { op: 'addTrack', track: { id: 'track-voice', label: 'Voice', clips: [] } },
    { op: 'removeTrack', trackId: 'track-voice' },
    { op: 'updateTrack', trackId: 'track-voice', patch: { muted: false, gainDb: -2 } },
    { op: 'addClip', trackId: 'track-voice', clip: { id: 'clip-1', assetId: 'asset-id', at: 0, sourceStart: 0, duration: 2 } },
    { op: 'removeClip', clipId: 'clip-1' },
    { op: 'updateClip', clipId: 'clip-1', patch: { gainDb: -2, fadeIn: 0.1, fadeOut: 0.2 } },
    { op: 'moveClip', clipId: 'clip-1', toTrackId: 'track-voice', at: 3 },
    { op: 'splitClip', clipId: 'clip-1', at: 1, newClipId: 'clip-2' },
    { op: 'cropClip', clipId: 'clip-1', start: 0.2, end: 1.5 },
    { op: 'deleteClipRange', clipId: 'clip-1', start: 0.2, end: 0.5, newClipId: 'clip-tail' },
    { op: 'setDoc', patch: { title: 'Audio project', sampleRate: 48000, channels: 2 } },
  ],
};

/** Mounted inside the host's authenticated /api/app/vibisound router. */
export function mountAudioRoutes(app: Express, host: AudioServerHost): AudioService {
  const service = new AudioService(host);
  const failure = (res: Response, error: unknown): void => {
    if (res.headersSent) return;
    if (error instanceof AudioServiceError) {
      res.status(error.status).json({ ok: false, error: error.code, message: error.message,
        ...(error.currentVersion === undefined ? {} : { currentVersion: error.currentVersion }) });
    } else {
      host.warn(`[audio] Request failed: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ ok: false, error: 'internal-error', message: 'The audio request could not be completed.' });
    }
  };
  const route = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response): void => {
    try { Promise.resolve(fn(req, res)).catch((error: unknown) => failure(res, error)); }
    catch (error) { failure(res, error); }
  };
  app.get('/capabilities', (_req, res) => { res.json(CAPABILITIES); });
  app.get('/docs', route((req, res) => { res.json({ ok: true, docs: service.list(service.project(req.query['project'])) }); }));
  app.post('/docs', route((req, res) => { res.json(service.create(service.project(req.body?.project), req.body)); }));
  app.get('/doc/:docId', route((req, res) => { res.json(service.get(service.project(req.query['project']), req.params['docId'])); }));
  for (const action of ['patch', 'undo', 'redo'] as const) {
    app.post(`/doc/:docId/${action}`, route((req, res) => {
      res.json(service.edit(service.project(req.body?.project), req.params['docId'], action, req.body));
    }));
  }
  app.post('/assets/import', route(async (req, res) => {
    const asset = await service.assets.import(service.project(req.body?.project), req.body?.path);
    res.json({ ok: true, asset });
  }));
  app.put('/assets',
    (req, res, next): void => {
      try { service.project(req.query['project']); next(); } catch (error) { failure(res, error); }
    },
    express.raw({ type: ['application/octet-stream', 'audio/*', 'video/webm'], limit: AUDIO_UPLOAD_MAX_BYTES }),
    route(async (req, res) => {
      const root = service.project(req.query['project']);
      if (!Buffer.isBuffer(req.body)) throw new AudioServiceError(400, 'invalid-request', 'Send audio bytes with Content-Type application/octet-stream.');
      const asset = await service.assets.upload(root, req.query['name'], req.body);
      res.json({ ok: true, asset });
    }),
  );
  app.get('/asset', route((req, res) => {
    const file = service.assets.resolve(service.project(req.query['project']), req.query['path']);
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(file, { dotfiles: 'allow', cacheControl: false }, (error) => {
      if (error && !res.headersSent) {
        const status = object(error) && typeof error.status === 'number' ? error.status : 404;
        res.status(status).json({ ok: false, error: status === 416 ? 'invalid-range' : 'unknown-asset', message: 'The audio asset could not be read.' });
      }
    });
  }));
  app.get('/settings', route((req, res) => {
    res.json({ ok: true, settings: service.getSettings(service.project(req.query['project'])), active: false });
  }));
  app.put('/settings', route((req, res) => {
    res.json({ ok: true, settings: service.putSettings(service.project(req.body?.project), req.body?.settings), active: false });
  }));
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction): void => {
    if (object(error) && error.type === 'entity.too.large') {
      failure(res, new AudioServiceError(413, 'asset-too-large', 'Audio imports are limited to 128 MiB.'));
    } else if (error instanceof AudioServiceError) failure(res, error);
    else next(error);
  });
  return service;
}
