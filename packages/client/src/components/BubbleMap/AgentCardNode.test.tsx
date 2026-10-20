import { createElement, type ComponentProps } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BubbleData, CommandReceipt, QueuedCommand, SubAgent } from '@vibisual/shared';
import { DEFAULT_AGENT_CONFIG } from '@vibisual/shared';
import { agentSessionInputKey, useGraphStore } from '../../stores/graphStore.js';
import { AgentCardNode } from './AgentCardNode.js';
import { composeLinkedBriefs } from './linkedNodeBriefs.js';
import type { LinkedOutputNode } from './agentCard.js';

vi.mock('@xyflow/react', () => ({ Handle: () => null, Position: { Top: 'top' } }));
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./useCanvasNodeSelection.js', () => ({
  useCanvasNodeSelection: () => ({ replace: () => {}, toggle: () => {} }),
}));
vi.mock('./BubbleNode.js', () => ({ BubbleNode: () => null }));
vi.mock('./BubbleContextMenu.js', () => ({ BUBBLE_MENU_EVENT: 'bubble-menu' }));
vi.mock('../../apps/registry.js', () => ({
  getInternalApp: () => undefined,
  appOutputExtensions: () => [],
}));
vi.mock('./linkedNodeBriefs.js', () => ({ composeLinkedBriefs: vi.fn() }));

const initialState = useGraphStore.getState();
const agent: BubbleData = {
  id: 'agent-card-status', label: 'Agent', bubbleType: 'agent', path: '/project',
  status: 'idle', activity: 0, customCreated: true, agentForm: 'card',
};
const inputKey = agentSessionInputKey(agent.id, null);
const addCommand = vi.fn<NonNullable<typeof initialState.addCommand>>();
const prepare = vi.mocked(composeLinkedBriefs);
let renderer: ReactTestRenderer | undefined;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function props(status: BubbleData['status'] = 'idle'): ComponentProps<typeof AgentCardNode> {
  return {
    id: agent.id, data: { ...agent, status }, type: 'bubble', selected: false,
    dragging: false, draggable: true, selectable: true, deletable: true, isConnectable: true,
    positionAbsoluteX: 0, positionAbsoluteY: 0, zIndex: 0,
  };
}

function mount(status: BubbleData['status'] = 'idle'): void {
  act(() => {
    useGraphStore.setState({ agents: [{ ...agent, status }] });
    renderer = create(createElement(AgentCardNode, props(status)));
  });
}

function updateStatus(status: BubbleData['status']): void {
  act(() => {
    useGraphStore.setState({ agents: [{ ...agent, status }] });
    renderer!.update(createElement(AgentCardNode, props(status)));
  });
}

function field(): ReactTestInstance { return renderer!.root.findByType('textarea'); }
function sendButton(): ReactTestInstance {
  return renderer!.root.findByProps({ 'aria-label': 'canvas.agentCard.send' });
}
function statusLine(): ReactTestInstance { return renderer!.root.findByProps({ role: 'status' }); }
function disc(): ReactTestInstance { return renderer!.root.findByProps({ 'data-agent-card-disc': true }); }
function statusEffects(status: BubbleData['status']): ReactTestInstance {
  return renderer!.root.findByProps({ 'data-agent-card-status': status });
}
function pulseRings(): ReactTestInstance[] {
  return renderer!.root.findAll((node) => node.type === 'div'
    && typeof node.props.className === 'string' && node.props.className.includes('animate-pulse-ring'));
}
function resultHalos(color: string): ReactTestInstance[] {
  return renderer!.root.findAll((node) => node.type === 'div' && node.props.style?.boxShadow === `0 0 20px 8px ${color}`);
}
function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textOf(child)).join('');
}
function expectStatus(key: string, busy: boolean): void {
  expect(textOf(statusLine())).toContain(key);
  expect(statusLine().props['aria-live']).toBe('polite');
  expect(statusLine().props['aria-busy']).toBe(busy);
}
function type(text: string): void {
  act(() => field().props.onChange({ target: { value: text } }));
}
function clickSend(): void {
  act(() => sendButton().props.onClick({ stopPropagation: () => {} }));
}
function enter(text: string): void {
  field().props.onKeyDown({
    key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false,
    nativeEvent: { isComposing: false, keyCode: 13 }, currentTarget: { value: text },
    preventDefault: () => {}, stopPropagation: () => {},
  });
}
function command(status: QueuedCommand['status'], subAgentId: string | null = null): QueuedCommand {
  return { id: 'command', text: 'Run this', timestamp: 1, status, subAgentId };
}

beforeEach(() => {
  vi.useFakeTimers();
  useGraphStore.setState(initialState, true);
  useGraphStore.setState({
    agents: [agent], subAgents: {}, agentConfigs: {}, agentSessionInputs: {},
    appBubbles: [], activeProject: null, selectedSubByAgent: {}, queuedCommands: {},
    runningSubagentTasks: {}, acknowledgedSubAgents: {}, selectIntentId: null, addCommand,
  });
  addCommand.mockReset().mockResolvedValue(undefined);
  prepare.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  useGraphStore.setState(initialState, true);
  vi.useRealTimers();
});

describe('AgentCardNode visible execution feedback', () => {
  it('uses the default, saved and pending surface without changing disc geometry or activity effects', () => {
    mount('active');
    expect(disc().props['data-bubble-skin']).toBe('signal');
    expect(disc().props['data-vb-theme-lock']).toBe('dark');
    const bounds = { width: disc().props.style.width, height: disc().props.style.height, left: disc().props.style.left, top: disc().props.style.top };
    act(() => useGraphStore.setState({ userDefaults: { updatedAt: 1, appearance: { bubbleSkin: 'frost' } } }));
    expect(disc().props['data-bubble-skin']).toBe('frost');
    act(() => useGraphStore.setState({ bubbleAppearancePending: { bubbleSkin: 'twin' } }));
    expect(disc().props['data-bubble-skin']).toBe('twin');
    expect(disc().props.style).toMatchObject(bounds);
    expect(pulseRings()).toHaveLength(2);
    act(() => useGraphStore.setState({ bubbleAppearancePending: null }));
    expect(disc().props['data-bubble-skin']).toBe('frost');
    expect(disc().props.style).toMatchObject(bounds);
  });

  it('preserves the bubble disc effects through idle, active, completed, error, and permission states', () => {
    mount();
    expect(statusEffects('idle').props.className).toContain('pointer-events-none');
    expect(pulseRings()).toHaveLength(0);
    expect(resultHalos('#22D3EE')).toHaveLength(0);
    expect(resultHalos('#F43F5E')).toHaveLength(0);

    updateStatus('active');
    expect(statusEffects('active').props.style.width).toBe(disc().props.style.width);
    expect(statusEffects('active').props.style.height).toBe(disc().props.style.height);
    expect(pulseRings()).toHaveLength(2);
    expect(pulseRings()[1]?.props.style.animationDelay).toBe('0.75s');

    updateStatus('completed');
    expect(pulseRings()).toHaveLength(0);
    expect(disc().props.className).toContain('border-cyan-400');
    expect(resultHalos('#22D3EE')).toHaveLength(1);
    expect(resultHalos('#22D3EE')[0]?.props.style.animationDuration).toBe('3s');

    updateStatus('error');
    expect(disc().props.className).toContain('border-rose-500');
    expect(resultHalos('#22D3EE')).toHaveLength(0);
    expect(resultHalos('#F43F5E')).toHaveLength(1);

    updateStatus('awaiting_permission');
    expect(disc().props.className).toContain('border-amber-400');
    expect(disc().props.className).toContain('animate-pulse');
    expect(resultHalos('#F43F5E')).toHaveLength(0);
    expect(renderer!.root.findByProps({ 'aria-label': 'common.bubble.awaitingPermission' }).props.className).toContain('z-20');

    updateStatus('idle');
    expect(pulseRings()).toHaveLength(0);
    expect(disc().props.className).not.toContain('animate-pulse');
  });

  it('uses the custom agent glow for both working rings', () => {
    useGraphStore.setState({ agentConfigs: { [agent.id]: { ...DEFAULT_AGENT_CONFIG, color: '#10B981' } } });
    mount('active');
    expect(pulseRings()).toHaveLength(2);
    expect(pulseRings().map((ring) => ring.props.style.borderColor)).toEqual(['#10B981', '#10B981']);
  });

  it('keeps completion glow when selected without overriding the state ring shadow', () => {
    mount('completed');
    act(() => renderer!.update(createElement(AgentCardNode, { ...props('completed'), selected: true })));
    expect(disc().props.className).toContain('shadow-cyan-400/30');
    expect(disc().props.style.boxShadow).toBeUndefined();
    expect(resultHalos('#22D3EE')).toHaveLength(1);
  });

  it('announces server state changes in the balloon without hovering the disc', () => {
    mount();
    expectStatus('canvas.agentCard.status.idle', false);
    expect(statusLine().parent).toBe(field().parent);
    expect(field().parent!.children.indexOf(statusLine())).toBeLessThan(field().parent!.children.indexOf(field()));

    updateStatus('active');
    expectStatus('canvas.agentCard.status.active', true);
    updateStatus('awaiting_permission');
    expectStatus('canvas.agentCard.status.waiting', false);
    updateStatus('completed');
    expectStatus('canvas.agentCard.status.completed', false);
    updateStatus('error');
    expectStatus('canvas.agentCard.status.error', false);
  });

  it('distinguishes queued work from running work and ignores stale execution records after completion', () => {
    mount('completed');
    act(() => useGraphStore.setState({ queuedCommands: { [agent.id]: [command('queued')] } }));
    expectStatus('panel.subAgent.status.waiting', false);
    act(() => useGraphStore.setState({
      agents: [{ ...agent, status: 'active' }],
      queuedCommands: { [agent.id]: [command('executing')] },
    }));
    expectStatus('canvas.agentCard.status.active', true);
    // The shared session predicate must not revive a completed session from a stale queue record.
    act(() => useGraphStore.setState({ agents: [{ ...agent, status: 'completed' }] }));
    expectStatus('canvas.agentCard.status.completed', false);
  });

  it('does not mark the selected session busy because another session has queued work', () => {
    const session: SubAgent = {
      id: 'selected-session', sessionId: 'thread', label: 'Session', parentAgentId: agent.id,
      status: 'idle', createdAt: 1, lastActivityAt: 1,
    };
    useGraphStore.setState({
      subAgents: { [agent.id]: [session] }, selectedSubByAgent: { [agent.id]: session.id },
      queuedCommands: { [agent.id]: [command('queued', 'other-session')] },
    });
    mount();
    expectStatus('canvas.agentCard.status.idle', false);
    act(() => useGraphStore.setState({ queuedCommands: { [agent.id]: [command('queued', session.id)] } }));
    expectStatus('panel.subAgent.status.waiting', false);
  });

  it('shows queued-only work as waiting when an unselected parent retains active status', () => {
    const session: SubAgent = {
      id: 'unselected-session', sessionId: 'thread', label: 'Session', parentAgentId: agent.id,
      status: 'idle', createdAt: 1, lastActivityAt: 1,
    };
    useGraphStore.setState({
      subAgents: { [agent.id]: [session] },
      queuedCommands: { [agent.id]: [command('queued', session.id)] },
    });
    mount('active');
    expectStatus('panel.subAgent.status.waiting', false);
    expect(renderer!.root.findAll((node) => typeof node.props.className === 'string'
      && node.props.className.includes('agent-orbit-spin'))).toHaveLength(0);
    // The disc remains the aggregate bubble; the input header and orbit describe its selected work.
    expect(statusEffects('active')).toBeTruthy();
    expect(pulseRings()).toHaveLength(2);

    // A stale executing record must not revive the now-idle owning session either.
    act(() => useGraphStore.setState({ queuedCommands: { [agent.id]: [command('executing', session.id)] } }));
    expectStatus('canvas.agentCard.status.idle', false);
  });

  it.each(['owned', 'unassigned', 'unknown-owner', 'shell'] as const)(
    'keeps %s background work accurate when no session is selected', (kind) => {
      const session: SubAgent = {
        id: 'unselected-session', sessionId: 'thread', label: 'Session', parentAgentId: agent.id,
        status: 'idle', createdAt: 1, lastActivityAt: 1,
      };
      useGraphStore.setState({
        subAgents: { [agent.id]: [session] },
        queuedCommands: { [agent.id]: [command('queued', session.id)] },
        runningSubagentTasks: { [agent.id]: [{
          id: 'background-task', parentAgentId: agent.id, startedAt: 1,
          subAgentId: kind === 'owned' ? session.id : kind === 'unknown-owner' ? 'missing-session' : undefined,
          origin: kind === 'shell' ? 'stream' : 'hook',
        }] },
      });
      mount('active');
      expectStatus(kind === 'shell' ? 'panel.subAgent.status.waiting' : 'canvas.agentCard.status.active', kind !== 'shell');
    },
  );

  it.each(['error', 'awaiting_permission'] as const)('keeps %s visible when another command is queued', (status) => {
    useGraphStore.setState({ queuedCommands: { [agent.id]: [command('queued')] } });
    mount(status);
    expectStatus(`canvas.agentCard.status.${status === 'error' ? 'error' : 'waiting'}`, false);
  });

  it('shows sending throughout brief preparation and dispatch, blocks duplicate Enter, and permits the next command', async () => {
    const brief = deferred<LinkedOutputNode[]>();
    const dispatch = deferred<CommandReceipt | null>();
    prepare.mockReturnValueOnce(brief.promise);
    addCommand.mockReturnValueOnce(dispatch.promise);
    mount();
    type('First command');

    // Both events happen before React commits: disabling the button alone cannot prevent this duplicate.
    act(() => { enter('First command'); enter('First command'); });
    expectStatus('ide.askQuestion.sending', true);
    expect(field().props.value).toBe('');
    expect(sendButton().props.disabled).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(addCommand).not.toHaveBeenCalled();

    type('Second command');
    act(() => enter('Second command'));
    expect(field().props.value).toBe('Second command');
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(sendButton().props.disabled).toBe(true);

    await act(async () => { brief.resolve([]); await brief.promise; });
    expect(addCommand).toHaveBeenCalledExactlyOnceWith(agent.id, 'First command', null);
    expectStatus('ide.askQuestion.sending', true);
    act(() => enter('Second command'));
    expect(addCommand).toHaveBeenCalledTimes(1);
    expect(sendButton().props.disabled).toBe(true);

    await act(async () => { dispatch.resolve({ id: 'accepted', subAgentId: null }); await dispatch.promise; });
    updateStatus('completed');
    expectStatus('canvas.agentCard.status.completed', false);
    expect(sendButton().props.disabled).toBe(false);
    await act(async () => sendButton().props.onClick({ stopPropagation: () => {} }));
    expect(addCommand).toHaveBeenCalledTimes(2);
    expect(addCommand).toHaveBeenLastCalledWith(agent.id, 'Second command', null);
  });

  it('restores a brief-preparation failure without losing the draft typed while waiting', async () => {
    const brief = deferred<LinkedOutputNode[]>();
    prepare.mockReturnValueOnce(brief.promise);
    mount();
    type('First command');
    clickSend();
    type('New draft');
    await act(async () => { brief.reject(new Error('Brief preparation failed')); await brief.promise.catch(() => {}); });

    expectStatus('canvas.agentCard.status.error', false);
    expect(field().props.value).toBe('First command\n\nNew draft');
    expect(addCommand).not.toHaveBeenCalled();
    expect(sendButton().props.disabled).toBe(false);

    type('Retry command');
    await act(async () => sendButton().props.onClick({ stopPropagation: () => {} }));
    expect(addCommand).toHaveBeenCalledExactlyOnceWith(agent.id, 'Retry command', null);
    expectStatus('canvas.agentCard.status.idle', false);
  });

  it('passes app execution requirements and the original request through the normal command transport', async () => {
    prepare.mockResolvedValue([{ id: 'app-node', appName: 'Sample', label: 'Document', accepts: [], brief: 'Use live commands',
      executionRequirements: { localTransport: true, runLimits: { maxTurns: 160, maxMinutes: 120 } } }]);
    mount();
    type('Build the document');
    await act(async () => clickSend());
    expect(prepare).toHaveBeenCalledWith(expect.any(Array), 'Build the document');
    // §5.1 #2-1 (F) ① — 앱 작업 보기의 귀속은 이 명령이 실어 가는 앱 노드 id 로 정해진다(본문 글자 대신).
    expect(addCommand).toHaveBeenCalledWith(agent.id, expect.stringContaining('Build the document'), null, undefined, {
      executionRequirements: { localTransport: true }, runLimits: { maxTurns: 160, maxMinutes: 120 }, appNodeIds: ['app-node'],
    });
  });

  it.each([
    ['rejected', 'ide.mainArea.sendRejected'],
    ['unconfirmed', 'ide.mainArea.sendUnconfirmed'],
    ['local-images-unsupported', 'ide.mainArea.localImagesUnsupported'],
  ] as const)('shows the stored %s send failure and keeps the restored draft editable', (sendFailure, message) => {
    useGraphStore.setState({ agentSessionInputs: { [inputKey]: { text: 'Retry this', attachments: [], sendFailure } } });
    mount();
    expectStatus('canvas.agentCard.status.error', false);
    expect(field().props.value).toBe('Retry this');
    expect(statusLine().props.title).toBe(message);
    type('Edited command');
    expectStatus('canvas.agentCard.status.idle', false);
    expect(field().props.value).toBe('Edited command');
  });

  it('shows an engine preparation rejection as a failure rather than idle', () => {
    useGraphStore.setState({ agentSessionInputs: { [inputKey]: {
      text: 'Retry this', attachments: [], sendError: { engine: 'claude', action: 'login' },
    } } });
    mount();
    expectStatus('canvas.agentCard.status.error', false);
    expect(statusLine().props.title).toBeTruthy();
    expect(field().props.value).toBe('Retry this');
  });
});
