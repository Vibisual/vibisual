import { describe, expect, it } from 'vitest';
import type { CommandError } from '@vibisual/shared';
import { describeCommandError, parseStreamErrorContent } from './commandError.js';
import { providerErrorGuidance } from './providerError.js';

const capacity = 'Selected model is at capacity. Please try a different model.';
const modelAccessMessage = "The 'gpt-6-astra' model is not supported when using Codex with a ChatGPT account.";
const modelAccessResponse = JSON.stringify({ type: 'error', status: 400, error: { type: 'invalid_request_error', message: modelAccessMessage } });
const error = (detail: string, engine: CommandError['engine'] = 'codex'): CommandError => ({ code: 'cli', engine, detail });

describe('provider response guidance', () => {
  it.each([
    modelAccessMessage,
    modelAccessResponse,
    `API Error: 400 ${modelAccessResponse}`,
    modelAccessMessage.replace("'gpt-6-astra'", '"gpt-6.1-sol"'),
  ])('explains ChatGPT model access without diagnosing expired billing: %s', (detail) => {
    const desc = describeCommandError(error(detail));
    expect(desc.labelKey).toBe('ide.providerNotice.modelAccess.title');
    expect(desc.guidance).toMatchObject({
      kind: 'modelAccess',
      links: [
        { href: 'https://chatgpt.com/#pricing', labelKey: 'ide.providerNotice.chatgptBilling' },
        { href: 'https://learn.chatgpt.com/docs/models', labelKey: 'ide.providerNotice.documentation' },
      ],
    });
    expect(desc.guidance?.resetsLabel).toBeUndefined();
    expect(desc.detail).toBe(detail);
  });

  it('handles tagged and legacy untagged Codex model-access stream errors', () => {
    for (const content of [modelAccessResponse, `[cli@codex] ${modelAccessResponse}`, `[exit:1@codex] ${modelAccessMessage}`]) {
      expect(describeCommandError(parseStreamErrorContent(content)).guidance?.kind).toBe('modelAccess');
    }
  });

  it('does not send other providers or unrelated invalid requests to ChatGPT billing', () => {
    for (const engine of ['claude', 'local'] as const) {
      expect(providerErrorGuidance(error(modelAccessResponse, engine))).toBeUndefined();
    }
    for (const code of ['spawn', 'stdin', 'crash', 'local', 'maxTurns'] as const) {
      expect(providerErrorGuidance({ code, engine: 'codex', detail: modelAccessResponse })).toBeUndefined();
    }
    for (const detail of [
      'HTTP 400',
      '{"error":{"type":"invalid_request_error","message":"Invalid parameter"}}',
      "The 'gpt-6-astra' model is not supported with this API key.",
      `Test failed: expected ${modelAccessMessage}`,
    ]) expect(providerErrorGuidance(error(detail))).toBeUndefined();
  });

  it('explains the reported Codex capacity response without calling it a usage limit', () => {
    for (const content of [capacity, `[cli@codex] ${capacity}`]) {
      const desc = describeCommandError(parseStreamErrorContent(content));
      expect(desc.labelKey).toBe('ide.providerNotice.capacity.title');
      expect(desc.guidance?.kind).toBe('capacity');
      expect(desc.detail).toBe(capacity);
    }
  });

  it.each([
    ['API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', 'capacity'],
    ['API Error: 529 Overloaded', 'capacity'],
    ['API Error: 401 Invalid API key', 'authentication'],
    ['HTTP 503 Service unavailable', 'unavailable'],
    ['API Error: 429 {"error":{"type":"rate_limit_error","message":"This request would exceed your organization rate limit"}}', 'rateLimit'],
    ['{"error":{"code":"insufficient_quota","type":"rate_limit_error","message":"You exceeded your current quota"}}', 'billing'],
    ['API Error: 401 {"error":{"type":"authentication_error","message":"Invalid bearer token"}}', 'authentication'],
    ['API Error: 400 {"error":{"type":"invalid_request_error","message":"prompt is too long: 210000 tokens > 200000 maximum"}}', 'context'],
    ['{"error":{"code":"context_length_exceeded","message":"Input too long"}}', 'context'],
    ['{"error":{"type":"api_error","message":"Internal server error"}}', 'unavailable'],
    ['Rate limit reached for model on tokens per min', 'rateLimit'],
    ['Your input exceeds the context window of this model. Please adjust your input and try again.', 'context'],
    ['Your authentication token could not be refreshed because your refresh token was already used. Please log out and sign in again.', 'authentication'],
  ])('recognizes %s', (detail, kind) => {
    const desc = describeCommandError(error(detail, 'claude'));
    expect(desc.guidance?.kind).toBe(kind);
    expect(desc.detail).toBe(detail);
  });

  it('preserves quota reset wording without inventing a time', () => {
    const limited = error("You've hit your session limit · resets 10pm (Asia/Seoul)", 'claude');
    expect(providerErrorGuidance(limited)).toMatchObject({ kind: 'usageLimit', resetsLabel: '10pm (Asia/Seoul)' });
    expect(providerErrorGuidance(error("You've hit your usage limit."))?.resetsLabel).toBeUndefined();
  });

  it('keeps local and process failures as errors even if their detail mentions capacity', () => {
    for (const code of ['spawn', 'stdin', 'crash', 'local', 'maxTurns'] as const) {
      expect(providerErrorGuidance({ code, engine: 'codex', detail: capacity })).toBeUndefined();
    }
    expect(providerErrorGuidance(error(capacity, 'local'))).toBeUndefined();
  });

  it.each(['HTTP 429', 'HTTP 503', 'connection failed', 'Test failed: expected "Selected model is at capacity"', 'disk capacity exceeded', 'Error: unknown failure'])('does not invent a provider diagnosis for %s', (detail) => {
    expect(providerErrorGuidance(error(detail))).toBeUndefined();
    expect(describeCommandError(error(detail)).detail).toBe(detail);
  });

  it('selects official links only when the provider is known', () => {
    expect(providerErrorGuidance(error(capacity))?.links.map(l => new URL(l.href).hostname))
      .toEqual(['developers.openai.com', 'status.openai.com']);
    expect(providerErrorGuidance(error('Overloaded', 'claude'))?.links.map(l => new URL(l.href).hostname))
      .toEqual(['platform.claude.com', 'status.claude.com']);
    expect(providerErrorGuidance({ code: 'cli', detail: capacity })?.links).toEqual([]);
    expect(providerErrorGuidance(error(`${capacity} Visit https://untrusted.example/login`))?.links.every(l => !l.href.includes('untrusted.example'))).toBe(true);
  });
});
