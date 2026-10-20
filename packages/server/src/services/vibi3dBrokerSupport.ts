import { timingSafeEqual } from 'node:crypto';
import { validateVibi3DStats, type Vibi3DSnapshot, type Vibi3DCommandRequest, type Vibi3DCommandResult, type Vibi3DStats } from '@vibisual/shared';

export interface Vibi3DStoredCommand { request: Vibi3DCommandRequest; fingerprint: string; expiresAt: number; result: Vibi3DCommandResult }
export interface Vibi3DBrokerSession {
  snapshot: Vibi3DSnapshot; token: string; updatedAt: number;
  image?: { data: Buffer; contentType: string; revision: number; capturedAt: number };
  commands: Map<string, Vibi3DStoredCommand>; pending?: string;
  retainUntil?: number;
}

export class Vibi3DError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function acknowledgementStats(command: Vibi3DStoredCommand, ok: boolean, value: unknown): Vibi3DStats | undefined {
  const isStats = command.request.commands.length === 1 && command.request.commands[0]?.type === 'stats';
  if (value === undefined && !(isStats && ok)) return undefined;
  const stats = validateVibi3DStats(value);
  if (!isStats || !ok || !stats || stats.sceneRevision !== command.request.expectedRevision) throw new Vibi3DError(400, 'invalid-stats-result');
  return stats;
}
export function sameSecret(a: string, b: unknown): boolean {
  if (typeof b !== 'string') return false;
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function viewKey(snapshot: Vibi3DSnapshot): string {
  return JSON.stringify([snapshot.revision, snapshot.selectedId, snapshot.camera, snapshot.playback]);
}
export function assertDocumentOwner(snapshot: Vibi3DSnapshot, sessions: Iterable<{ snapshot: Vibi3DSnapshot; updatedAt: number }>, now: number, liveMs: number): void {
  if (snapshot.document && [...sessions].some(session => session.snapshot.sessionId !== snapshot.sessionId
    && session.snapshot.projectId === snapshot.projectId && session.snapshot.document?.id === snapshot.document?.id
    && now - session.updatedAt <= liveMs)) throw new Vibi3DError(409, 'document-viewer-exists');
}
export function readImage(value: unknown): { data: Buffer; contentType: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 3_000_000) throw new Vibi3DError(400, 'invalid-screenshot');
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Vibi3DError(400, 'invalid-screenshot');
  const data = Buffer.from(match[2]!, 'base64');
  const valid = match[1] === 'jpeg' ? data[0] === 255 && data[1] === 216 && data[2] === 255
    : data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!valid) throw new Vibi3DError(400, 'invalid-screenshot');
  return { data, contentType: `image/${match[1]}` };
}
