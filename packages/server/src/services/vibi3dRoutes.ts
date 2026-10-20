import type { Express, Request, Response } from 'express';
import { LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE, VIBI3D_API_PREFIX, VIBI3D_RENDERER_TOKEN_HEADER,
  isVibi3DIdentifier, validateVibi3DCommandRequest, validateVibi3DSnapshot, type Vibi3DSnapshot } from '@vibisual/shared';
import { VIBI3D_LIMITS, vibi3DJsonBytes } from '@vibisual/shared';
import { Vibi3DBroker, Vibi3DError } from './vibi3dBroker.js';
import { mountVibi3DAuthoringRoutes } from './vibi3dAuthoring.js';
import { CreationError } from './creationStore.js';
import { Vibi3DWorkflowRoutes, type Vibi3DWorkflowHost } from './vibi3dWorkflowRoutes.js';
import { mountVibi3DDraftRoutes } from './vibi3dDraftRoutes.js';

type Vibi3DHost = Vibi3DWorkflowHost;
type Body = Record<string, unknown>;
function body(req: Request): Body {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new Vibi3DError(400, 'invalid-body');
  return req.body as Body;
}
function id(req: Request, key = 'id'): string {
  const value = req.params[key];
  if (!isVibi3DIdentifier(value)) throw new Vibi3DError(400, 'invalid-identifier');
  return value;
}
function rendererOnly(req: Request): void {
  if (req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE) throw new Vibi3DError(403, 'renderer-only');
}

/** Mounted under APP_API_PREFIX/vibi3d by appHost's lazy router. */
export function mountVibi3DRoutes(app: Express, host: Vibi3DHost, broker = new Vibi3DBroker()): void {
  mountVibi3DAuthoringRoutes(app, host);
  mountVibi3DDraftRoutes(app, host);
  const workflow = new Vibi3DWorkflowRoutes(host, broker);
  workflow.mount(app);
  const snapshot = (value: unknown): Vibi3DSnapshot => {
    const result = validateVibi3DSnapshot(value);
    if (!result) throw new Vibi3DError(400, 'invalid-snapshot');
    if (!host.resolveProjectPath(result.projectId)) throw new Vibi3DError(404, 'project-not-found');
    return result;
  };
  const endpoint = (action: (req: Request, res: Response) => void) => (req: Request, res: Response): void => {
    res.setHeader('Cache-Control', 'no-store');
    try { action(req, res); } catch (error) {
      const known = error instanceof Vibi3DError || error instanceof CreationError;
      res.status(known ? error.status : 500).json({ ok: false, error: known ? error.message : 'vibi3d-request-failed' });
    }
  };
  const authorizeExistingProject = (sessionId: string): void => {
    if (!host.resolveProjectPath(broker.read(sessionId).snapshot.projectId)) throw new Vibi3DError(404, 'project-not-found');
  };
  app.post('/sessions', endpoint((req, res) => {
    rendererOnly(req);
    const b = body(req);
    const view = snapshot(b.snapshot); workflow.register(view);
    const result = broker.create(view, b.screenshot, b.rendererToken); workflow.connected(view);
    res.json({ ok: true, ...result });
  }));
  app.get('/sessions', endpoint((req, res) => {
    const projectId = req.query['projectId'];
    if (projectId !== undefined && (typeof projectId !== 'string' || !host.resolveProjectPath(projectId))) throw new Vibi3DError(404, 'project-not-found');
    res.json({ ok: true, sessions: broker.list(typeof projectId === 'string' ? projectId : undefined).filter((s) => host.resolveProjectPath(s.projectId)) });
  }));
  app.get('/sessions/:id', endpoint((req, res) => {
    const sessionId = id(req);
    authorizeExistingProject(sessionId);
    const result = broker.read(sessionId);
    res.json({ ok: true, ...result, imageUrl: `${VIBI3D_API_PREFIX}/sessions/${sessionId}/image` });
  }));
  app.get('/sessions/:id/image', endpoint((req, res) => {
    const sessionId = id(req);
    authorizeExistingProject(sessionId);
    const image = broker.image(sessionId);
    res.setHeader('X-Vibi3D-Revision', image.revision);
    res.type(image.contentType).send(image.data);
  }));
  app.post('/sessions/:id/publish', endpoint((req, res) => {
    rendererOnly(req);
    const b = body(req);
    const view = snapshot(b.snapshot); workflow.assertCurrentOwner(view);
    broker.publish(id(req), req.get(VIBI3D_RENDERER_TOKEN_HEADER), view, b.screenshot);
    res.json({ ok: true });
  }));
  app.get('/sessions/:id/pending', endpoint((req, res) => {
    rendererOnly(req);
    workflow.assertCurrentOwner(broker.read(id(req)).snapshot);
    res.json({ ok: true, request: broker.pending(id(req), req.get(VIBI3D_RENDERER_TOKEN_HEADER)) });
  }));
  app.post('/sessions/:id/ack', endpoint((req, res) => {
    rendererOnly(req);
    const b = body(req);
    if (!isVibi3DIdentifier(b.commandId) || typeof b.ok !== 'boolean' || (b.error !== undefined && (typeof b.error !== 'string' || b.error.length > 2000))) {
      throw new Vibi3DError(400, 'invalid-acknowledgement');
    }
    const stats = b.result && typeof b.result === 'object' && !Array.isArray(b.result) ? (b.result as Body).stats : undefined;
    const view = snapshot(b.snapshot); workflow.assertCurrentOwner(view);
    res.json({ ok: true, ...broker.acknowledge(id(req), req.get(VIBI3D_RENDERER_TOKEN_HEADER), b.commandId, b.ok, view, b.screenshot, b.error as string | undefined, stats) });
  }));
  app.delete('/sessions/:id', endpoint((req, res) => {
    rendererOnly(req);
    broker.remove(id(req), req.get(VIBI3D_RENDERER_TOKEN_HEADER));
    res.json({ ok: true });
  }));
  app.post('/sessions/:id/commands', endpoint((req, res) => {
    if (Number(req.get('content-length')) > VIBI3D_LIMITS.requestBytes || vibi3DJsonBytes(req.body) > VIBI3D_LIMITS.requestBytes) throw new Vibi3DError(413, 'command-body-too-large');
    const sessionId = id(req);
    authorizeExistingProject(sessionId);
    const request = validateVibi3DCommandRequest(req.body);
    if (!request) throw new Vibi3DError(400, 'invalid-command');
    const result = broker.enqueue(sessionId, request);
    workflow.notifyCommand(broker.read(sessionId).snapshot);
    res.status(result.status === 'pending' ? 202 : 200).json({ ok: true, ...result,
      statusUrl: `${VIBI3D_API_PREFIX}/sessions/${sessionId}/commands/${request.commandId}` });
  }));
  app.get('/sessions/:id/commands/:commandId', endpoint((req, res) => {
    const sessionId = id(req);
    authorizeExistingProject(sessionId);
    res.json({ ok: true, ...broker.status(sessionId, id(req, 'commandId')) });
  }));
}
