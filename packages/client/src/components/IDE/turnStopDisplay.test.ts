import { describe, expect, it } from 'vitest';
import type { QueuedCommand, SubAgentStreamEvent } from '@vibisual/shared';
import { buildBaseItems, IncrementalStreamParser, mergeCardsIntoItems } from './streamItems.js';
import { turnResultText } from './turnStopLabel.js';

const command = (result: string, stopReason: QueuedCommand['stopReason'] = 'cancelled'): QueuedCommand => ({
  id: 'A', text: 'test', status: 'completed', timestamp: 1, startedAt: 2, subAgentId: 'S', result, stopReason,
});
const event = (id: string, eventType: SubAgentStreamEvent['eventType'], content: string, timestamp: number): SubAgentStreamEvent => ({
  id, eventType, content, timestamp, turnId: 'A', subAgentId: 'S', parentAgentId: 'P',
});

function display(events: SubAgentStreamEvent[], commands: QueuedCommand[]) {
  const parser = new IncrementalStreamParser();
  for (let length = 0; length <= events.length; length++) {
    const prefix = events.slice(0, length);
    expect(parser.sync(prefix, commands)).toEqual(buildBaseItems(prefix, commands));
  }
  return mergeCardsIntoItems(parser.sync(events, commands), commands);
}

describe('stopped turns show one boundary and preserve the answer', () => {
  it('has no result bubble when stopped before any output, including restored legacy commands', () => {
    for (const legacy of [false, true]) {
      const cmd = command('[Stopped by user]');
      if (legacy) delete cmd.stopReason;
      const before = structuredClone(cmd);
      const items = display([], [cmd]);
      expect(items).toEqual([
        expect.objectContaining({ kind: 'command', result: '' }),
        expect.objectContaining({ kind: 'turnstop', labelKey: 'ide.turnStop.cancelled' }),
      ]);
      expect(cmd).toEqual(before);
    }
  });

  it('keeps the saved partial answer when a marker-only result is in the stream', () => {
    const cmd = command('[Stopped by user]\n\n    preserved code\nnext line');
    const events = [event('stop', 'result', '[Stopped by user]', 3)];
    const before = structuredClone(events);
    const items = display(events, [cmd]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'command', result: '    preserved code\nnext line' });
    expect(items[1]).toMatchObject({ kind: 'turnstop' });
    expect(events).toEqual(before);
  });

  it('strips the state prefix from streamed partial results without repeating the saved answer', () => {
    const result = '[Stopped by user]\r\n\r\nPartial answer';
    const items = display([event('partial', 'result', result, 3)], [command(result)]);
    expect(items.map(item => item.kind)).toEqual(['command', 'result', 'turnstop']);
    expect(items[0]).toMatchObject({ result: '' });
    expect(items[1]).toMatchObject({ content: 'Partial answer' });
  });

  it('replaces the live line with one stop boundary while keeping existing output', () => {
    const parser = new IncrementalStreamParser();
    const events = [event('text', 'text', 'Already written', 3)];
    const running = [{ ...command(''), status: 'executing' as const, stopReason: undefined }];
    expect(parser.sync(events, running).thinkingLive).not.toBeNull();
    const stopped = [command('[Stopped by user]\n\nAlready written')];
    const base = parser.sync(events, stopped);
    expect(base).toEqual(buildBaseItems(events, stopped));
    expect(base.thinkingLive).toBeNull();
    const items = mergeCardsIntoItems(base, stopped);
    expect(items.map(item => item.kind)).toEqual(['command', 'text', 'turnstop']);
    expect(items[0]).toMatchObject({ result: '' });
    expect(items[1]).toMatchObject({ content: 'Already written' });
  });

  it('preserves literal mentions in assistant text, tool output, and ordinary results', () => {
    const quote = '[Stopped by user]';
    const items = display([
      event('text', 'text', quote, 3),
      event('tool', 'tool_result', quote, 4),
      event('result', 'result', `Quoted ${quote}`, 5),
    ], [command(quote)]);
    expect(items.find(item => item.id === 'text')).toMatchObject({ content: quote });
    expect(items.find(item => item.id === 'tool')).toMatchObject({ content: quote });
    expect(items.find(item => item.id === 'result')).toMatchObject({ content: `Quoted ${quote}` });
    expect(turnResultText('Ordinary answer')).toBe('Ordinary answer');
  });
});
