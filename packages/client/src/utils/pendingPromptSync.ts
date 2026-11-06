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

/**
 * §5.3 #12-1 · #12-2 — 카드 답 POST 의 결과. status 가 null 이면 응답을 못 받았다(통신 실패·응답 유실).
 * 404 는 이미 풀린 카드(되살리지 않는다), 그 밖의 4xx 는 서버가 받지 않았다, 5xx·무응답은 받았는지 모른다(서버 대기 목록과 대조).
 */
export type PromptSendOutcome = 'accepted' | 'gone' | 'rejected' | 'unconfirmed';

export function promptSendOutcome(status: number | null): PromptSendOutcome {
  if (status === null) return 'unconfirmed';
  if (status >= 200 && status < 300) return 'accepted';
  if (status === 404) return 'gone';
  if (status >= 400 && status < 500) return 'rejected';
  return 'unconfirmed';
}

/** 되돌아온 카드가 안내할 실패 종류. */
export type PromptSendError = Extract<PromptSendOutcome, 'rejected' | 'unconfirmed'>;
