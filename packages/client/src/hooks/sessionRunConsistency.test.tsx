import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BubbleData, QueuedCommand, RunningSubagentTask, SubAgent } from '@vibisual/shared';
import { IDEStatusBar } from '../components/IDE/IDEStatusBar.js';
import { useGraphStore } from '../stores/graphStore.js';
import {
  useSessionExecuting, useSessionLivenessFacts, useSessionRunning, useSessionWork,
} from './useSessionRunning.js';

vi.mock('../stores/graphStore.js', async () => {
  const { create: makeStore } = await import('zustand');
  return { useGraphStore: makeStore(() => ({})) };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../components/Panel/ContextInsurancePopup.js', () => ({ ContextInsurancePopup: () => null }));
vi.mock('../components/Panel/AgentConfigPopup.js', () => ({ AgentConfigPopup: () => null }));
vi.mock('../components/Codex/useCodexEffectiveConfig.js', () => ({ useCodexEffectiveConfig: () => null }));

const agent: BubbleData = {
  id: 'agent-a', label: 'A', bubbleType: 'agent', path: '/project', status: 'idle', activity: 0,
};
const session: SubAgent = {
  id: 'sub-a', sessionId: 'thread-a', parentAgentId: agent.id, label: 'A session',
  status: 'idle', createdAt: 1, lastActivityAt: 1_000,
};
const executing: QueuedCommand = {
  id: 'previous-command', text: 'work', timestamp: 100, startedAt: 200,
  subAgentId: session.id, status: 'executing',
};
const pending: QueuedCommand = {
  id: 'next-command', text: 'next', timestamp: 2_000, subAgentId: session.id, status: 'queued',
};
const child: RunningSubagentTask = {
  id: 'child', parentAgentId: agent.id, subAgentId: session.id,
  origin: 'hook', subagentType: 'general-purpose', startedAt: 300,
};

type Scope = { activeSessionId: string | null };
let view: ReactTestRenderer | undefined;

// Separate subscribers reproduce the status bar and input area reacting to the
// same store update; rerendering one must not be required to refresh the other.
function ConnectedStatusBar({ activeSessionId }: Scope): React.JSX.Element {
  const selectedAgent = useGraphStore((s) => s.agents.find((a) => a.id === agent.id)!);
  const selectedSession = useGraphStore((s) => activeSessionId === null
    ? null : s.subAgents[agent.id]?.find((sub) => sub.id === activeSessionId) ?? null);
  return <IDEStatusBar agent={selectedAgent} activeSession={selectedSession} isCustom sessionCount={2} />;
}

function InputFacts({ activeSessionId }: Scope): React.JSX.Element {
  const running = useSessionRunning(agent.id, activeSessionId);
  const work = useSessionWork(agent.id, activeSessionId);
  const executingCommand = useSessionExecuting(agent.id, activeSessionId);
  const liveness = useSessionLivenessFacts(agent.id, activeSessionId);
  return <output>{JSON.stringify({ running, work, executing: executingCommand, liveness })}</output>;
}

function renderSurfaces(activeSessionId: string | null = session.id): void {
  act(() => {
    view = create(<>
      <ConnectedStatusBar activeSessionId={activeSessionId} />
      <InputFacts activeSessionId={activeSessionId} />
    </>);
  });
}

function expectSurfaces(label: 'done' | 'running' | 'waiting' | 'error', options: {
  executing?: boolean; hiddenTurn?: boolean;
} = {}): void {
  const status = view!.root.findByProps({ title: 'ide.statusBar.statusTip' });
  expect(status.findAllByType('span').flatMap((node) => node.children)
    .filter((node) => typeof node === 'string')).toEqual([`panel.subAgent.status.${label}`]);
  const facts = JSON.parse(view!.root.findByType('output').children.join(''));
  expect(facts).toMatchObject({
    running: label === 'running',
    work: label === 'running' || label === 'waiting',
    executing: options.executing ?? false,
    liveness: {
      running: label === 'running', waiting: label === 'waiting', hiddenTurn: options.hiddenTurn ?? false,
    },
  });
  if (label === 'done' || label === 'error') expect(facts.liveness.turnStartedAt).toBeNull();
}

beforeEach(() => {
  useGraphStore.setState({
    // A different active agent must not influence the selected main tab.
    agents: [{ ...agent, id: 'other-agent', status: 'active' }, { ...agent }],
    subAgents: { [agent.id]: [{ ...session }] },
    subAgentStreams: {}, queuedCommands: {}, completedCommands: {}, runningSubagentTasks: {},
    acknowledgedSubAgents: { [session.id]: true }, sessionFocusGlow: {},
    agentConfigs: {}, agentProjects: {}, projects: {}, userDefaults: undefined,
    codexModels: undefined, modelRegistry: undefined, contextInsurance: [], diffComments: {},
    insurancePopupOpen: false,
    setInsurancePopupOpen: vi.fn(), addCommand: vi.fn(), clearDiffComments: vi.fn(),
  });
});

afterEach(() => {
  act(() => { view?.unmount(); });
  view = undefined;
});

describe('status bar and input hooks share session execution truth', () => {
  it.each(['idle', 'completed', 'error'] as const)(
    'does not let an executing residue override the known %s session', (status) => {
      useGraphStore.setState({
        subAgents: { [agent.id]: [{ ...session, status }] },
        queuedCommands: { [agent.id]: [executing] },
      });
      renderSurfaces();
      expectSurfaces(status === 'error' ? 'error' : 'done');
      expect(useGraphStore.getState().queuedCommands[agent.id]).toEqual([executing]);
    },
  );

  it.each([false, true])('keeps an active turn running (silent compact: %s)', (silent) => {
    useGraphStore.setState({
      subAgents: { [agent.id]: [{ ...session, status: 'active' }] },
      queuedCommands: { [agent.id]: [{
        ...executing, silent, text: silent ? '/compact' : 'work',
      }, pending] },
    });
    renderSurfaces();
    expectSurfaces('running', { executing: true, hiddenTurn: silent });
  });

  it('keeps a server-active session running after its command has left the queue', () => {
    useGraphStore.setState({ subAgents: { [agent.id]: [{ ...session, status: 'active' }] } });
    renderSurfaces();
    expectSurfaces('running');
  });

  it.each(['hook', 'stream-model', 'shell'] as const)('distinguishes an idle session with %s background work', (kind) => {
    useGraphStore.setState({
      queuedCommands: { [agent.id]: [executing] },
      runningSubagentTasks: { [agent.id]: [{
        ...child, origin: kind === 'hook' ? 'hook' : 'stream',
        subagentType: kind === 'shell' ? undefined : child.subagentType,
      }] },
    });
    renderSurfaces();
    expectSurfaces(kind === 'shell' ? 'done' : 'running');
  });

  it('shows waiting for queued work behind a stale executing command', () => {
    useGraphStore.setState({ queuedCommands: { [agent.id]: [executing, pending] } });
    renderSurfaces();
    expectSurfaces('waiting');
  });

  it('does not treat a stale silent compact as a hidden running turn', () => {
    useGraphStore.setState({ queuedCommands: { [agent.id]: [
      { ...executing, text: '/compact', silent: true }, pending,
    ] } });
    renderSurfaces();
    expectSurfaces('waiting');
  });

  it('does not borrow executing commands, queued work, or model children from another session', () => {
    useGraphStore.setState({
      queuedCommands: { [agent.id]: [executing, pending].map((command) => ({ ...command, subAgentId: 'sub-b' })) },
      runningSubagentTasks: { [agent.id]: [{ ...child, subAgentId: 'sub-b' }] },
    });
    renderSurfaces();
    expectSurfaces('done');
  });

  it('keeps probe guesses and their reason out of the status bar', () => {
    useGraphStore.setState({ subAgents: { [agent.id]: [{
      ...session, probe: { at: 2_000, verdict: 'finished', reason: 'No tools outstanding, no background jobs' },
    }] } });
    renderSurfaces();
    expectSurfaces('done');
    const rendered = JSON.stringify(view!.toJSON());
    expect(rendered).not.toContain('panel.subAgent.probe');
    expect(rendered).not.toContain('No tools outstanding');
    expect(rendered).not.toContain('끝난 것 같음');
  });
});

describe('main tab execution truth includes its agent status', () => {
  it.each(['active', 'awaiting_permission'] as const)('keeps a %s agent running without a queued command', (status) => {
    useGraphStore.setState({ agents: [{ ...agent, status }] });
    renderSurfaces(null);
    expectSurfaces('running');
  });

  it.each([
    ['idle', 'done'], ['completed', 'done'], ['error', 'error'],
    ['active', 'running'], ['awaiting_permission', 'running'],
  ] as const)('agrees for a %s agent with an executing queue entry', (status, label) => {
    useGraphStore.setState({
      agents: [{ ...agent, status }], queuedCommands: { [agent.id]: [executing] },
    });
    renderSurfaces(null);
    expectSurfaces(label, { executing: label === 'running' });
  });

  it.each([session.id, null])('includes a queued command assigned to %s', (subAgentId) => {
    useGraphStore.setState({ queuedCommands: { [agent.id]: [executing, { ...pending, subAgentId }] } });
    renderSurfaces(null);
    expectSurfaces('waiting');
  });

  it.each(['hook', 'stream-model', 'shell'] as const)('classifies %s background work without a session owner', (kind) => {
    useGraphStore.setState({
      runningSubagentTasks: { [agent.id]: [{
        ...child, origin: kind === 'hook' ? 'hook' : 'stream', subAgentId: undefined,
        subagentType: kind === 'shell' ? undefined : child.subagentType,
      }] },
    });
    renderSurfaces(null);
    expectSurfaces(kind === 'shell' ? 'done' : 'running');
  });
});

describe('live subscriptions remain consistent across execution transitions', () => {
  it.each([session.id, null])('updates scope %s from active to idle residue to queued work', (activeSessionId) => {
    const commands = [executing];
    useGraphStore.setState({
      agents: [{ ...agent, status: 'active' }],
      subAgents: { [agent.id]: [{ ...session, status: 'active' }] },
      queuedCommands: { [agent.id]: commands },
    });
    renderSurfaces(activeSessionId);
    expectSurfaces('running', { executing: true });

    // Only the server status changes. No command-array refresh/remount is needed.
    act(() => {
      useGraphStore.setState(activeSessionId === null
        ? { agents: [{ ...agent, status: 'idle' }] }
        : { subAgents: { [agent.id]: [{ ...session, status: 'idle' }] } });
    });
    expect(useGraphStore.getState().queuedCommands[agent.id]).toBe(commands);
    expectSurfaces('done');

    act(() => {
      useGraphStore.setState({ queuedCommands: { [agent.id]: [...commands, pending] } });
    });
    expectSurfaces('waiting');
  });
});
