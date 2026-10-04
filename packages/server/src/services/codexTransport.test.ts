import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { parseCodexTransportNotice, readCodexTransportNotice } from '@vibisual/shared';
import { attachCodexTurn, isCodexTurnRunning } from './codexRunner.js';
import type { CodexMappedEvent } from './codexStreamMap.js';

const REASON = 'stream disconnected before completion: websocket closed by server before response.completed';
const RECONNECT = `Reconnecting... 2/5 (${REASON})`;
const FALLBACK = `Falling back from WebSockets to HTTPS transport. ${REASON}`;

describe('Codex transport notice classification', () => {
  it('reads retry counts and the transport fallback without declaring completion', () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(parseCodexTransportNotice(`Reconnecting... ${attempt}/5 (${REASON})`))
        .toEqual({ kind: 'reconnecting', attempt, maxAttempts: 5 });
    }
    expect(parseCodexTransportNotice(FALLBACK)).toEqual({ kind: 'fallback' });
  });

  it.each([
    '', REASON, "You've hit your usage limit.", 'Model is not supported',
    'Reconnecting... 0/5 (network error)', 'Reconnecting... 6/5 (network error)',
    'Reconnecting... 1/0 (network error)', 'Reconnecting... 01/5 (network error)',
    'Reconnecting... 1.5/5 (network error)', 'Reconnecting... 1/9007199254740992 (network error)',
    'Reconnecting... 2/5 ()', 'Reconnecting... 2/5 ( )', 'Reconnecting... 2/5',
    'Falling back from WebSockets to HTTPS transport.',
    'Falling back from WebSockets to HTTPS transport. ',
    `Reported: ${RECONNECT}`, `"${RECONNECT}"`, `${RECONNECT} failed`, `${RECONNECT}\n`,
    `${FALLBACK}\nthen failed`, `[cli@codex] ${RECONNECT}`, `[exit:1@codex] ${FALLBACK}`,
  ])('preserves unrecognized or terminal error content: %s', (content) => {
    expect(parseCodexTransportNotice(content)).toBeNull();
  });

  it('supports old error records and new system records, excluding model and tool text', () => {
    for (const eventType of ['error', 'system']) {
      expect(readCodexTransportNotice({ eventType, content: RECONNECT }))
        .toEqual({ kind: 'reconnecting', attempt: 2, maxAttempts: 5 });
    }
    for (const eventType of ['text', 'thinking', 'tool_use', 'tool_result', 'result']) {
      expect(readCodexTransportNotice({ eventType, content: RECONNECT })).toBeNull();
      expect(readCodexTransportNotice({ eventType, content: FALLBACK })).toBeNull();
    }
  });
});

class TransportChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly pid = 99001;

  write(value: object): void { this.stdout.write(`${JSON.stringify(value)}\n`); }
  close(code: number): void { this.emit('close', code, null); }
}

function attachTransportChild(subAgentId: string): {
  child: TransportChild;
  events: CodexMappedEvent[];
  done: { error: string | undefined; finalText: string }[];
} {
  const child = new TransportChild();
  const events: CodexMappedEvent[] = [];
  const done: { error: string | undefined; finalText: string }[] = [];
  // Only the stdout/stderr and lifecycle surface is exercised; no process is spawned.
  attachCodexTurn(child as unknown as ChildProcess, {
    subAgentId,
    onEvent: (event) => { events.push(event); },
    onThread: vi.fn(), onUsage: vi.fn(), onFileWrites: vi.fn(),
    onDone: (error, finalText) => { done.push({ error, finalText }); },
  }, { killTree: vi.fn() });
  return { child, events, done };
}

describe('Codex transport recovery lifecycle', () => {
  it('keeps the turn running through retries and fallback, then completes successfully', () => {
    const id = 'codex-transport-recovered';
    const { child, events, done } = attachTransportChild(id);
    for (let attempt = 2; attempt <= 5; attempt++) {
      child.write({ type: 'error', message: `Reconnecting... ${attempt}/5 (${REASON})` });
    }
    child.write({ type: 'error', message: FALLBACK });
    const stillRunning = isCodexTurnRunning(id);
    const doneBeforeAnswer = [...done];
    child.write({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: 'Recovered answer' } });
    child.write({ type: 'turn.completed' });
    child.close(0);

    expect(stillRunning).toBe(true);
    expect(doneBeforeAnswer).toEqual([]);
    expect(events.filter((event) => event.eventType === 'system')).toHaveLength(5);
    expect(events.some((event) => event.eventType === 'error')).toBe(false);
    expect(events.at(-1)?.content).toBe('Recovered answer');
    expect(done).toEqual([{ error: undefined, finalText: 'Recovered answer' }]);
    expect(isCodexTurnRunning(id)).toBe(false);
  });

  it.each(['turn.failed', 'nonzero exit'])('preserves %s after a recovery notice', (failure) => {
    const id = `codex-transport-${failure}`;
    const { child, events, done } = attachTransportChild(id);
    child.write({ type: 'error', message: RECONNECT });
    child.write({ type: 'error', message: FALLBACK });
    if (failure === 'turn.failed') child.write({ type: 'turn.failed', error: { message: REASON } });
    else child.stderr.write(REASON);
    child.close(failure === 'turn.failed' ? 0 : 1);

    expect(events.map((event) => event.eventType)).toEqual(['system', 'system']);
    expect(done).toEqual([{ error: REASON, finalText: '' }]);
    expect(isCodexTurnRunning(id)).toBe(false);
  });
});
