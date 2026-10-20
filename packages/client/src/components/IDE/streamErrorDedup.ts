import type { SubAgentStreamEvent } from '@vibisual/shared';
import { parseStreamErrorContent } from './commandError.js';

interface ErrorRow {
  index: number;
  event: SubAgentStreamEvent;
  engine: string | undefined;
  typed: boolean;
}

// Preserve future/foreign envelopes instead of treating them as untyped diagnostics.
const ERROR_ENVELOPE = /^\[([A-Za-z]+)(?::-?\d+)?(?:@([A-Za-z]+))?\]\s*/;

/** Display-only coalescing. Raw events and stored command failures remain untouched. */
export class StreamErrorAccumulator {
  private rows = new Map<string, ErrorRow[]>();

  /** Append or replace one error row, without shifting indices used by other accumulators. */
  consume<T>(
    event: SubAgentStreamEvent,
    turnId: string | null,
    items: T[],
    makeItem: (event: SubAgentStreamEvent) => T,
  ): boolean {
    if (event.eventType !== 'error' || turnId === null) return false;
    const envelope = ERROR_ENVELOPE.exec(event.content.trim());
    if (envelope && envelope[1] !== 'cli' && envelope[1] !== 'usageLimit') return false;
    const detail = parseStreamErrorContent(event.content).detail?.trim();
    if (!detail) return false;

    const engine = envelope?.[2];
    const key = JSON.stringify([event.parentAgentId, event.subAgentId, turnId, event.nestedUnderToolUseId ?? null, detail]);
    const rows = this.rows.get(key) ?? [];
    // An unlabelled repeat cannot choose between two explicitly different engines.
    const matches = rows.filter((row) => !row.engine || !engine || row.engine === engine);
    const previous = matches.length === 1 ? matches[0] : undefined;
    if (previous) {
      // Prefer the terminal envelope, which carries the engine and failure classification.
      // Keep the original identity/time so the live transcript does not jump on terminal delivery.
      if (envelope && (!previous.typed || (!previous.engine && engine))) {
        const replacement = { ...event, id: previous.event.id, timestamp: previous.event.timestamp };
        items[previous.index] = makeItem(replacement);
        previous.event = replacement;
        previous.engine = engine;
        previous.typed = true;
      }
      return true;
    }

    rows.push({ index: items.length, event, engine, typed: !!envelope });
    this.rows.set(key, rows);
    items.push(makeItem(event));
    return true;
  }
}
