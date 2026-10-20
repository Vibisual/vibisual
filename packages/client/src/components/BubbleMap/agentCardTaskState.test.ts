import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentCardTaskBook, AppBubble } from '@vibisual/shared';
import { archivedCardTaskNodes, cardTaskKey, cardTaskNodes, needsCardTaskDestination, saveCardTasks, useCardTaskStore } from './agentCardTaskState.js';

const book: AgentCardTaskBook = { revision: 2, activeTaskId: 'b', tasks: [
  { id: 'a', title: 'Building', sessionId: 'sa', nodeIds: ['old'], createdAt: 1 },
  { id: 'b', title: 'Tree', sessionId: 'sb', nodeIds: ['new'], createdAt: 2 },
] };
afterEach(() => { vi.unstubAllGlobals(); useCardTaskStore.setState({ entries: {} }); });

describe('card task targeting and history', () => {
  it('keeps archived outputs out of a new request while admitting newly linked apps', () => {
    expect(cardTaskNodes([{ id: 'old' }, { id: 'new' }, { id: 'unassigned' }], book).map((node) => node.id))
      .toEqual(['new', 'unassigned']);
    expect(cardTaskNodes([{ id: 'old' }, { id: 'new' }], { ...book, activeTaskId: 'a' }).map((node) => node.id)).toEqual(['old']);
  });
  it('folds only archived exclusive nodes, retaining pinned and shared outputs', () => {
    const bubbles = ['old', 'new'].map((id) => ({ id, linkedAgentIds: ['agent'] } as AppBubble));
    const entries = { [cardTaskKey('/p', 'agent')]: { book } };
    expect([...archivedCardTaskNodes(entries, bubbles)]).toEqual(['old']);
    expect([...archivedCardTaskNodes(entries, [{ ...bubbles[0]!, preservePinned: true }])]).toEqual([]);
    expect([...archivedCardTaskNodes(entries, [{ ...bubbles[0]!, linkedAgentIds: ['agent', 'another'] }])]).toEqual([]);
    expect([...archivedCardTaskNodes(entries, [{ ...bubbles[0]!, linkedAgentIds: [] }])]).toEqual([]);
    expect([...archivedCardTaskNodes(entries, bubbles, new Set())]).toEqual([]);
  });
  it.each(['창문을 새로 만들어줘', '현재 장면 옆에 자동차 추가해줘', '이 건물을 다시 만들어줘', 'Add a tree to this scene'])
    ('does not turn a contextual edit into a new task: %s', (text) => expect(needsCardTaskDestination(text, true)).toBe(false));
  it.each(['자동차 만들어줘', 'Make a car'])('asks where to put an unqualified creation: %s', (text) => {
    expect(needsCardTaskDestination(text, true)).toBe(true);
    expect(needsCardTaskDestination(text, false)).toBe(false);
  });
  it('never rolls back a newer book when an older save reply arrives late', async () => {
    let reply!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { reply = resolve; })));
    const request = saveCardTasks('/p', 'agent', book);
    useCardTaskStore.getState().patch(cardTaskKey('/p', 'agent'), { book: { ...book, revision: 4, activeTaskId: 'a' } });
    reply(new Response(JSON.stringify({ book: { ...book, revision: 3 } })));
    await request;
    expect(useCardTaskStore.getState().entries[cardTaskKey('/p', 'agent')]?.book?.activeTaskId).toBe('a');
  });
});
