import type { IncomingMessage, ServerResponse } from 'node:http';

/** Hook/control ingress only. Media uploads have separate IPC routes and their existing limits. */
export const LOOPBACK_BODY_LIMITS = { requestBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024 };

export class LoopbackBodyBudget {
  private held = 0;
  constructor(readonly limits = LOOPBACK_BODY_LIMITS) {}
  get usedBytes(): number { return this.held; }
  acquire(bytes: number): boolean {
    if (bytes > this.limits.totalBytes - this.held) return false;
    this.held += bytes;
    return true;
  }
  release(bytes: number): void { this.held = Math.max(0, this.held - bytes); }
}

interface BodyLease {
  payload: Buffer | undefined;
  release: () => void;
}

/** Bound raw bytes before light-my-request/Express receives them, including chunked bodies.
 * A completed body keeps its reservation until dispatch releases it, even if the peer leaves.
 * Node emits aborted response/request errors asynchronously: each stream owns its listener.
 */
export function readLoopbackBody(
  req: IncomingMessage, res: ServerResponse, budget: LoopbackBodyBudget,
): Promise<BodyLease | null> {
  return new Promise((resolve) => {
    let chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      budget.release(bytes);
      chunks = [];
    };
    const rejectBody = (status: number, message: string): void => {
      if (settled) return;
      settled = true;
      release();
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      try {
        if (!res.destroyed && !res.writableEnded) {
          res.statusCode = status;
          res.setHeader('Connection', 'close');
          res.end(message);
        }
      } catch { /* The peer may have closed while the rejection was being written. */ }
      req.resume();
      resolve(null);
    };
    const onData = (chunk: Buffer): void => {
      if (settled) return;
      if (chunk.length > budget.limits.requestBytes - bytes) {
        rejectBody(413, 'Request body too large');
        return;
      }
      if (!budget.acquire(chunk.length)) {
        rejectBody(503, 'Request buffering capacity exceeded');
        return;
      }
      bytes += chunk.length;
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      if (settled) return;
      try {
        const payload = bytes > 0 ? Buffer.concat(chunks, bytes) : undefined;
        chunks = [];
        settled = true;
        resolve({ payload, release });
      } catch {
        rejectBody(500, 'Request buffering failed');
      }
    };
    // Keep error listeners alive through teardown; removing them before close can itself crash Node.
    req.on('error', () => rejectBody(400, 'Request read failed'));
    req.once('aborted', () => rejectBody(400, 'Request aborted'));
    req.once('close', () => { if (!req.complete) rejectBody(400, 'Request closed'); });
    res.on('error', () => rejectBody(400, 'Response closed'));
    res.once('close', () => { if (!settled) rejectBody(400, 'Response closed'); });
    const declared = Number(req.headers['content-length']);
    if (declared > budget.limits.requestBytes) { rejectBody(413, 'Request body too large'); return; }
    req.on('data', onData);
    req.once('end', onEnd);
  });
}
