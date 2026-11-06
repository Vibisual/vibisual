import type { SubAgentStreamEvent } from '@vibisual/shared';
import { parseStreamErrorContent } from './commandError.js';
import { parseProviderErrorResponse, providerErrorGuidance, type ProviderErrorKind } from './providerError.js';

interface ErrorDiagnostic {
  detail: string;
  message: string;
  structured: boolean;
  kind: ProviderErrorKind | undefined;
}

interface ErrorRow {
  index: number;
  event: SubAgentStreamEvent;
  engine: string | undefined;
  typed: boolean;
  diagnostic: ErrorDiagnostic;
}

// Preserve future/foreign envelopes instead of treating them as untyped diagnostics.
const ERROR_ENVELOPE = /^\[([A-Za-z]+)(?::-?\d+)?(?:@([A-Za-z]+))?\]\s*/;

function diagnosticOf(content: string): ErrorDiagnostic | undefined {
  const error = parseStreamErrorContent(content);
  const detail = error.detail?.trim();
  if (!detail) return undefined;
  const { message, structured } = parseProviderErrorResponse(detail);
  return { detail, message, structured, kind: providerErrorGuidance(error)?.kind };
}

function sameDiagnostic(a: ErrorDiagnostic, b: ErrorDiagnostic): boolean {
  if (a.detail === b.detail) return true;
  // A structured response and its terminal message are two forms of one failure.
  // Never collapse separate JSON payloads or merely the same guidance category.
  if (a.structured === b.structured || !a.kind || a.kind !== b.kind) return false;
  return a.structured ? a.message === b.detail : b.message === a.detail;
}

/** Display-only coalescing. Raw events and stored command failures remain untouched. */
export class StreamErrorAccumulator {
  private rows = new Map<string, ErrorRow[]>();

  /** Append or replace one error row, without shifting indices used by other accumulators. */
  consume<T>(
    event: SubAgentStreamEvent,
    turnId: string | null,
    items: T[],
    makeItem: (event: SubAgentStreamEvent) => T,
    previousEvent?: SubAgentStreamEvent,
  ): boolean {
    if (event.eventType !== 'error') return false;
    const envelope = ERROR_ENVELOPE.exec(event.content.trim());
    if (envelope && envelope[1] !== 'cli' && envelope[1] !== 'usageLimit') return false;
    const diagnostic = diagnosticOf(event.content);
    if (!diagnostic) return false;
    const { detail } = diagnostic;

    // Older terminal errors were emitted after the active turn was cleared. When
    // command anchors are gone, only an immediately preceding, stamped raw copy
    // proves ownership. Never cross activity, a known command boundary or a task.
    if (turnId === null && envelope && previousEvent?.eventType === 'error'
      && previousEvent.turnId && !ERROR_ENVELOPE.test(previousEvent.content.trim())
      && previousEvent.parentAgentId === event.parentAgentId
      && previousEvent.subAgentId === event.subAgentId
      && previousEvent.nestedUnderToolUseId === event.nestedUnderToolUseId) {
      const previousDiagnostic = diagnosticOf(previousEvent.content);
      if (previousDiagnostic && sameDiagnostic(previousDiagnostic, diagnostic)) turnId = previousEvent.turnId;
    }
    if (turnId === null) return false;

    const engine = envelope?.[2];
    const key = JSON.stringify([
      event.parentAgentId, event.subAgentId, turnId, event.nestedUnderToolUseId ?? null,
      diagnostic.structured ? diagnostic.message : detail,
    ]);
    const rows = this.rows.get(key) ?? [];
    // An unlabelled repeat cannot choose between two explicitly different engines.
    const matches = rows.filter((row) => (!row.engine || !engine || row.engine === engine)
      && sameDiagnostic(row.diagnostic, diagnostic)
      && (row.diagnostic.detail === detail || row.typed || !!envelope));
    const previous = matches.length === 1 ? matches[0] : undefined;
    if (previous) {
      // Prefer the terminal envelope, which carries the engine and failure classification.
      // Keep the original identity/time so the live transcript does not jump on terminal delivery.
      const promoteEnvelope = !!envelope && (!previous.typed || (!previous.engine && !!engine));
      const promoteDiagnostic = diagnostic.structured && !previous.diagnostic.structured;
      if (promoteEnvelope || promoteDiagnostic) {
        const source = promoteEnvelope ? event : previous.event;
        const retained = previous.diagnostic.structured ? previous.diagnostic : diagnostic;
        const prefix = ERROR_ENVELOPE.exec(source.content.trim())?.[0].trim();
        const replacement = {
          ...source, id: previous.event.id, timestamp: previous.event.timestamp,
          content: prefix ? `${prefix} ${retained.detail}` : retained.detail,
        };
        items[previous.index] = makeItem(replacement);
        previous.event = replacement;
        previous.diagnostic = retained;
        if (promoteEnvelope) {
          previous.engine = engine;
          previous.typed = true;
        }
      }
      return true;
    }

    rows.push({ index: items.length, event, engine, typed: !!envelope, diagnostic });
    this.rows.set(key, rows);
    items.push(makeItem(event));
    return true;
  }
}
