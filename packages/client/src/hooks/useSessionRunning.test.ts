import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubAgent } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';
import { useSessionLivenessFacts } from './useSessionRunning.js';

vi.mock('../stores/graphStore.js', async () => {
  const { create: makeStore } = await import('zustand');
  return { useGraphStore: makeStore(() => ({})) };
});

const session: SubAgent = {
  id: 'sub-a', sessionId: 'thread-a', parentAgentId: 'agent', label: 'A',
  status: 'active', createdAt: 1, lastActivityAt: 1_000,
};
let view: ReactTestRenderer | undefined;
function Activity(): ReturnType<typeof createElement> {
  const facts = useSessionLivenessFacts('agent', session.id);
  return createElement('span', null, `${facts.running}:${facts.lastActivityAt}`);
}
function TurnClock(): ReturnType<typeof createElement> {
  const facts = useSessionLivenessFacts('agent', session.id);
  return createElement('span', null, `${facts.turnStartedAt}`);
}

beforeEach(() => {
  useGraphStore.setState({
    subAgents: { agent: [session] }, subAgentStreams: {}, queuedCommands: {},
    runningSubagentTasks: {}, acknowledgedSubAgents: {}, completedCommands: {},
  });
});
afterEach(() => {
  act(() => { view?.unmount(); });
  view = undefined;
});

describe('live activity subscription', () => {
  it('updates from live status events without a new session snapshot', () => {
    act(() => { view = create(createElement(Activity)); });
    expect(view!.root.findByType('span').children).toEqual(['true:1000']);
    act(() => {
      useGraphStore.setState({ subAgentStreams: { [session.id]: [{
        id: 'status', subAgentId: session.id, parentAgentId: 'agent', timestamp: 265_000,
        eventType: 'system', content: '[status]',
      }] } });
    });
    expect(useGraphStore.getState().subAgents.agent![0]).toBe(session);
    expect(view!.root.findByType('span').children).toEqual(['true:265000']);
  });

  it('ignores history download time and activity from another session', () => {
    act(() => { view = create(createElement(Activity)); });
    act(() => {
      useGraphStore.setState({
        streamLastActivity: { [session.id]: Date.now() },
        subAgentStreams: {
          [session.id]: [{
            id: 'old', subAgentId: session.id, parentAgentId: 'agent', timestamp: 500,
            eventType: 'text', content: 'old history',
          }],
          'sub-b': [{
            id: 'other', subAgentId: 'sub-b', parentAgentId: 'agent', timestamp: Date.now(),
            eventType: 'text', content: 'another session',
          }],
        },
      });
    });
    expect(view!.root.findByType('span').children).toEqual(['true:1000']);
  });
});

// §5.5 #17-10 ⑥-6 (turn clock) — the live line counts from here, not from the last line.
describe('turn clock facts', () => {
  it('reports when the running command went out and keeps it while lines keep arriving', () => {
    useGraphStore.setState({ queuedCommands: { agent: [{
      id: 'c1', subAgentId: session.id, timestamp: 90_000, startedAt: 100_000, status: 'executing', text: 'work',
    }] } });
    act(() => { view = create(createElement(TurnClock)); });
    expect(view!.root.findByType('span').children).toEqual(['100000']);
    act(() => {
      useGraphStore.setState({ subAgentStreams: { [session.id]: [{
        id: 'line', subAgentId: session.id, parentAgentId: 'agent', timestamp: 265_000,
        eventType: 'text', content: '.',
      }] } });
    });
    expect(view!.root.findByType('span').children).toEqual(['100000']);
  });

  it('falls back to running children, prefers a dispatched command, and says null without a basis', () => {
    act(() => { view = create(createElement(TurnClock)); });
    expect(view!.root.findByType('span').children).toEqual(['null']);
    act(() => {
      useGraphStore.setState({ runningSubagentTasks: { agent: [{
        id: 't1', parentAgentId: 'agent', subAgentId: session.id, startedAt: 50_000,
        origin: 'hook', subagentType: 'general-purpose',
      }] } });
    });
    expect(view!.root.findByType('span').children).toEqual(['50000']);
    act(() => {
      useGraphStore.setState({ completedCommands: { agent: [{
        id: 'c0', subAgentId: session.id, timestamp: 70_000, startedAt: 80_000, status: 'completed', text: 'done',
      }] } });
    });
    expect(view!.root.findByType('span').children).toEqual(['80000']);
  });
});
