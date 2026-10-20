import type { CreationLink } from '@vibisual/shared';
import type { AppServerHost } from '../host.js';
import type { VideoDoc } from '../types.js';

/** One reference per creation-sourced asset the timeline actually uses (targets = the items using it). */
export function videoCreationLinks(doc: VideoDoc): CreationLink[] {
  return Object.values(doc.assets).flatMap(asset => {
    const ref = asset.creationSource;
    const targets = doc.tracks.flatMap(track => track.items.filter(item => item.assetId === asset.id).map(item => item.id));
    return ref && targets.length ? [{ id: asset.id, sourceId: ref.id, sourceRevision: ref.revision, role: asset.kind, targets }] : [];
  });
}

/** Rapid saves of one document fold into one index write after this quiet period. */
export const VIDEO_SOURCE_SYNC_DELAY_MS = 1_500;

interface Waiting { host: AppServerHost; project: string; doc: VideoDoc; signature: string }

/**
 * §5.13 (R-10) — keeps the creation index (mirror) of a video document's references current.
 *
 * - Only the references are indexed (title + links); the video document stays the owner of its content.
 * - Bursts of saves are coalesced: the latest document wins after a short quiet period.
 * - Nothing is sent when title and links did not change since the last successful sync.
 * - Writes for one document are serialized; a failure is reported by `status` and retried by the next save.
 */
export class VideoSourceSync {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly waiting = new Map<string, Waiting>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly failures = new Map<string, string>();
  private readonly synced = new Map<string, string>();
  constructor(private readonly delayMs = VIDEO_SOURCE_SYNC_DELAY_MS) {}

  private key(project: string, id: string): string { return `${project}\0${id}`; }
  private signature(doc: VideoDoc): string { return JSON.stringify([doc.title, videoCreationLinks(doc)]); }

  enqueue(host: AppServerHost, project: string, doc: VideoDoc): void {
    if (!host.syncCreationSource) return;
    const key = this.key(project, doc.id);
    const signature = this.signature(doc);
    if (this.synced.get(key) === signature && !this.waiting.has(key)) return;
    this.waiting.set(key, { host, project, doc, signature });
    const old = this.timers.get(key);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => this.flush(key), this.delayMs);
    (timer as { unref?: () => void }).unref?.();
    this.timers.set(key, timer);
  }
  /** Opening a document repairs an index written by an older version — once per document per process. */
  ensure(host: AppServerHost, project: string, doc: VideoDoc): void {
    if (!this.synced.has(this.key(project, doc.id)) && !this.waiting.has(this.key(project, doc.id))) this.enqueue(host, project, doc);
  }
  private flush(key: string): void {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
    const job = this.waiting.get(key);
    if (!job) return;
    this.waiting.delete(key);
    const operation = (this.pending.get(key) ?? Promise.resolve()).then(async () => {
      if (this.synced.get(key) === job.signature) return;
      try {
        await job.host.syncCreationSource?.(job.project, { key: job.doc.id, appId: 'vibistudio', title: job.doc.title, links: videoCreationLinks(job.doc) });
        this.failures.delete(key);
        this.synced.set(key, job.signature);
      } catch (error) {
        const message = String(error);
        this.failures.set(key, message);
        job.host.warn(`[video] Source links could not be synchronized: ${message}`);
      }
    });
    this.pending.set(key, operation);
    void operation.finally(() => { if (this.pending.get(key) === operation) this.pending.delete(key); });
  }
  /** Flushes a waiting sync now and reports the outcome. */
  async status(project: string, id: string): Promise<{ ok: boolean; error?: string }> {
    const key = this.key(project, id);
    if (this.waiting.has(key)) this.flush(key);
    await this.pending.get(key);
    const error = this.failures.get(key);
    return error ? { ok: false, error } : { ok: true };
  }
}
