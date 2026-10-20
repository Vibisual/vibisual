import { randomUUID } from 'node:crypto';
import { sameSecret, viewKey, readImage, assertDocumentOwner, acknowledgementStats, Vibi3DError, type Vibi3DBrokerSession as Session } from './vibi3dBrokerSupport.js';
export { Vibi3DError } from './vibi3dBrokerSupport.js';
import { getVibi3DRequestTimeoutMs, type Vibi3DSnapshot, type Vibi3DCommandRequest, type Vibi3DCommandResult,
  type Vibi3DWorkflowResult } from '@vibisual/shared';

const LIVE_MS = 30_000;
const EXPIRE_MS = 5 * 60_000;
const MAX_SESSIONS = 32;
const MAX_RESULTS = 100;

/** Ephemeral bridge. The renderer remains the authority for scene edits and saved files. */
export class Vibi3DBroker {
  private sessions = new Map<string, Session>();
  constructor(private readonly now: () => number = Date.now) {}

  private sweep(): void {
    const now = this.now();
    for (const [id, session] of this.sessions) {
      if (now > Math.max(session.updatedAt + EXPIRE_MS, session.retainUntil ?? 0)) { this.sessions.delete(id); continue; }
      const pending = session.pending ? session.commands.get(session.pending) : undefined;
      if (pending && now >= pending.expiresAt) {
        pending.result = { ...pending.result, commandId: pending.request.commandId, status: 'rejected', error: 'command-timeout-refresh-state', revision: session.snapshot.revision };
        session.pending = undefined;
      }
    }
  }

  private get(id: string): Session {
    this.sweep();
    const session = this.sessions.get(id);
    if (!session) throw new Vibi3DError(404, 'session-not-found');
    return session;
  }
  private renderer(id: string, token: unknown): Session {
    const session = this.get(id);
    if (!sameSecret(session.token, token)) throw new Vibi3DError(403, 'renderer-token-mismatch');
    return session;
  }
  private live(session: Session): void {
    if (this.now() - session.updatedAt > LIVE_MS) throw new Vibi3DError(409, 'viewer-offline');
  }
  private publishTo(session: Session, snapshot: Vibi3DSnapshot, screenshot?: unknown): void {
    assertDocumentOwner(snapshot, this.sessions.values(), this.now(), LIVE_MS);
    if (snapshot.sessionId !== session.snapshot.sessionId || snapshot.projectId !== session.snapshot.projectId || snapshot.fileName !== session.snapshot.fileName
      || snapshot.document?.id !== session.snapshot.document?.id || snapshot.ownerId !== session.snapshot.ownerId) {
      throw new Vibi3DError(409, 'session-source-mismatch');
    }
    if (snapshot.revision < session.snapshot.revision) throw new Vibi3DError(409, 'stale-snapshot');
    const image = readImage(screenshot);
    if (image) session.image = { ...image, revision: snapshot.revision, capturedAt: this.now() };
    else if (viewKey(snapshot) !== viewKey(session.snapshot)) session.image = undefined;
    session.snapshot = structuredClone({ ...snapshot, ...(session.snapshot.runId ? { runId: session.snapshot.runId } : {}) });
    session.updatedAt = this.now();
  }

  create(snapshot: Vibi3DSnapshot, screenshot?: unknown, requestedToken?: unknown): { sessionId: string; rendererToken: string } {
    this.sweep();
    if (requestedToken !== undefined && (typeof requestedToken !== 'string' || !/^[a-zA-Z0-9_-]{20,100}$/.test(requestedToken))) {
      throw new Vibi3DError(400, 'invalid-renderer-token');
    }
    const existing = this.sessions.get(snapshot.sessionId);
    if (existing) {
      if (!sameSecret(existing.token, requestedToken)) throw new Vibi3DError(409, 'session-already-exists');
      this.publishTo(existing, snapshot, screenshot);
      return { sessionId: snapshot.sessionId, rendererToken: existing.token };
    }
    if (this.sessions.size >= MAX_SESSIONS) throw new Vibi3DError(429, 'session-limit');
    assertDocumentOwner(snapshot, this.sessions.values(), this.now(), LIVE_MS);
    const token = typeof requestedToken === 'string' ? requestedToken : randomUUID();
    const session: Session = { snapshot: structuredClone(snapshot), token, updatedAt: this.now(), commands: new Map() };
    this.publishTo(session, snapshot, screenshot);
    this.sessions.set(snapshot.sessionId, session);
    return { sessionId: snapshot.sessionId, rendererToken: token };
  }
  publish(id: string, token: unknown, snapshot: Vibi3DSnapshot, screenshot?: unknown): void {
    this.publishTo(this.renderer(id, token), snapshot, screenshot);
  }
  remove(id: string, token: unknown): void { this.renderer(id, token); this.sessions.delete(id); }
  list(projectId?: string): Array<{ sessionId: string; projectId: string; fileName: string; revision: number; updatedAt: number; online: boolean }> {
    this.sweep();
    return [...this.sessions.values()].filter((s) => !projectId || s.snapshot.projectId === projectId).map((s) => ({
      sessionId: s.snapshot.sessionId, projectId: s.snapshot.projectId, fileName: s.snapshot.fileName,
      revision: s.snapshot.revision, updatedAt: s.updatedAt, online: this.now() - s.updatedAt <= LIVE_MS,
    }));
  }
  read(id: string): { snapshot: Vibi3DSnapshot; updatedAt: number; online: boolean; imageRevision?: number; capturedAt?: number } {
    const session = this.get(id);
    return { snapshot: structuredClone(session.snapshot), updatedAt: session.updatedAt, online: this.now() - session.updatedAt <= LIVE_MS,
      ...(session.image ? { imageRevision: session.image.revision, capturedAt: session.image.capturedAt } : {}) };
  }
  document(projectId: string, docId: string): ReturnType<Vibi3DBroker['read']> | null {
    this.sweep();
    const found = [...this.sessions.values()].filter(s => s.snapshot.projectId === projectId && s.snapshot.document?.id === docId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return found ? this.read(found.snapshot.sessionId) : null;
  }
  bindRun(id: string, runId: string): void { this.get(id).snapshot.runId = runId; }
  workflowRequest(id: string, token: unknown, commandId: string, allowTimedOutReceipt = false): Vibi3DCommandRequest {
    const session = this.renderer(id, token);
    const command = session.commands.get(commandId);
    if (!command) throw new Vibi3DError(404, 'command-not-found');
    const uncertain = allowTimedOutReceipt && command.result.status === 'rejected' && command.result.error === 'command-timeout-refresh-state';
    if (!uncertain && (session.pending !== commandId || !['pending', 'running'].includes(command.result.status))) {
      throw new Vibi3DError(409, 'command-not-pending');
    }
    return structuredClone(command.request);
  }
  progress(id: string, token: unknown, commandId: string, progress: number): Vibi3DCommandResult {
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new Vibi3DError(400, 'invalid-progress');
    this.workflowRequest(id, token, commandId);
    const session = this.renderer(id, token);
    const command = session.commands.get(commandId)!;
    command.result = { ...command.result, status: 'running', progress: Math.max(command.result.progress ?? 0, progress) };
    session.updatedAt = this.now();
    return { ...command.result };
  }
  recordResult(id: string, token: unknown, commandId: string, result: Vibi3DWorkflowResult): void {
    this.workflowRequest(id, token, commandId, true);
    const command = this.renderer(id, token).commands.get(commandId)!;
    command.result.result = { ...command.result.result, ...structuredClone(result) };
  }
  image(id: string): { data: Buffer; contentType: string; revision: number; capturedAt: number } {
    const session = this.get(id);
    this.live(session);
    if (!session.image) throw new Vibi3DError(404, 'capture-required');
    return session.image;
  }

  enqueue(id: string, request: Vibi3DCommandRequest): Vibi3DCommandResult {
    const session = this.get(id);
    const fingerprint = JSON.stringify(request);
    const existing = session.commands.get(request.commandId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Vibi3DError(409, 'command-id-conflict');
      return { ...existing.result };
    }
    this.live(session);
    if (request.expectedRevision !== session.snapshot.revision) throw new Vibi3DError(409, 'revision-conflict');
    if (session.pending) throw new Vibi3DError(409, 'command-in-progress');
    const nodeIds = new Set(session.snapshot.nodes.map((n) => n.id));
    if (request.commands.some((c) => (c.type === 'update' || c.type === 'select') && c.id !== null && !nodeIds.has(c.id))) {
      throw new Vibi3DError(400, 'node-not-found');
    }
    const expiresAt = this.now() + getVibi3DRequestTimeoutMs(request.commands);
    const result: Vibi3DCommandResult = { commandId: request.commandId, status: 'pending', expiresAt };
    session.commands.set(request.commandId, { request: structuredClone(request), fingerprint, expiresAt, result });
    session.retainUntil = expiresAt + EXPIRE_MS;
    session.pending = request.commandId;
    while (session.commands.size > MAX_RESULTS) session.commands.delete(session.commands.keys().next().value!);
    return { ...result };
  }
  pending(id: string, token: unknown): (Vibi3DCommandRequest & { expiresAt: number }) | null {
    const session = this.renderer(id, token);
    assertDocumentOwner(session.snapshot, this.sessions.values(), this.now(), LIVE_MS);
    session.updatedAt = this.now();
    const command = session.pending ? session.commands.get(session.pending) : undefined;
    if (!command) return null;
    // A person may have edited while this command waited to reach the renderer.
    if (command.request.expectedRevision !== session.snapshot.revision) {
      command.result = { commandId: command.request.commandId, status: 'rejected', revision: session.snapshot.revision, error: 'revision-conflict' };
      session.pending = undefined;
      return null;
    }
    return { ...structuredClone(command.request), expiresAt: command.expiresAt };
  }
  acknowledge(id: string, token: unknown, commandId: string, ok: boolean, snapshot: Vibi3DSnapshot, screenshot?: unknown, error?: string, statsValue?: unknown): Vibi3DCommandResult {
    const session = this.renderer(id, token);
    const command = session.commands.get(commandId);
    if (!command) throw new Vibi3DError(404, 'command-not-found');
    // A suspended renderer can finish immediately before the deadline and deliver its ACK
    // just after it. A timeout means unconfirmed, not proof the edit never happened.
    const timedOut = command.result.status === 'rejected' && command.result.error === 'command-timeout-refresh-state';
    if (!['pending', 'running'].includes(command.result.status) && !timedOut) return { ...command.result };
    const stats = acknowledgementStats(command, ok, statsValue);
    this.publishTo(session, snapshot, screenshot);
    command.result = { commandId, status: ok ? 'applied' : 'rejected', revision: snapshot.revision,
      ...(command.result.result || stats ? { result: { ...command.result.result, ...(stats ? { stats } : {}) } } : {}), ...(!ok ? { error: error || 'command-rejected' } : {}) };
    if (session.pending === commandId) session.pending = undefined;
    return { ...command.result };
  }
  status(id: string, commandId: string): Vibi3DCommandResult {
    const command = this.get(id).commands.get(commandId);
    if (!command) throw new Vibi3DError(404, 'command-not-found');
    return { ...command.result };
  }
}
