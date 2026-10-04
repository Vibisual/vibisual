import type { CodexTransportNotice } from './types.js';

/** Only Codex's explicit recovery messages are notices; other failures stay errors. */
export function parseCodexTransportNotice(content: string): CodexTransportNotice | null {
  if (/[\r\n]/.test(content)) return null;
  const reconnect = /^Reconnecting\.\.\. ([1-9]\d*)\/([1-9]\d*) \(\S[^\r\n]*\)$/.exec(content);
  if (reconnect) {
    const attempt = Number(reconnect[1]);
    const maxAttempts = Number(reconnect[2]);
    if (Number.isSafeInteger(attempt) && Number.isSafeInteger(maxAttempts) && attempt <= maxAttempts) {
      return { kind: 'reconnecting', attempt, maxAttempts };
    }
    return null;
  }
  return /^Falling back from WebSockets to HTTPS transport\. \S[^\r\n]*$/.test(content)
    ? { kind: 'fallback' }
    : null;
}

/** Read both new system notices and older persisted error records without matching AI/tool text. */
export function readCodexTransportNotice(event: { eventType: string; content: string }): CodexTransportNotice | null {
  if (event.eventType !== 'error' && event.eventType !== 'system') return null;
  return parseCodexTransportNotice(event.content);
}
