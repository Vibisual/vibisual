import { describe, expect, it } from 'vitest';
import { parseCodexContext } from './codexContext.js';

const event = (used: number, limit = 258400) => JSON.stringify({
  type: 'event_msg', payload: { type: 'token_count', info: {
    last_token_usage: { input_tokens: used - 748, cached_input_tokens: 98816, output_tokens: 748, reasoning_output_tokens: 402, total_tokens: used },
    total_token_usage: { input_tokens: 7667132, cached_input_tokens: 6882816, output_tokens: 23653, reasoning_output_tokens: 10054 },
    model_context_window: limit,
  } },
});

describe('Codex session context', () => {
  it('uses last request context and actual window, not cumulative or cached tokens', () => {
    expect(parseCodexContext(event(99906))).toEqual({
      contextUsed: 99906, contextMax: 258400,
      cumulativeInputTokens: 7667132, cumulativeOutputTokens: 23653,
    });
  });
  it('accepts lower usage after compaction and tolerates partial writes', () => {
    expect(parseCodexContext(`broken prefix\n${event(99906)}\n${event(12000)}\n{"type":` )?.contextUsed).toBe(12000);
  });
  it('does not invent context from missing or invalid records', () => {
    expect(parseCodexContext(event(100, 0))).toBeNull();
    expect(parseCodexContext('{"type":"event_msg","payload":{"type":"token_count","info":null}}')).toBeNull();
    expect(parseCodexContext('')).toBeNull();
  });
});
