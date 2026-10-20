import type { Express, Request, Response } from 'express';
import {
  LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE, VIBI3D_RENDERER_TOKEN_HEADER, VIBI3D_WORKFLOW_LIMITS,
  isVibi3DWorkflowId, validateVibi3DSnapshot, validateVibi3DCaptureRaster, pathKey, type AppEventPayload, type Vibi3DSnapshot, type Vibi3DCaptureUpload,
} from '@vibisual/shared';
import { CreationStore, CreationError, creationDocId, type CreationHost } from './creationStore.js';
import { Vibi3DBroker, Vibi3DError } from './vibi3dBroker.js';
import { Vibi3DWorkflowStore } from './vibi3dWorkflowStore.js';
import { nativeAuthoringKit } from './vibi3dNativeKit.js';

export interface Vibi3DWorkflowHost {
  resolveProjectPath(raw: unknown): string | null;
  atomicWriteFile?: CreationHost['atomicWriteFile'];
  getCreationStore?(): Promise<CreationStore>;
  notify?(event: Omit<AppEventPayload, 'appId'>): void;
  warn?(message: string): void;
}
type Body = Record<string, unknown>;
const body = (req: Request): Body => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new Vibi3DError(400, 'invalid-body');
  return req.body as Body;
};
const renderer = (req: Request): void => {
  if (req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE) throw new Vibi3DError(403, 'renderer-only');
};
const identifier = (value: unknown): string => {
  if (!isVibi3DWorkflowId(value)) throw new Vibi3DError(400, 'invalid-identifier'); return value;
};

/** Leases choose one existing renderer; durable scene stages are owned by the creation document. */
export class Vibi3DWorkflowRoutes {
  private readonly owners = new Map<string, { ownerId: string; at: number }>();
  private readonly reopens = new Map<string, string>();
  private storePromise?: Promise<Vibi3DWorkflowStore>;
  constructor(private readonly host: Vibi3DWorkflowHost, private readonly broker: Vibi3DBroker, private readonly now = Date.now) {}
  private root(raw: unknown): string {
    const root = this.host.resolveProjectPath(raw); if (!root) throw new CreationError(404, 'project-not-found'); return root;
  }
  private async store(): Promise<Vibi3DWorkflowStore> {
    this.storePromise ??= (async () => {
      const host: CreationHost = { resolveProjectPath: raw => this.host.resolveProjectPath(raw),
        atomicWriteFile: (file, data) => {
          if (!this.host.atomicWriteFile) throw new CreationError(503, 'workflow-storage-unavailable');
          this.host.atomicWriteFile(file, data);
        }, ...(this.host.warn ? { warn: this.host.warn } : {}) };
      const creation = this.host.getCreationStore ? await this.host.getCreationStore() : new CreationStore(host);
      return new Vibi3DWorkflowStore(host, creation, process.platform, this.now);
    })();
    return this.storePromise;
  }
  private owner(projectId: string, docId: string, requested?: string): { ownerId: string; sessionId?: string } {
    const session = this.session(projectId, docId);
    const key = `${pathKey(projectId, process.platform)}\0${docId}`;
    if (session?.online) return { ownerId: session.snapshot.ownerId ?? session.snapshot.sessionId, sessionId: session.snapshot.sessionId };
    let owner = this.owners.get(key);
    if (!owner || (requested && owner.ownerId !== requested && this.now() - owner.at > VIBI3D_WORKFLOW_LIMITS.claimMs)) {
      if (!requested) throw new CreationError(409, 'renderer-owner-required');
      owner = { ownerId: requested, at: this.now() }; this.owners.set(key, owner);
    } else if (requested === owner.ownerId) owner.at = this.now();
    return { ownerId: owner.ownerId };
  }
  private session(projectId: string, docId: string): ReturnType<Vibi3DBroker['read']> | null {
    for (const item of this.broker.list().sort((a, b) => b.updatedAt - a.updatedAt)) {
      const session = this.broker.read(item.sessionId);
      const root = this.host.resolveProjectPath(session.snapshot.projectId);
      if (root && pathKey(root, process.platform) === pathKey(projectId, process.platform) && session.snapshot.document?.id === docId) return session;
    }
    return null;
  }
  register(snapshot: Vibi3DSnapshot): void {
    if (!snapshot.document) return;
    const root = this.root(snapshot.projectId);
    const owner = this.owner(root, snapshot.document.id, snapshot.ownerId ?? snapshot.sessionId);
    if (owner.ownerId !== (snapshot.ownerId ?? snapshot.sessionId) || (owner.sessionId && owner.sessionId !== snapshot.sessionId)) {
      throw new CreationError(409, 'document-viewer-exists');
    }
    const runId = this.reopens.get(`${pathKey(root, process.platform)}\0${snapshot.document.id}`);
    if (runId) snapshot.runId = runId;
  }
  assertCurrentOwner(snapshot: Vibi3DSnapshot): void {
    if (!snapshot.document) return;
    const active = this.session(this.root(snapshot.projectId), snapshot.document.id);
    if (active?.online && active.snapshot.sessionId !== snapshot.sessionId) throw new CreationError(409, 'document-viewer-exists');
  }
  notifyCommand(snapshot: Vibi3DSnapshot): void {
    this.host.notify?.({ project: this.root(snapshot.projectId), kind: 'command', key: snapshot.sessionId });
  }
  connected(snapshot: Vibi3DSnapshot): void {
    if (snapshot.document) this.reopens.delete(`${pathKey(this.root(snapshot.projectId), process.platform)}\0${snapshot.document.id}`);
  }
  mount(app: Express): void {
    const endpoint = (action: (req: Request, res: Response) => Promise<void> | void) => async (req: Request, res: Response): Promise<void> => {
      res.setHeader('Cache-Control', 'no-store');
      try { await action(req, res); } catch (error) {
        if (!(error instanceof CreationError || error instanceof Vibi3DError)) this.host.warn?.(`[vibi3d] workflow failed: ${String(error)}`);
        res.status(error instanceof CreationError || error instanceof Vibi3DError ? error.status : 500)
          .json({ ok: false, error: error instanceof CreationError || error instanceof Vibi3DError ? error.message : 'workflow-request-failed' });
      }
    };
    for (const action of ['ensure', 'claim']) app.post(`/documents/:docId/${action}`, endpoint((req, res) => {
      renderer(req); const input = body(req); const projectId = this.root(input.projectId); const docId = creationDocId(req.params['docId']);
      res.json({ ok: true, ...this.owner(projectId, docId, identifier(input.ownerId)) });
    }));
    app.get('/documents/:docId/session', endpoint(async (req, res) => {
      const projectId = this.root(req.query['projectId']); const docId = creationDocId(req.params['docId']);
      res.json({ ok: true, session: this.session(projectId, docId), run: (await this.store()).read(projectId, docId) });
    }));
    app.get('/documents/:docId/runs', endpoint(async (req, res) => {
      const projectId = this.root(req.query['projectId']); const docId = creationDocId(req.params['docId']);
      const runId = req.query['runId'] === undefined ? undefined : identifier(req.query['runId']);
      res.json({ ok: true, run: (await this.store()).read(projectId, docId, runId) });
    }));
    app.post('/documents/:docId/runs', endpoint(async (req, res) => {
      const input = body(req); const projectId = this.root(input.projectId); const docId = creationDocId(req.params['docId']);
      const session = this.session(projectId, docId);
      if (!session?.online) throw new CreationError(409, 'viewer-offline');
      const runId = input.runId === undefined ? undefined : identifier(input.runId);
      const run = (await this.store()).start(projectId, docId, session.snapshot, runId);
      this.broker.bindRun(session.snapshot.sessionId, run.id);
      res.json({ ok: true, run, sessionId: session.snapshot.sessionId });
    }));
    app.post('/documents/:docId/reopen', endpoint(async (req, res) => {
      const input = body(req); const projectId = this.root(input.projectId); const docId = creationDocId(req.params['docId']);
      const run = (await this.store()).read(projectId, docId, identifier(input.runId));
      if (!run) throw new CreationError(404, 'run-not-found');
      if (!this.session(projectId, docId)?.online) {
        const key = `${pathKey(projectId, process.platform)}\0${docId}`;
        this.reopens.set(key, run.id); this.owners.delete(key);
      }
      this.host.notify?.({ project: projectId, kind: 'reopen', key: docId });
      const owner = this.owners.get(`${pathKey(projectId, process.platform)}\0${docId}`);
      res.json({ ok: true, ...(owner ? { ownerId: owner.ownerId } : {}) });
    }));
    app.get('/authoring/native-kit', endpoint((req, res) => {
      const projectId = this.root(req.query['projectId']); res.json({ ok: true, ...nativeAuthoringKit(projectId) });
    }));
    for (const kind of ['checkpoint', 'propose']) app.post(`/sessions/:id/${kind}`, endpoint(async (req, res) => {
      const context = this.context(req); const command = context.request.commands[0];
      if (context.request.commands.length !== 1 || command?.type !== kind || (command.type !== 'checkpoint' && command.type !== 'propose')) throw new CreationError(400, 'command-type-mismatch');
      const result = await (await this.store()).save(context.projectId, context.docId, context.runId, context.commandId,
        context.snapshot, command, context.input.payload, context.input.links, context.replayOnly, () => {
          const current = this.broker.read(context.sessionId).snapshot; this.assertCurrentOwner(current);
          const pending = this.broker.workflowRequest(context.sessionId, context.token, context.commandId);
          if (current.revision !== pending.expectedRevision) throw new CreationError(409, 'revision-conflict');
        });
      this.broker.recordResult(context.sessionId, context.token, context.commandId, { checkpoint: result.stage });
      this.host.notify?.({ project: context.projectId, kind: 'workflow-updated', key: context.docId });
      res.json({ ok: true, ...result });
    }));
    app.post('/sessions/:id/captures', endpoint(async (req, res) => {
      const context = this.context(req);
      if (context.request.commands.length !== 1 || context.request.commands[0]?.type !== 'capture') throw new CreationError(400, 'command-type-mismatch');
      const uploads = captureUploads(context.input.captures);
      const captures = (await this.store()).capture(context.projectId, context.docId, context.runId, context.commandId, context.snapshot, uploads, context.replayOnly);
      const previous = this.broker.status(context.sessionId, context.commandId).result?.captures ?? [];
      const all = [...previous]; for (const capture of captures) if (!all.some(item => pathKey(item.path, process.platform) === pathKey(capture.path, process.platform))) all.push(capture);
      this.broker.recordResult(context.sessionId, context.token, context.commandId, { captures: all });
      this.host.notify?.({ project: context.projectId, kind: 'workflow-updated', key: context.docId });
      res.json({ ok: true, captures });
    }));
    app.post('/sessions/:id/resume', endpoint(async (req, res) => {
      const context = this.context(req); const command = context.request.commands[0];
      if (context.replayOnly) throw new CreationError(409, 'command-not-pending');
      if (context.request.commands.length !== 1 || command?.type !== 'resume') throw new CreationError(400, 'command-type-mismatch');
      const result = (await this.store()).resume(context.projectId, context.docId, command.runId, context.snapshot, command.stage);
      this.broker.bindRun(context.sessionId, command.runId);
      this.broker.recordResult(context.sessionId, context.token, context.commandId, { checkpoint: result.stage });
      res.json({ ok: true, ...result });
    }));
    app.post('/sessions/:id/progress', endpoint((req, res) => {
      renderer(req); const input = body(req); const progress = input.progress;
      if (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 1) throw new CreationError(400, 'invalid-progress');
      this.assertCurrentOwner(this.broker.read(identifier(req.params['id'])).snapshot);
      res.json({ ok: true, ...this.broker.progress(identifier(req.params['id']), req.get(VIBI3D_RENDERER_TOKEN_HEADER), identifier(input.commandId), progress) });
    }));
  }
  private context(req: Request) {
    renderer(req); const input = body(req); const sessionId = identifier(req.params['id']); const commandId = identifier(input.commandId);
    const token = req.get(VIBI3D_RENDERER_TOKEN_HEADER); const request = this.broker.workflowRequest(sessionId, token, commandId, true);
    const replayOnly = this.broker.status(sessionId, commandId).status === 'rejected';
    const current = this.broker.read(sessionId).snapshot; const snapshot = validateVibi3DSnapshot(input.snapshot);
    this.assertCurrentOwner(current);
    if (!snapshot || snapshot.sessionId !== sessionId || snapshot.document?.id !== current.document?.id
      || snapshot.projectId !== current.projectId || snapshot.revision !== request.expectedRevision) throw new CreationError(409, 'revision-conflict');
    if (!current.document || !current.runId) throw new CreationError(409, 'run-required');
    return { input, sessionId, commandId, token, request, snapshot, replayOnly, projectId: this.root(current.projectId), docId: current.document.id, runId: current.runId };
  }
}

function captureUploads(value: unknown): Vibi3DCaptureUpload[] {
  if (!Array.isArray(value) || !value.length || value.length > VIBI3D_WORKFLOW_LIMITS.views) throw new CreationError(400, 'invalid-capture');
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.view !== 'string' || !item.view || item.view.length > 200
      || !['lit', 'clay', 'wire', 'ao'].includes(item.mode) || !['draft', 'final'].includes(item.quality)
      || ![item.width, item.height].every(n => Number.isSafeInteger(n) && n >= 1 && n <= VIBI3D_WORKFLOW_LIMITS.imageDimension)
      || (item.raster !== undefined && (!validateVibi3DCaptureRaster(item.raster) || item.raster.width > item.width || item.raster.height > item.height))
      || typeof item.dataUrl !== 'string' || item.dataUrl.length > VIBI3D_WORKFLOW_LIMITS.pngBytes * 1.34) throw new CreationError(400, 'invalid-capture');
  }
  return value as Vibi3DCaptureUpload[];
}
