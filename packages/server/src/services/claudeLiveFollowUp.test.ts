import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeLiveFollowUpChannel } from './claudeLiveFollowUp.js';

class Child extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly messages: Record<string, unknown>[] = [];
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  constructor() {
    super();
    this.stdin.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().trim().split('\n')) this.messages.push(JSON.parse(line));
    });
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
const input = { id: 'follow-1', text: '이 작업에 반영해 주세요', attachments: ['C:/fixtures/design.png'] };
function setup() {
  const child = new Child();
  const channel = new ClaudeLiveFollowUpChannel(child as unknown as ChildProcess, 100);
  const replay = () => ({ type: 'user', uuid: child.messages.at(-1)?.uuid,
    session_id: 'session-1', parent_tool_use_id: null, isReplay: true });
  return { child, channel, replay };
}

describe('Claude live follow-up delivery', () => {
  it('sends one non-interrupting user message and confirms only its matching UUID replay', async () => {
    const { child, channel, replay } = setup();
    const pending = channel.send(input, 'session-1');
    const accepted = vi.fn();
    void pending.then(accepted);
    expect(channel.send(input, 'session-1')).toBe(pending);
    expect(child.messages).toHaveLength(1);
    expect(child.messages[0]).toMatchObject({
      type: 'user', uuid: expect.any(String), session_id: 'session-1', parent_tool_use_id: null,
      priority: 'next', origin: { kind: 'human' },
      message: { role: 'user', content: [{ type: 'text', text: `${input.text}\n\nC:/fixtures/design.png` }] },
    });
    expect(channel.acknowledge({ ...replay(), uuid: 'another-message' })).toBe(false);
    expect(channel.acknowledge({ ...replay(), parent_tool_use_id: 'nested-agent' })).toBe(false);
    expect(channel.acknowledge({ ...replay(), session_id: 'another-session' })).toBe(false);
    await Promise.resolve();
    expect(accepted).not.toHaveBeenCalled();
    expect(channel.acknowledge(replay())).toBe(true);
    await expect(pending).resolves.toBe(true);
    expect(channel.send(input, 'session-1')).toBe(pending);
    expect(child.messages).toHaveLength(1);
    expect(child.stdin.writableEnded).toBe(false);
  });

  it('returns false without writing when input is already closed', async () => {
    const { child, channel } = setup();
    child.stdin.end();
    await expect(channel.send(input, 'session-1')).resolves.toBe(false);
    expect(child.messages).toHaveLength(0);
  });

  it.each(['error', 'exit', 'close'] as const)('rejects uncertain delivery on child %s and never writes the same input again', async (event) => {
    const { child, channel } = setup();
    const pending = channel.send(input, 'session-1');
    const rejected = expect(pending).rejects.toThrow('acknowledgement');
    child.emit(event, event === 'error' ? new Error('broken process') : 1);
    await rejected;
    expect(channel.send(input, 'session-1')).toBe(pending);
    expect(child.messages).toHaveLength(1);
    await expect(channel.send({ ...input, id: 'later' }, 'session-1')).resolves.toBe(false);
  });

  it('rejects a timed-out receipt even if a late replay arrives, without replaying input', async () => {
    const { child, channel, replay } = setup();
    const pending = channel.send(input, 'session-1');
    const rejected = expect(pending).rejects.toThrow('delivery is unknown');
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    expect(channel.acknowledge(replay())).toBe(true);
    expect(channel.send(input, 'session-1')).toBe(pending);
    expect(child.messages).toHaveLength(1);
  });

  it('records delivery before finalizing a result that acknowledges the same message', async () => {
    const { child, channel } = setup();
    const order: string[] = [];
    void channel.send(input, 'session-1').then(() => order.push('delivered'));
    expect(channel.deferResult({ type: 'result', user_message_uuids: [child.messages[0]?.uuid], queued_turn_count: 0 },
      () => order.push('finalized'))).toBe(true);
    expect(channel.canSend).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['delivered', 'finalized']);
  });

  it('waits for another result when the old turn ends before receipt or queued work is drained', async () => {
    const { channel, replay } = setup();
    const pending = channel.send(input, 'session-1');
    const stale = vi.fn();
    channel.deferResult({ type: 'result', queued_turn_count: 0 }, stale);
    channel.acknowledge(replay());
    await pending;
    await vi.advanceTimersByTimeAsync(0);
    expect(stale).not.toHaveBeenCalled();
    channel.noteModelActivity();
    expect(channel.canSend).toBe(true);
    channel.deferResult({ type: 'result', queued_turn_count: 1 }, stale);
    await vi.advanceTimersByTimeAsync(0);
    expect(stale).not.toHaveBeenCalled();
    const latest = vi.fn();
    channel.deferResult({ type: 'result', queued_turn_count: 0 }, latest);
    await vi.advanceTimersByTimeAsync(0);
    expect(latest).toHaveBeenCalledOnce();
    expect(stale).not.toHaveBeenCalled();
  });

  it('releases a racing result after an unconfirmed receipt times out and records failure first', async () => {
    const { channel } = setup();
    const order: string[] = [];
    void channel.send(input, 'session-1').catch(() => order.push('unconfirmed'));
    channel.deferResult({ type: 'result', queued_turn_count: 0 }, () => order.push('finalized'));
    await vi.advanceTimersByTimeAsync(102);
    expect(order).toEqual(['unconfirmed', 'finalized']);
  });

  it('does not finalize an old result after the same app command has resumed producing output', async () => {
    const { channel, replay } = setup();
    const pending = channel.send(input, 'session-1');
    channel.acknowledge(replay()); await pending;
    const stale = vi.fn();
    channel.deferResult({ type: 'result', queued_turn_count: 0 }, stale);
    channel.noteModelActivity();
    await vi.advanceTimersByTimeAsync(0);
    expect(stale).not.toHaveBeenCalled();
    channel.beginTurn();
    expect(channel.hasDeliveries).toBe(false);
    expect(channel.deferResult({ type: 'result' }, stale)).toBe(false);
  });
});
