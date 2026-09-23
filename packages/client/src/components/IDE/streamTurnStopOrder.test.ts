import { describe, expect, it } from 'vitest';
import type { QueuedCommand, SubAgentStreamEvent } from '@vibisual/shared';
import { buildBaseItems, IncrementalStreamParser, mergeCardsIntoItems } from './streamItems.js';
import { insertEventInTurnOrder } from './turnOrder.js';

const command = (id: string, startedAt: number, stopped = false): QueuedCommand => ({
  id, text: id, timestamp: startedAt, startedAt, subAgentId: 'S', status: 'completed',
  stopReason: stopped ? 'cancelled' : 'end_turn',
});
const event = (id: string, timestamp: number, turnId: string, eventType: SubAgentStreamEvent['eventType'] = 'text'): SubAgentStreamEvent => ({
  id, timestamp, turnId, eventType, subAgentId: 'S', parentAgentId: 'P', content: id,
});
const commands = [command('A', 50, true), command('B', 200)];

describe('중지 표시는 늦게 온 자기 턴 출력 뒤에 남는다', () => {
  it.each(['system', 'text', 'result', 'error', 'tool_use'] as const)('%s의 원래 시각을 보존하면서 다음 턴 앞으로 돌려놓는다', (type) => {
    const first = event('a-first', 100, 'A');
    const next = event('b-output', 300, 'B');
    const late = event('a-late', 350, 'A', type);
    const buffer = insertEventInTurnOrder([first, next], late).buffer;
    const parser = new IncrementalStreamParser();
    parser.sync([first, next], commands);
    for (const base of [buildBaseItems(buffer, commands), parser.sync(buffer, commands)]) {
      const items = mergeCardsIntoItems(base, commands);
      expect(items.map((item) => item.id)).toEqual(['cmd-A', 'a-first', 'a-late', 'turnstop-A', 'cmd-B', 'b-output']);
      expect(items.find((item) => item.id === 'a-late')?.timestamp).toBe(350);
      expect(items.find((item) => item.id === 'b-output')).toMatchObject({ content: 'b-output', timestamp: 300, endedAt: 300 });
    }
  });

  it('늦은 그림과 사고 자국도 중지 표시 위에 놓고 시간 측정값을 유지한다', () => {
    const buffer = [
      event('a-first', 100, 'A'),
      { ...event('a-think', 350, 'A', 'thinking'), content: 'x'.repeat(100) },
      { ...event('a-image', 400, 'A'), imagePath: 'C:/art/image.png' },
      event('b-output', 300, 'B'),
    ];
    const parser = new IncrementalStreamParser();
    for (let n = 1; n <= buffer.length; n++) {
      const full = mergeCardsIntoItems(buildBaseItems(buffer.slice(0, n), commands), commands);
      expect(mergeCardsIntoItems(parser.sync(buffer.slice(0, n), commands), commands)).toEqual(full);
    }
    const items = mergeCardsIntoItems(parser.sync(buffer, commands), commands);
    expect(items.map((item) => item.id)).toEqual(['cmd-A', 'a-first', 'step-a-think', 'a-image', 'turnstop-A', 'cmd-B', 'b-output']);
    expect(items.find((item) => item.id === 'step-a-think')).toMatchObject({ timestamp: 350, endedAt: 350, chars: 100 });
    expect(items.find((item) => item.id === 'a-image')?.timestamp).toBe(400);
  });

  it('시각이 거꾸로 가는 다른 턴의 사고도 합치지 않는다', () => {
    const buffer = [
      { ...event('a-think', 350, 'A', 'thinking'), content: 'x'.repeat(100) },
      { ...event('b-think', 300, 'B', 'thinking'), content: 'y'.repeat(100) },
      event('b-output', 400, 'B'),
    ];
    const parser = new IncrementalStreamParser();
    for (const base of [buildBaseItems(buffer, commands), parser.sync(buffer, commands)]) {
      const items = mergeCardsIntoItems(base, commands);
      expect(items.map((item) => item.id)).toEqual(['cmd-A', 'step-a-think', 'turnstop-A', 'cmd-B', 'step-b-think', 'b-output']);
      expect(items.find((item) => item.id === 'step-a-think')).toMatchObject({ timestamp: 350, endedAt: 350, chars: 100 });
    }
  });

  it('명령 시작보다 이른 시각도 도장에 따라 배치하고 모르는 도장은 기존 시각순을 유지한다', () => {
    const buffer = [event('b-early', 1, 'B'), event('unknown', 150, 'missing')];
    const items = mergeCardsIntoItems(buildBaseItems(buffer, commands), commands);
    expect(items.map((item) => item.id)).toEqual(['cmd-A', 'unknown', 'turnstop-A', 'cmd-B', 'b-early']);
    expect(items.find((item) => item.id === 'b-early')?.timestamp).toBe(1);
  });
});
