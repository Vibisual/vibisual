import type { CodexInventory } from '@vibisual/shared';

/** Agent identity and its current project both belong to an inventory request. */
export function codexInventoryScopeKey(state: {
  agentProjects: Record<string, string>;
  activeProject: string | null;
}, agentId?: string | null): string {
  return JSON.stringify([agentId ?? null, (agentId ? state.agentProjects[agentId] : undefined) ?? state.activeProject]);
}

interface PendingInventory {
  promise: Promise<CodexInventory | null>;
  isCurrent: () => boolean;
  queuedForce?: Promise<CodexInventory | null>;
}

/** Coalesce each scope independently; an explicit reload follows any pending read. */
export class CodexInventoryClient {
  private readonly pending = new Map<string, PendingInventory>();

  constructor(private readonly request: typeof fetch = (...args) => fetch(...args)) {}

  refresh(scope: string, agentId: string | undefined, force: boolean, isCurrent: () => boolean): Promise<CodexInventory | null> {
    let pending = this.pending.get(scope);
    if (pending && !pending.isCurrent()) {
      this.pending.delete(scope);
      pending = undefined;
    }
    if (pending?.queuedForce) return pending.queuedForce;
    if (pending) {
      if (!force) return pending.promise;
      const owner = pending;
      // The queued caller keeps watching ownership after the initial caller settles.
      pending.isCurrent = isCurrent;
      pending.queuedForce = pending.promise.then(() => this.start(scope, agentId, isCurrent)).finally(() => {
        // An invalidated queued request never replaces its original reservation.
        if (this.pending.get(scope) === owner) this.pending.delete(scope);
      });
      return pending.queuedForce;
    }
    return this.start(scope, agentId, isCurrent);
  }

  private start(scope: string, agentId: string | undefined, isCurrent: () => boolean): Promise<CodexInventory | null> {
    // The server resolves cwd from agentId when this deferred request actually starts.
    if (!isCurrent()) return Promise.resolve(null);
    const promise = this.read(agentId).finally(() => {
      const pending = this.pending.get(scope);
      // Keep a queued reload reserved while consumers publish the initial result.
      if (pending?.promise === promise && !pending.queuedForce) this.pending.delete(scope);
    });
    this.pending.set(scope, { promise, isCurrent });
    return promise;
  }

  private async read(agentId: string | undefined): Promise<CodexInventory | null> {
    try {
      const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
      const response = await this.request(`/api/codex-inventory/refresh${query}`, { method: 'POST' });
      if (!response.ok) return null;
      const inventory = await response.json() as CodexInventory;
      return inventory && ['skills', 'mcpServers', 'plugins', 'hooks', 'agentsDocs'].every(
        (field) => Array.isArray(inventory[field as keyof CodexInventory]),
      ) ? inventory : null;
    } catch {
      return null;
    }
  }
}

export const codexInventoryClient = new CodexInventoryClient();
