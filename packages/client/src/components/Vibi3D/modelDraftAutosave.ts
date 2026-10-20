import { creationStableJson, type Vibi3DDraft, type Vibi3DDraftReadResult, type Vibi3DDraftSaveInput, type Vibi3DDraftWriteResult } from '@vibisual/shared';
import { ModelDraftApiError, saveModelDraft, type ModelDraftInput, type ModelDraftScope } from './modelDraftApi.js';

export interface ModelDraftSaveState {
  status: 'idle' | 'pending' | 'saving' | 'saved' | 'error';
  editVersion: number;
  savedEditVersion: number;
  version: number;
  savedAt?: number;
  error?: unknown;
  draft?: Vibi3DDraft | null;
}
interface PendingSave { input: Vibi3DDraftSaveInput; editVersion: number }
interface Entry {
  scope: ModelDraftScope;
  state: ModelDraftSaveState;
  latest?: ModelDraftInput;
  request?: PendingSave;
  timer?: ReturnType<typeof setTimeout>;
  running?: Promise<void>;
  captureError?: { error: unknown };
}
export interface ModelDraftAutosaveOptions {
  save?: (projectId: string, input: Vibi3DDraftSaveInput) => Promise<Vibi3DDraftWriteResult>;
  debounceMs?: number;
  onChange?: (scope: ModelDraftScope, state: ModelDraftSaveState) => void;
}
export const modelDraftScopeKey = (scope: ModelDraftScope): string => JSON.stringify([scope.projectId, scope.key, scope.actor]);

/** One writer per project/source/actor. A failed write keeps its exact body/id until its receipt is known. */
export class ModelDraftAutosave {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private readonly save: NonNullable<ModelDraftAutosaveOptions['save']>;

  constructor(private readonly options: ModelDraftAutosaveOptions = {}) { this.save = options.save ?? saveModelDraft; }

  private entry(scope: ModelDraftScope): Entry {
    const key = modelDraftScopeKey(scope);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { scope: { ...scope }, state: { status: 'idle', editVersion: 0, savedEditVersion: 0, version: 0 } };
      this.entries.set(key, entry);
    }
    return entry;
  }

  private update(entry: Entry, patch: Partial<ModelDraftSaveState>): void {
    entry.state = { ...entry.state, ...patch };
    if (this.disposed) return;
    this.options.onChange?.(entry.scope, entry.state);
    this.listeners.forEach(listener => listener());
  }

  get(scope: ModelDraftScope): ModelDraftSaveState { return this.entry(scope).state; }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Adopt a read/restore/delete receipt only while no local edits or writes are outstanding. */
  hydrate(scope: ModelDraftScope, receipt: Vibi3DDraftReadResult): boolean {
    const entry = this.entry(scope);
    if (entry.running || entry.request || entry.state.editVersion !== entry.state.savedEditVersion) return false;
    if (receipt.version < entry.state.version) return false;
    this.update(entry, {
      version: receipt.version, draft: receipt.draft ? structuredClone(receipt.draft) : null,
      status: receipt.draft ? 'saved' : 'idle', savedAt: receipt.draft?.updatedAt, error: undefined,
    });
    return true;
  }

  /** Capture now; mutable scene objects cannot change the body of an in-flight request or its retry. */
  set(scope: ModelDraftScope, input: ModelDraftInput, options: { immediate?: boolean } = {}): void {
    if (this.disposed) throw new Error('draft-autosave-disposed');
    const entry = this.entry(scope);
    entry.latest = structuredClone(input);
    const captureFailed = !!entry.captureError;
    entry.captureError = undefined;
    clearTimeout(entry.timer);
    entry.timer = undefined;
    this.update(entry, { editVersion: entry.state.editVersion + 1,
      status: entry.state.status === 'error' && !captureFailed ? 'error' : entry.running ? 'saving' : 'pending' });
    if (options.immediate) { void this.flush(scope).catch(() => undefined); }
    else if (entry.state.status !== 'error') {
      entry.timer = setTimeout(() => { void this.flush(scope).catch(() => undefined); }, this.options.debounceMs ?? 700);
    }
  }

  /** A serialization failure must remain visible and prevent close from claiming that work is saved. */
  fail(scope: ModelDraftScope, error: unknown): void {
    const entry = this.entry(scope);
    clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.captureError = { error };
    this.update(entry, { status: 'error', error, editVersion: entry.state.editVersion + 1 });
  }

  retry(scope: ModelDraftScope): Promise<void> { return this.flush(scope); }

  /** A conflict can move to a new local identity, but never drop the old pending work before its copy is durable. */
  retireAfterBackup(scope: ModelDraftScope, backupScope: ModelDraftScope): boolean {
    if (scope.projectId !== backupScope.projectId || scope.actor !== backupScope.actor || scope.key === backupScope.key) return false;
    const key = modelDraftScopeKey(scope);
    const original = this.entries.get(key), backup = this.entries.get(modelDraftScopeKey(backupScope));
    if (!original || !backup || original.running || backup.running || backup.request || backup.captureError
      || backup.state.status !== 'saved' || backup.state.editVersion !== backup.state.savedEditVersion
      || !backup.state.draft || backup.state.draft.version !== backup.state.version) return false;
    // A newer capture after the backup began must not be discarded. The comparison uses captured input, before
    // deterministic blob externalization, because a disk receipt may replace inline binaries with references.
    if (original.latest && (!backup.latest || creationStableJson(original.latest) !== creationStableJson(backup.latest))) return false;
    clearTimeout(original.timer);
    this.entries.delete(key);
    if (!this.disposed) this.listeners.forEach(listener => listener());
    return true;
  }

  async flush(scope?: ModelDraftScope): Promise<void> {
    if (!scope) {
      const results = await Promise.allSettled([...this.entries.values()].map(entry => this.flush(entry.scope)));
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failure) throw failure.reason;
      return;
    }
    const entry = this.entry(scope);
    clearTimeout(entry.timer);
    entry.timer = undefined;
    if (entry.running) return entry.running;
    if (entry.captureError) throw entry.captureError.error;
    if (!entry.request && entry.state.editVersion === entry.state.savedEditVersion) {
      if (entry.state.status === 'error') throw entry.state.error;
      return;
    }
    // Install the running promise before executing listeners or transport callbacks (both may reenter flush).
    const running = Promise.resolve().then(() => this.drain(entry));
    entry.running = running;
    try { await running; } finally { if (entry.running === running) entry.running = undefined; }
  }

  private async drain(entry: Entry): Promise<void> {
    while (entry.state.editVersion !== entry.state.savedEditVersion) {
      this.assertCaptured(entry);
      const request = entry.request ?? {
        input: { ...structuredClone(entry.latest!), projectId: entry.scope.projectId, key: entry.scope.key, actor: entry.scope.actor,
          expectedVersion: entry.state.version, requestId: crypto.randomUUID() },
        editVersion: entry.state.editVersion,
      };
      entry.request = request;
      this.update(entry, { status: 'saving', error: undefined });
      try {
        const receipt = await this.save(entry.scope.projectId, request.input);
        if (!receipt.draft || receipt.version !== receipt.savedVersion || receipt.savedVersion !== request.input.expectedVersion + 1
          || receipt.draft.key !== entry.scope.key || receipt.draft.actor !== entry.scope.actor || receipt.draft.version !== receipt.version) {
          throw new ModelDraftApiError('draft-version-conflict', 409, { version: receipt.version });
        }
        entry.request = undefined;
        this.update(entry, {
          version: receipt.version, savedEditVersion: request.editVersion, draft: receipt.draft,
          savedAt: receipt.draft.updatedAt, error: undefined,
          status: request.editVersion === entry.state.editVersion ? 'saved' : 'pending',
        });
        this.assertCaptured(entry);
      } catch (error) {
        this.update(entry, { status: 'error', error });
        throw error;
      }
    }
  }

  private assertCaptured(entry: Entry): void { if (entry.captureError) throw entry.captureError.error; }

  /** Owners flush before disposal; disposal itself never labels pending edits as saved. */
  cancelScheduled(): void { this.entries.forEach(entry => { clearTimeout(entry.timer); entry.timer = undefined; }); }

  dispose(): void {
    this.disposed = true;
    this.cancelScheduled();
    this.listeners.clear();
  }
}
