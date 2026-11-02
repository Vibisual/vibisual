/** Codex emits this resume advisory as a top-level `error` while the turn continues. */
export function isCodexModelResumeNotice(content: string): boolean {
  // Match the complete advisory, including its repeated original model. Other
  // model errors and diagnostics with an appended failure must remain errors.
  return !/[\r\n]/.test(content)
    && /^This session was recorded with model `([^\s`]+)` but is resuming with `([^\s`]+)`\. Consider switching back to `\1` as it may affect Codex performance\.$/.test(content);
}

const CODE_MODE_HOST_PREFIX = 'Code Mode is unavailable because failed to spawn code-mode host ';
const CODE_MODE_HOST_SUFFIX = ': host executable was not found. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.';

/** Known nonfatal exec diagnostics; an unavailable optional feature still stays visible. */
export function isCodexSessionNotice(content: string): boolean {
  if (/[\r\n]/.test(content)) return false;
  if (isCodexModelResumeNotice(content)
    || /^Configured service tier `([^\s`]+)` is not advertised as supported for model `([^\s`]+)` and will be omitted from requests\.$/.test(content)) return true;
  if (!content.startsWith(CODE_MODE_HOST_PREFIX) || !content.endsWith(CODE_MODE_HOST_SUFFIX)) return false;
  return content.slice(CODE_MODE_HOST_PREFIX.length, -CODE_MODE_HOST_SUFFIX.length).trim().length > 0;
}

/** Legacy nested error responses were stored as JSON; normalize only recognized notices. */
export function readCodexSessionNotice(event: { eventType: string; content: string }): string | null {
  if (event.eventType !== 'error' && event.eventType !== 'system') return null;
  if (isCodexSessionNotice(event.content)) return event.content;
  if (event.eventType !== 'error' || !event.content.trimStart().startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(event.content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record['type'] !== 'error') return null;
    const nested = record['error'];
    const body = nested && typeof nested === 'object' && !Array.isArray(nested)
      ? nested as Record<string, unknown> : undefined;
    const message = typeof record['message'] === 'string' && record['message']
      ? record['message'] : typeof body?.['message'] === 'string' ? body['message'] : '';
    return isCodexSessionNotice(message) ? message : null;
  } catch { return null; }
}
