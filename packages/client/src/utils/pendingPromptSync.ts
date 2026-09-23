/** A restore owns only the ids untouched since its GET began. Journals live for one GET, not forever. */
class PendingPromptSync {
  private restore: Set<string> | null = null;
  private decisions = new Map<string, symbol>();

  begin(): Set<string> { const ticket = new Set<string>(); this.restore = ticket; return ticket; }
  cancel(ticket: Set<string>): void { if (this.restore === ticket) this.restore = null; }
  changed(id: string): void { this.restore?.add(id); }
  resolved(id: string): void { this.changed(id); this.decisions.delete(id); }
  deciding(id: string): boolean { return this.decisions.has(id); }
  decide(id: string): symbol { const token = Symbol(id); this.decisions.set(id, token); return token; }
  settled(id: string, token: symbol): boolean {
    if (this.decisions.get(id) !== token) return false;
    this.decisions.delete(id);
    this.changed(id);
    return true;
  }

  merge<T extends { requestId: string }>(ticket: Set<string>, list: T[], current: Record<string, T>): T[] | null {
    if (this.restore !== ticket) return null;
    this.restore = null;
    const next = Object.fromEntries(list.map((r) => [r.requestId, r]));
    for (const id of ticket) {
      if (current[id]) next[id] = current[id];
      else delete next[id];
    }
    for (const id of this.decisions.keys()) {
      // A newer authoritative snapshot can confirm resolution even if its WS event was missed.
      if (!next[id] && !ticket.has(id)) this.decisions.delete(id);
      delete next[id]; // Do not offer a second answer while the first POST is pending.
    }
    return Object.values(next);
  }
}

export const permissionPromptSync = new PendingPromptSync();
export const askQuestionPromptSync = new PendingPromptSync();
