import * as fs from 'node:fs';
import * as path from 'node:path';
import { CODEX_MODELS_CACHE_FILENAME, CODEX_MODELS_REFRESH_INTERVAL_MS } from '@vibisual/shared';
import type { CodexModelEntry, CodexModelCatalog } from '@vibisual/shared';
import { codexHome, getCodexBin } from './codexCli.js';
import { codexAuthService } from './codexAuthService.js';
import { parseCodexModelsCache } from './codexModelCatalog.js';
import { queryCodexModelList } from './codexModelRpc.js';
import { CODEX_MODEL_DISCOVERY } from './codexModelRpcConfig.js';
import { pathKey } from './pathKey.js';
import { logger } from '../logger.js';

export { parseCodexModelsCache } from './codexModelCatalog.js';

interface CatalogContext {
  bin: string | null;
  home: string;
  key: string;
  /** Unknown auth probes omit this, preserving the last known identity. Never contains tokens. */
  authKey?: string;
}

interface CatalogDependencies {
  context: () => CatalogContext;
  query: (bin: string, home: string) => Promise<CodexModelEntry[]>;
  cache: (home: string) => CodexModelEntry[];
  now: () => number;
}

function fileRevision(file: string): string {
  try { const stat = fs.statSync(file); return `${stat.mtimeMs}:${stat.size}`; }
  catch { return 'unavailable'; }
}

function currentContext(): CatalogContext {
  const bin = getCodexBin();
  const home = codexHome();
  const auth = codexAuthService.get();
  return {
    bin, home,
    key: JSON.stringify([bin ? pathKey(bin) : null, bin ? fileRevision(bin) : null,
      pathKey(home), fileRevision(path.join(home, 'config.toml'))]),
    ...(auth && !auth.error ? { authKey: JSON.stringify([auth.loggedIn, auth.authMethod, auth.account]) } : {}),
  };
}

/** Read-only fallback. No credentials or Codex settings are modified. */
function readCache(home: string): CodexModelEntry[] {
  try { return parseCodexModelsCache(fs.readFileSync(path.join(home, CODEX_MODELS_CACHE_FILENAME), 'utf8')); }
  catch { return []; }
}

export function codexModelsCachePath(): string {
  return path.join(codexHome(), CODEX_MODELS_CACHE_FILENAME);
}

/** Official discovery is primary; a catalog never proves inference entitlement. */
export class CodexModelService {
  private cached: CodexModelCatalog | null = null;
  private inflight: { key: string; generation: number; promise: Promise<CodexModelCatalog> } | null = null;
  private contextKey: string | undefined;
  private authKey = '';
  private generation = 0;
  private readonly deps: CatalogDependencies;

  constructor(deps: Partial<CatalogDependencies> = {}) {
    this.deps = { context: currentContext, query: queryCodexModelList, cache: readCache, now: Date.now, ...deps };
  }

  private context(): CatalogContext {
    const context = this.deps.context();
    this.authKey = context.authKey ?? this.authKey;
    const key = JSON.stringify([context.key, this.authKey]);
    if (this.contextKey !== key) {
      this.invalidate();
      this.contextKey = key;
    }
    return { ...context, key };
  }

  /** Login/logout events can invalidate even when login status doesn't expose an account id. */
  invalidate(): void {
    this.generation++;
    this.cached = null;
    this.inflight = null;
  }

  /** Synchronous compatibility for snapshot readers; detected account/runtime changes clear it. */
  get(): CodexModelCatalog | null {
    this.context();
    return this.cached;
  }

  /** Publish inside the identity check's synchronous boundary. Consumers must update their
   * snapshot/HTTP response synchronously here, not in a later await/then after refresh().
   */
  publish(consume: (catalog: CodexModelCatalog) => void, options: { force?: boolean } = {}): Promise<void> {
    return this.refresh(options).then((catalog) => {
      // refresh's promise can settle just before login invalidation. Rejoin the current lookup
      // instead of letting that previously valid object escape through a response callback.
      if (catalog !== this.get()) return this.publish(consume);
      consume(catalog);
    });
  }

  refresh(options: { force?: boolean } = {}): Promise<CodexModelCatalog> {
    const context = this.context();
    const generation = this.generation;
    if (this.inflight?.key === context.key && this.inflight.generation === generation) return this.inflight.promise;
    const ttl = this.cached?.stale ? CODEX_MODEL_DISCOVERY.retryMs : CODEX_MODELS_REFRESH_INTERVAL_MS;
    if (!options.force && this.cached && this.deps.now() - this.cached.checkedAt < ttl) return Promise.resolve(this.cached);
    const previous = this.cached;
    const promise = this.probe(context, previous).then((catalog) => {
      // A late response from another login/home/runtime must never overwrite or return its catalog.
      const current = this.context();
      if (generation !== this.generation || current.key !== context.key) return this.refresh();
      this.cached = catalog;
      return catalog;
    }).finally(() => {
      if (this.inflight?.promise === promise) this.inflight = null;
    });
    this.inflight = { key: context.key, generation, promise };
    return promise;
  }

  private async probe(context: CatalogContext, previous: CodexModelCatalog | null): Promise<CodexModelCatalog> {
    try {
      if (!context.bin) throw new Error('Codex CLI unavailable');
      const discovered = await this.deps.query(context.bin, context.home);
      // RPC owns membership/defaults/efforts. The legacy cache only fills verbosity metadata
      // absent from older model/list schemas, retaining the existing advanced-settings labels.
      const cached = new Map(this.deps.cache(context.home).map((model) => [model.slug, model]));
      const models = discovered.map((model): CodexModelEntry => {
        const fallback = cached.get(model.slug);
        return {
          ...model,
          ...(model.supportsVerbosity === undefined && fallback?.supportsVerbosity !== undefined
            ? { supportsVerbosity: fallback.supportsVerbosity } : {}),
          ...(model.defaultVerbosity === undefined && fallback?.defaultVerbosity !== undefined
            ? { defaultVerbosity: fallback.defaultVerbosity } : {}),
        };
      });
      const now = this.deps.now();
      // A successful empty list is authoritative; retired cache entries must not reappear.
      return { models, checkedAt: now, fetchedAt: now, source: 'app-server', stale: false };
    } catch {
      const checkedAt = this.deps.now();
      const error = context.bin ? 'Codex model catalog unavailable' : 'Codex CLI unavailable';
      logger.debug(`[codexModels] ${error}; using read-only fallback`);
      if (previous?.source === 'app-server') return { ...previous, checkedAt, stale: true, error };
      const models = this.deps.cache(context.home);
      return { models, checkedAt, source: 'cache', stale: true, error };
    }
  }

  reasoningLevelsOf(slug: string): string[] {
    return this.get()?.models.find((model) => model.slug === slug)?.reasoningLevels ?? [];
  }
}

export const codexModelService = new CodexModelService();
