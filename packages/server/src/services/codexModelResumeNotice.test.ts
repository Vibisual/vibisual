import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { isCodexModelResumeNotice, isCodexSessionNotice, readCodexSessionNotice } from '@vibisual/shared';
import { attachCodexTurn, buildCodexExecArgs, isCodexTurnRunning } from './codexRunner.js';
import { mapCodexLine, type CodexMappedEvent } from './codexStreamMap.js';

const NOTICE = 'This session was recorded with model `gpt-6-astra` but is resuming with `gpt-6.1-sol`. Consider switching back to `gpt-6-astra` as it may affect Codex performance.';
const CODE_MODE = 'Code Mode is unavailable because failed to spawn code-mode host /opt/codex/codex-code-mode-host: host executable was not found. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.';
const SERVICE_TIER = 'Configured service tier `priority` is not advertised as supported for model `gpt-reserve` and will be omitted from requests.';
const SESSION_NOTICES = [NOTICE, CODE_MODE, SERVICE_TIER];

describe('Codex nonfatal session diagnostics', () => {
  it.each(SESSION_NOTICES)('keeps the complete advisory visible without inventing failure: %s', (message) => {
    expect(isCodexSessionNotice(message)).toBe(true);
    for (const envelope of [{ type: 'error', message }, { type: 'error', error: { message } }]) {
      expect(mapCodexLine(JSON.stringify(envelope))).toEqual({ events: [{ eventType: 'system', content: message }] });
    }
    for (const eventType of ['error', 'system']) {
      expect(readCodexSessionNotice({ eventType, content: message })).toBe(message);
    }
    for (const eventType of ['text', 'thinking', 'tool_use', 'tool_result', 'result']) {
      expect(readCodexSessionNotice({ eventType, content: message })).toBeNull();
    }
  });

  it.each(['/opt/codex/host', '/Applications/Codex App/host', 'C:\\Program Files\\Codex\\host.exe'])('handles the reported optional host path on every platform: %s', (host) => {
    expect(isCodexSessionNotice(CODE_MODE.replace('/opt/codex/codex-code-mode-host', host))).toBe(true);
  });

  it.each(SESSION_NOTICES)('rejects incomplete or extended diagnostics: %s', (message) => {
    for (const content of [message.slice(0, -1), `Reported: ${message}`, `${message} Request failed.`, `${message}\n`, `${message}\r\nFailure`]) {
      expect(isCodexSessionNotice(content)).toBe(false);
    }
    expect(readCodexSessionNotice({ eventType: 'error', content: `[cli@codex] ${message}` })).toBeNull();
    expect(mapCodexLine(JSON.stringify({ type: 'turn.failed', error: { message } })))
      .toEqual({ events: [], turnEnded: true, error: message });
    expect(mapCodexLine(JSON.stringify({ type: 'item.completed', item: { type: 'error', message } })))
      .toEqual({ events: [{ eventType: 'error', content: message }] });
  });

  it('does not treat an unknown diagnostic or an empty host path as a known advisory', () => {
    for (const message of ['Warning: request failed', 'Model metadata unavailable', CODE_MODE.replace('/opt/codex/codex-code-mode-host', '')]) {
      expect(isCodexSessionNotice(message)).toBe(false);
    }
  });

  it.each(SESSION_NOTICES)('reads a historical nested JSON advisory while preserving actual failure envelopes: %s', (message) => {
    const content = JSON.stringify({ type: 'error', error: { message } });
    expect(readCodexSessionNotice({ eventType: 'error', content })).toBe(message);
    for (const value of [
      { type: 'turn.failed', error: { message } },
      { type: 'item.completed', item: { type: 'error', message } },
      { type: 'error', message: 'Request failed', error: { message } },
      { type: 'error', error: { message: `${message} Request failed.` } },
    ]) {
      expect(readCodexSessionNotice({ eventType: 'error', content: JSON.stringify(value) })).toBeNull();
    }
    expect(readCodexSessionNotice({ eventType: 'error', content: '{ invalid json' })).toBeNull();
  });
});

describe('Codex model resume advisory', () => {
  it('recognizes the complete advisory without depending on particular models', () => {
    expect(isCodexModelResumeNotice(NOTICE)).toBe(true);
    expect(isCodexModelResumeNotice(NOTICE.replaceAll('gpt-6-astra', 'original-model').replace('gpt-6.1-sol', 'selected-model'))).toBe(true);
  });

  it.each([
    '', 'Model is not supported', 'Failed to resume session',
    `Reported: ${NOTICE}`, `${NOTICE}\nturn failed`, `${NOTICE} Request failed.`,
    NOTICE.replace('switching back to `gpt-6-astra`', 'switching back to `different-model`'),
    NOTICE.replace('`gpt-6.1-sol`', '``'),
  ])('preserves actual errors and lookalikes: %s', (content) => {
    expect(isCodexModelResumeNotice(content)).toBe(false);
  });

  it.each([
    { type: 'error', message: NOTICE },
    { type: 'error', error: { message: NOTICE } },
  ])('maps a top-level advisory to system without declaring failure or completion', (line) => {
    expect(mapCodexLine(JSON.stringify(line))).toEqual({ events: [{ eventType: 'system', content: NOTICE }] });
  });

  it('preserves terminal and tool errors even with the same message', () => {
    expect(mapCodexLine(JSON.stringify({ type: 'turn.failed', error: { message: NOTICE } })))
      .toEqual({ events: [], turnEnded: true, error: NOTICE });
    expect(mapCodexLine(JSON.stringify({ type: 'item.completed', item: { type: 'error', message: NOTICE } })))
      .toEqual({ events: [{ eventType: 'error', content: NOTICE }] });
  });

  it('keeps the selected model and original thread when constructing a resumed turn', () => {
    const args = buildCodexExecArgs({ cwd: process.cwd(), model: 'gpt-6.1-sol', resumeThreadId: 'existing-astra-thread' });
    expect(args.slice(args.indexOf('resume'), args.indexOf('resume') + 2)).toEqual(['resume', 'existing-astra-thread']);
    expect(args.slice(args.indexOf('-m'), args.indexOf('-m') + 2)).toEqual(['-m', 'gpt-6.1-sol']);
  });
});

class ResumeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();

  write(line: object): void { this.stdout.write(`${JSON.stringify(line)}\n`); }
  close(code: number): void { this.emit('close', code, null); }
}

function attach(subAgentId: string) {
  const child = new ResumeChild();
  const events: CodexMappedEvent[] = [];
  const done: { error: string | undefined; finalText: string }[] = [];
  attachCodexTurn(child as unknown as ChildProcess, {
    subAgentId, onEvent: (event) => { events.push(event); },
    onThread: vi.fn(), onUsage: vi.fn(), onFileWrites: vi.fn(),
    onDone: (error, finalText) => { done.push({ error, finalText }); },
  }, { killTree: vi.fn() });
  return { child, events, done };
}

describe('Codex model change turn lifecycle', () => {
  it('continues through the notice, receives the answer and completes successfully', () => {
    const id = 'codex-model-resume-success';
    const { child, events, done } = attach(id);
    child.write({ type: 'thread.started', thread_id: 'existing-astra-thread' });
    child.write({ type: 'error', message: NOTICE });
    const runningAfterNotice = isCodexTurnRunning(id);
    const doneAfterNotice = [...done];
    child.write({ type: 'turn.started' });
    child.write({ type: 'item.completed', item: { type: 'agent_message', text: 'Sol answer' } });
    child.write({ type: 'turn.completed' });
    child.close(0);

    expect(runningAfterNotice).toBe(true);
    expect(doneAfterNotice).toEqual([]);
    expect(events).toEqual([{ eventType: 'system', content: NOTICE }, { eventType: 'text', content: 'Sol answer' }]);
    expect(done).toEqual([{ error: undefined, finalText: 'Sol answer' }]);
    expect(isCodexTurnRunning(id)).toBe(false);
  });

  it.each(['turn.failed', 'nonzero exit', 'no output'])('does not mask a subsequent %s', (failure) => {
    const id = `codex-model-resume-${failure}`;
    const { child, events, done } = attach(id);
    child.write({ type: 'error', message: NOTICE });
    const reason = 'Selected model is unavailable';
    if (failure === 'turn.failed') child.write({ type: 'turn.failed', error: { message: reason } });
    if (failure === 'nonzero exit') child.stderr.write(reason);
    child.close(failure === 'nonzero exit' ? 1 : 0);

    expect(events).toEqual([{ eventType: 'system', content: NOTICE }]);
    expect(done).toEqual([{ error: failure === 'no output' ? 'codex produced no output' : reason, finalText: '' }]);
    expect(isCodexTurnRunning(id)).toBe(false);
  });
});

describe.each([CODE_MODE, SERVICE_TIER])('Codex nonfatal diagnostic lifecycle: %s', (message) => {
  it('keeps running and completes with the actual answer', () => {
    const id = `codex-notice-success-${message.slice(0, 10)}`;
    const { child, events, done } = attach(id);
    child.write({ type: 'error', message });
    const runningAfterNotice = isCodexTurnRunning(id);
    const doneAfterNotice = [...done];
    child.write({ type: 'item.completed', item: { type: 'agent_message', text: 'Completed answer' } });
    child.write({ type: 'turn.completed' });
    child.close(0);

    expect(runningAfterNotice).toBe(true);
    expect(doneAfterNotice).toEqual([]);
    expect(events).toEqual([{ eventType: 'system', content: message }, { eventType: 'text', content: 'Completed answer' }]);
    expect(done).toEqual([{ error: undefined, finalText: 'Completed answer' }]);
  });

  it.each(['turn.failed', 'nonzero exit'])('preserves a subsequent %s and its actual reason', (failure) => {
    const id = `codex-notice-failure-${failure}-${message.slice(0, 10)}`;
    const { child, events, done } = attach(id);
    const reason = "You've hit your usage limit.";
    child.write({ type: 'error', message });
    child.write({ type: 'error', message: reason });
    if (failure === 'turn.failed') child.write({ type: 'turn.failed', error: { message: reason } });
    else child.stderr.write(reason);
    child.close(failure === 'nonzero exit' ? 1 : 0);

    expect(events).toEqual([{ eventType: 'system', content: message }, { eventType: 'error', content: reason }]);
    expect(done).toEqual([{ error: reason, finalText: '' }]);
  });
});
