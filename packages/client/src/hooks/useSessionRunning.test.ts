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

beforeEach(() => {
  useGraphStore.setState({
    subAgents: { agent: [session] }, subAgentStreams: {}, queuedCommands: {},
    runningSubagentTasks: {}, acknowledgedSubAgents: {},
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
