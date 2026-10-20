import { matchUsageLimitNotice, parseUsageLimitResetLabel } from '@vibisual/shared';
import type { CommandError } from '@vibisual/shared';

export type ProviderErrorKind = 'capacity' | 'rateLimit' | 'usageLimit' | 'authentication' | 'context' | 'billing' | 'modelAccess' | 'unavailable';

export interface ProviderErrorGuidance {
  kind: ProviderErrorKind;
  explanationKey: string;
  actionKey: string;
  links: { href: string; labelKey: string }[];
  resetsLabel?: string;
}

// Only engine-reported failures can receive provider guidance. A local process crash,
// spawn failure, or tool error containing the same words is not a provider response.
const PROVIDER_ERROR_CODES = new Set(['unknown', 'cli', 'exit', 'agentView', 'usageLimit']);

function responseOf(detail: string): { message: string; code: string } {
  const plain = detail.replace(/^(?:API\s+)?Error:\s*/i, '').trim();
  // Both CLIs can prefix a JSON response with a status, e.g. `API Error: 529 {...}`.
  const json = plain.replace(/^(?:HTTP\s+)?\d{3}\s*[-:]?\s*/, '');
  if (json.startsWith('{')) {
    try {
      const body: unknown = JSON.parse(json);
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const outer = body as Record<string, unknown>;
        const inner = outer.error && typeof outer.error === 'object' && !Array.isArray(outer.error)
          ? outer.error as Record<string, unknown> : outer;
        return {
          message: typeof inner.message === 'string' ? inner.message.trim() : plain,
          code: typeof inner.code === 'string' ? inner.code : typeof inner.type === 'string' ? inner.type : '',
        };
      }
    } catch { /* Keep unrecognized payloads intact for the ordinary error display. */ }
  }
  return { message: json, code: json };
}

/** Display-only classification: never changes command status, retries, or account limits. */
export function providerErrorGuidance(error: CommandError): ProviderErrorGuidance | undefined {
  if (!PROVIDER_ERROR_CODES.has(error.code) || error.engine === 'local') return undefined;
  const { message, code } = responseOf(error.detail?.trim() ?? '');
  let kind: ProviderErrorKind | undefined;
  if (error.code === 'usageLimit' || matchUsageLimitNotice(message)) {
    kind = 'usageLimit';
  } else if ((!error.engine || error.engine === 'codex')
    && /^(?:the )?['"]?[\w.-]+['"]? model is not supported when using Codex with a ChatGPT account(?:[.!:\s]|$)/i.test(message)) {
    // This response identifies ChatGPT sign-in, but does not establish a billing failure.
    kind = 'modelAccess';
  } else if (/^(?:insufficient_quota|credit_balance_exhausted|billing_error|(?:organization|project)_(?:spend|usage)_limit_exceeded)$/i.test(code)
    || /^(?:your credit balance is too low|you exceeded your current quota|(?:you have |you've )?reached (?:your |the )?(?:monthly )?(?:spend|spending) limit)\b/i.test(message)) {
    kind = 'billing';
  } else if (/^(?:overloaded_error|server_is_overloaded|model_capacity_exceeded)$/i.test(code)
    || /^(?:(?:the )?selected model is at capacity|(?:the )?(?:model|server|api) is (?:temporarily )?overloaded|overloaded)(?:[.!:\s]|$)/i.test(message)) {
    kind = 'capacity';
  } else if (/^(?:context_length_exceeded|context_window_exceeded)$/i.test(code)
    || /^(?:your input exceeds the context window|(?:this model['’]s )?maximum context length is|prompt is too long|context (?:window|length) (?:exceeded|limit reached))\b/i.test(message)) {
    kind = 'context';
  } else if (/^(?:authentication_error|invalid_api_key|token_expired|invalid_authentication)$/i.test(code)
    || /^(?:incorrect api key provided|invalid api key|oauth token (?:has )?expired|(?:your )?(?:access|authentication) token (?:has )?expired|your authentication token could not be refreshed|not logged in\b.*(?:login|log in|sign in))\b/i.test(message)) {
    kind = 'authentication';
  } else if (/^(?:rate_limit_error|rate_limit_exceeded|slow_down)$/i.test(code)
    || /^(?:rate limit (?:reached|exceeded)|too many requests)(?:[.!:\s]|$)/i.test(message)) {
    kind = 'rateLimit';
  } else if (/^(?:service_unavailable_error|api_error|server_error)$/i.test(code)
    || /^(?:(?:the (?:ai )?)?service (?:is )?(?:temporarily )?unavailable|an unexpected error has occurred internal to Anthropic['’]s systems)(?:[.!:\s]|$)/i.test(message)) {
    kind = 'unavailable';
  }
  if (!kind) return undefined;

  const links: ProviderErrorGuidance['links'] = [];
  // Fixed official destinations only. Never turn arbitrary error-body URLs into trusted links.
  if (kind === 'modelAccess') {
    // The response names the account type even in legacy streams without an engine tag.
    links.push(
      { href: 'https://chatgpt.com/#pricing', labelKey: 'ide.providerNotice.chatgptBilling' },
      { href: 'https://learn.chatgpt.com/docs/models', labelKey: 'ide.providerNotice.documentation' },
    );
  } else if (error.engine === 'codex') {
    links.push({
      href: kind === 'authentication' ? 'https://developers.openai.com/codex/auth'
        : kind === 'usageLimit' ? 'https://developers.openai.com/codex/pricing'
        : 'https://developers.openai.com/api/docs/guides/error-codes',
      labelKey: 'ide.providerNotice.documentation',
    });
    if (kind === 'capacity' || kind === 'unavailable') links.push({ href: 'https://status.openai.com/', labelKey: 'ide.providerNotice.statusPage' });
  } else if (error.engine === 'claude') {
    links.push({
      href: kind === 'authentication' ? 'https://code.claude.com/docs/en/authentication'
        : kind === 'usageLimit' ? 'https://code.claude.com/docs/en/costs'
        : 'https://platform.claude.com/docs/en/api/errors',
      labelKey: 'ide.providerNotice.documentation',
    });
    if (kind === 'capacity' || kind === 'unavailable') links.push({ href: 'https://status.claude.com/', labelKey: 'ide.providerNotice.statusPage' });
  }
  const resetsLabel = kind === 'usageLimit' ? parseUsageLimitResetLabel(message) : undefined;
  return {
    kind,
    explanationKey: `ide.providerNotice.${kind}.explanation`,
    actionKey: `ide.providerNotice.${kind}.action`,
    links,
    ...(resetsLabel ? { resetsLabel } : {}),
  };
}
