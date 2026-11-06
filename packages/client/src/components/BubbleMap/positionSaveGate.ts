/** Skip unchanged coordinate writes only after a successful response. Failed,
 * out-of-order, and unacknowledged unload writes must remain retryable. */
export class PositionSaveGate {
  private confirmedBody: string | null = null;
  private nextTicket = 0;
  private readonly pending = new Map<number, string>();

  begin(body: string): number | null {
    if (this.pending.size > 0) {
      let latestBody: string | undefined;
      for (const pendingBody of this.pending.values()) latestBody = pendingBody;
      if (latestBody === body) return null;
    } else if (this.confirmedBody === body) {
      return null;
    }
    const ticket = ++this.nextTicket;
    this.pending.set(ticket, body);
    return ticket;
  }

  settle(ticket: number, ok: boolean): void {
    const body = this.pending.get(ticket);
    if (body === undefined) return;
    this.pending.delete(ticket);
    // An older request finishing last can have overwritten a newer position.
    // Conservatively resend on the next flush instead of assuming ordering.
    this.confirmedBody = ok && ticket === this.nextTicket ? body : null;
  }

  needsUnloadFlush(body: string): boolean {
    // A normal pending fetch may be cancelled by teardown. Keep the existing
    // beacon/keepalive last-write path until the response has been acknowledged.
    return this.pending.size > 0 || this.confirmedBody !== body;
  }
}
