import type { CodexModelCatalog } from '@vibisual/shared';

/** Per-window request coalescing; the server owns catalog freshness and last-good fallback. */
export class CodexModelCatalogClient {
  private inflight: { force: boolean; promise: Promise<CodexModelCatalog | null> } | null = null;
  private queuedForce: Promise<CodexModelCatalog | null> | null = null;

  constructor(private readonly request: typeof fetch = (...args) => fetch(...args)) {}

  refresh(force: boolean): Promise<CodexModelCatalog | null> {
    // Reserve the queued refresh while the GET settles, including its consumer callbacks.
    if (this.queuedForce) return this.queuedForce;
    if (this.inflight) {
      if (!force || this.inflight.force) return this.inflight.promise;
      // An ordinary GET may only return TTL-cached data. Preserve an explicit refresh
      // by queuing one POST after it; repeated clicks share the same queued request.
      this.queuedForce = this.inflight.promise.then(() => this.start(true))
        .finally(() => { this.queuedForce = null; });
      return this.queuedForce;
    }
    return this.start(force);
  }

  private start(force: boolean): Promise<CodexModelCatalog | null> {
    const promise = this.read(force).finally(() => { this.inflight = null; });
    this.inflight = { force, promise };
    return promise;
  }

  private async read(force: boolean): Promise<CodexModelCatalog | null> {
    try {
      const response = await this.request(force ? '/api/codex-models/refresh' : '/api/codex-models', {
        method: force ? 'POST' : 'GET',
      });
      if (!response.ok) return null;
      const catalog = await response.json() as CodexModelCatalog;
      return catalog && Array.isArray(catalog.models) ? catalog : null;
    } catch {
      // The view retains its last catalog; the next focus/interval/manual request retries.
      return null;
    }
  }
}

export const codexModelCatalogClient = new CodexModelCatalogClient();
