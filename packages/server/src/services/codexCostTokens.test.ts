import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseCodexTokenUsage, readCodexContext, readCodexTokenUsage } from './codexContext.js';

const model = (name: string) => JSON.stringify({ type: 'turn_context', payload: { model: name } });
const count = (input: number, cached: number, output: number, timestamp = '2026-09-21T03:00:00Z') => JSON.stringify({
  type: 'event_msg', timestamp, payload: { type: 'token_count', info: {
    total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: 40 },
    // Cost uses cumulative deltas; the context gauge uses the last request.
    last_token_usage: { input_tokens: 90, cached_input_tokens: 80, output_tokens: 10, total_tokens: 100 },
    model_context_window: 258400,
  } },
});

describe('Codex cost token records', () => {
  it('splits cached input and keeps reasoning inside output, with dated model-specific deltas', () => {
    const turns = parseCodexTokenUsage([
      model('gpt-5.4'), count(1000, 800, 100),
      model('gpt-5.3-codex'), count(2500, 2000, 250, '2026-09-22T03:00:00Z'),
    ].join('\n'));
    expect(turns).toEqual([
      { turnIndex: 0, timestamp: Date.parse('2026-09-21T03:00:00Z'), inputTokens: 200, cacheReadTokens: 800, outputTokens: 100, cacheCreateTokens: 0, totalContext: 1000, model: 'gpt-5.4', tools: [] },
      { turnIndex: 1, timestamp: Date.parse('2026-09-22T03:00:00Z'), inputTokens: 300, cacheReadTokens: 1200, outputTokens: 150, cacheCreateTokens: 0, totalContext: 1500, model: 'gpt-5.3-codex', tools: [] },
    ]);
  });

  it('does not charge duplicate, stale, invalid or quota-only token counts', () => {
    const turns = parseCodexTokenUsage([
      model('gpt-5.4'), count(1000, 800, 100), count(1000, 800, 100),
      count(500, 400, 50), count(-1, 0, 100), count(1000, 1001, 100),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: null } }),
      '{"type":', count(2000, 1500, 300),
    ].join('\n'));
    expect(turns).toHaveLength(2);
    expect(turns.reduce((sum, t) => sum + t.inputTokens + t.cacheReadTokens, 0)).toBe(2000);
    expect(turns.reduce((sum, t) => sum + t.outputTokens, 0)).toBe(300);
    expect(parseCodexTokenUsage(model('gpt-5.4'))).toEqual([]);
  });

  it('reads cost totals without a context-window reading and leaves unknown models unknown', () => {
    const raw = JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: 50, output_tokens: 10 },
    } } });
    expect(parseCodexTokenUsage(raw)).toEqual([expect.objectContaining({
      inputTokens: 50, cacheReadTokens: 0, outputTokens: 10, model: undefined,
    })]);
  });

  it('shares incremental reads with context, never commits a pending tail twice, and resets truncated files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-codex-cost-'));
    const sessions = path.join(root, 'sessions');
    fs.mkdirSync(sessions);
    const file = path.join(sessions, 'rollout-cost-thread.jsonl');
    vi.stubEnv('CODEX_HOME', root);
    vi.spyOn(Date, 'now').mockReturnValue(10000);
    try {
      fs.writeFileSync(file, `${model('gpt-5.4')}\n${count(1000, 800, 100)}`);
      expect(readCodexContext('cost-thread')?.contextUsed).toBe(100);
      const first = readCodexTokenUsage('cost-thread')!;
      expect(first).toHaveLength(1);
      first[0]!.inputTokens = 999999;
      expect(readCodexTokenUsage('cost-thread')![0]!.inputTokens).toBe(200);

      const next = count(2000, 1500, 300);
      fs.appendFileSync(file, `\n${next.slice(0, 30)}`);
      vi.mocked(Date.now).mockReturnValue(13000);
      expect(readCodexTokenUsage('cost-thread')).toHaveLength(1);
      fs.appendFileSync(file, `${next.slice(30)}\n${next}\n`);
      vi.mocked(Date.now).mockReturnValue(16000);
      const appended = readCodexTokenUsage('cost-thread')!;
      expect(appended).toHaveLength(2);
      expect(appended.reduce((sum, t) => sum + t.inputTokens + t.cacheReadTokens, 0)).toBe(2000);

      fs.writeFileSync(file, `${model('gpt-5.3-codex')}\n${count(100, 20, 10)}\n`);
      vi.mocked(Date.now).mockReturnValue(19000);
      expect(readCodexTokenUsage('cost-thread')).toEqual([expect.objectContaining({
        model: 'gpt-5.3-codex', inputTokens: 80, cacheReadTokens: 20, outputTokens: 10,
      })]);
      expect(readCodexTokenUsage('../cost-thread')).toBeNull();
      expect(readCodexTokenUsage('missing-thread')).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
