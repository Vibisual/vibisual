import type { Express, Request, Response } from 'express';
import { LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE } from '@vibisual/shared';
import { CreationError, CreationStore, type CreationHost } from './creationStore.js';
import { Vibi3DDraftStore } from './vibi3dDraftStore.js';
import type { Vibi3DWorkflowHost } from './vibi3dWorkflowRoutes.js';

export function mountVibi3DDraftRoutes(app: Express, host: Vibi3DWorkflowHost): void {
  let pending: Promise<Vibi3DDraftStore> | undefined;
  const store = (): Promise<Vibi3DDraftStore> => pending ??= (async () => {
    const storage: CreationHost = { resolveProjectPath: raw => host.resolveProjectPath(raw), atomicWriteFile: (file, data) => {
      if (!host.atomicWriteFile) throw new CreationError(503, 'draft-storage-unavailable');
      host.atomicWriteFile(file, data);
    }, ...(host.warn ? { warn: host.warn } : {}) };
    return new Vibi3DDraftStore(storage, host.getCreationStore ? await host.getCreationStore() : new CreationStore(storage));
  })();
  const endpoint = (action: (req: Request, res: Response, drafts: Vibi3DDraftStore) => Promise<void> | void) => async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try { await action(req, res, await store()); } catch (error) {
      if (!(error instanceof CreationError)) host.warn?.(`[vibi3d] draft request failed: ${String(error)}`);
      res.status(error instanceof CreationError ? error.status : 500).json({ ok: false,
        error: error instanceof CreationError ? error.message : 'draft-request-failed',
        ...(error instanceof CreationError && error.detail ? { detail: error.detail } : {}) });
    }
  };
  const input = (req: Request): Record<string, unknown> => {
    if (req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE) throw new CreationError(403, 'renderer-only');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new CreationError(400, 'invalid-body');
    return req.body as Record<string, unknown>;
  };
  app.get('/drafts', endpoint((req, res, drafts) => { res.json({ ok: true, ...drafts.list(req.query['projectId']) }); }));
  app.get('/drafts/current', endpoint((req, res, drafts) => {
    res.json({ ok: true, ...drafts.read(req.query['projectId'], req.query['key'], req.query['actor']) });
  }));
  app.get('/drafts/history', endpoint((req, res, drafts) => {
    res.json({ ok: true, revisions: drafts.history(req.query['projectId'], req.query['key'], req.query['actor']) });
  }));
  app.get('/drafts/revisions/:version', endpoint((req, res, drafts) => {
    res.json({ ok: true, draft: drafts.revision(req.query['projectId'], req.query['key'], req.query['actor'], Number(req.params['version'])) });
  }));
  app.post('/drafts/save', endpoint(async (req, res, drafts) => {
    const body = input(req); res.json({ ok: true, ...await drafts.save(body.projectId, body) });
  }));
  app.post('/drafts/discard', endpoint((req, res, drafts) => {
    const body = input(req); res.json({ ok: true, ...drafts.discard(body.projectId, body) });
  }));
}
