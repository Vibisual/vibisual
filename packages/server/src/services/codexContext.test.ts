import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseCodexContext, readCodexContext } from './codexContext.js';

const event = (used: number, limit = 258400) => JSON.stringify({
  type: 'event_msg', payload: { type: 'token_count', info: {
    last_token_usage: { input_tokens: used - 748, cached_input_tokens: 98816, output_tokens: 748, reasoning_output_tokens: 402, total_tokens: used },
    total_token_usage: { input_tokens: 7667132, cached_input_tokens: 6882816, output_tokens: 23653, reasoning_output_tokens: 10054 },
    model_context_window: limit,
  } },
});

const turn = (model: string, effort?: string) => JSON.stringify({ type: 'turn_context', payload: { model, effort } });

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

  it('reads actual inherited effort and model from the latest turn, independently of usage', () => {
    const raw = [turn('model-a', 'medium'), event(99906), turn('model-b', 'xhigh'), event(12000)].join('\n');
    expect(parseCodexContext(raw)).toMatchObject({ modelName: 'model-b', reasoningEffort: 'xhigh', contextUsed: 12000 });
    expect(parseCodexContext(turn('model-b', 'xhigh'))).toMatchObject({ modelName: 'model-b', reasoningEffort: 'xhigh' });
    expect(parseCodexContext(`${raw}\n${turn('model-c')}`)?.reasoningEffort).toBeUndefined();
  });

  it('retains actual effort beyond 512 KiB and reads appended turns without committing partial lines', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-codex-effort-'));
    const sessions = path.join(root, 'sessions');
    fs.mkdirSync(sessions);
    const file = path.join(sessions, 'rollout-test-thread.jsonl');
    vi.stubEnv('CODEX_HOME', root);
    vi.spyOn(Date, 'now').mockReturnValue(10000);
    try {
      fs.writeFileSync(file, `${turn('model-a', 'xhigh')}\n${JSON.stringify({ type: 'response_item', payload: 'x'.repeat(600_000) })}\n${event(99906)}\n`);
      expect(readCodexContext('test-thread')).toMatchObject({ modelName: 'model-a', reasoningEffort: 'xhigh', contextUsed: 99906 });
      const nextTurn = turn('model-b', 'low');
      fs.appendFileSync(file, nextTurn.slice(0, 25));
      vi.mocked(Date.now).mockReturnValue(13000);
      expect(readCodexContext('test-thread')?.reasoningEffort).toBe('xhigh');
      fs.appendFileSync(file, `${nextTurn.slice(25)}\n${event(12000)}\n`);
      vi.mocked(Date.now).mockReturnValue(16000);
      expect(readCodexContext('test-thread')).toMatchObject({ modelName: 'model-b', reasoningEffort: 'low', contextUsed: 12000 });
      fs.writeFileSync(file, `${turn('model-c', 'high')}\n`);
      vi.mocked(Date.now).mockReturnValue(19000);
      expect(readCodexContext('test-thread')).toMatchObject({ modelName: 'model-c', reasoningEffort: 'high', contextUsed: 0 });
    } finally {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
