import { createElement, type ComponentProps } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentCardTaskBook, AppBubble, BubbleData, SubAgent } from '@vibisual/shared';
import { DEFAULT_IDE_OVERLAY, agentSessionInputKey, useGraphStore } from '../../stores/graphStore.js';
import { AgentCardNode } from './AgentCardNode.js';
import { AgentCardTaskControls } from './AgentCardTaskControls.js';
import { CARD_TASK_DRAFT, cardTaskKey, useCardTaskStore } from './agentCardTaskState.js';
import { recordCardTaskSend, reserveCardTask, restoreCardTaskDraft, selectCardTask } from './agentCardTaskFlow.js';
import { composeLinkedBriefs } from './linkedNodeBriefs.js';

vi.mock('@xyflow/react', () => ({ Handle: () => null, Position: { Top: 'top' } }));
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./useCanvasNodeSelection.js', () => ({ useCanvasNodeSelection: () => ({ replace: () => {}, toggle: () => {} }) }));
vi.mock('./BubbleNode.js', () => ({ BubbleNode: () => null }));
vi.mock('./BubbleContextMenu.js', () => ({ BUBBLE_MENU_EVENT: 'bubble-menu' }));
vi.mock('../../apps/registry.js', () => ({
  getInternalApp: () => ({ name: 'Vibi3D', nameKey: 'app.vibi3d', glow: '#aabbcc', taskDocument: async () => undefined }),
  appOutputExtensions: () => ['.glb'],
}));
vi.mock('./linkedNodeBriefs.js', () => ({ composeLinkedBriefs: vi.fn() }));
vi.mock('./agentCardTaskFlow.js', () => ({
  reserveCardTask: vi.fn(), restoreCardTaskDraft: vi.fn(), selectCardTask: vi.fn(), recordCardTaskSend: vi.fn(),
}));
// Keep the real reactive task store, but isolate polling and background reservation runners.
vi.mock('./useAgentCardTasks.js', async () => {
  const { cardTaskKey: keyOf, useCardTaskStore: taskStore } = await import('./agentCardTaskState.js');
  return { useAgentCardTasks: (agentId: string) => {
    const key = keyOf('/project', agentId);
    const entry = taskStore((state) => state.entries[key]);
    return { projectId: '/project', key, entry };
  } };
});

const initialGraph = useGraphStore.getState();
const agent: BubbleData = { id: 'task-ui-agent', label: 'Agent', bubbleType: 'agent', path: '/project', status: 'idle', activity: 0, customCreated: true, agentForm: 'card' };
const project = '/project';
const key = cardTaskKey(project, agent.id);
const sub = (id: string, status: SubAgent['status'] = 'idle'): SubAgent => ({ id, parentAgentId: agent.id, sessionId: `thread-${id}`, label: id, status, createdAt: 1, lastActivityAt: 1 });
const bubble = (id: string, title: string): AppBubble => ({ id, appId: 'vibi3d', projectName: 'Project', title, ref: `document-${id}`,
  x: 1, y: 1, width: 100, height: 100, linkedAgentIds: [agent.id], createdAt: 1 });
const oldNode = bubble('old-node', 'Apartment result');
const otherNode = bubble('other-node', 'Tree result');
const addCommand = vi.fn<NonNullable<typeof initialGraph.addCommand>>();
const reserve = vi.mocked(reserveCardTask);
let renderer: ReactTestRenderer | undefined;

function book(): AgentCardTaskBook {
  return { revision: 1, activeTaskId: 'apartment', tasks: [
    { id: 'apartment', title: 'Apartment model', sessionId: 'old-session', nodeIds: [oldNode.id], createdAt: 1 },
    { id: 'tree', title: 'Tree model', sessionId: 'other-session', nodeIds: [otherNode.id], createdAt: 2 },
  ] };
}
function mount(): void {
  const props: ComponentProps<typeof AgentCardNode> = { id: agent.id, data: { ...agent }, type: 'bubble', selected: false,
    dragging: false, draggable: true, selectable: true, deletable: true, isConnectable: true,
    positionAbsoluteX: 0, positionAbsoluteY: 0, zIndex: 0 };
  act(() => { renderer = create(createElement(AgentCardNode, props)); });
}
function field(): ReactTestInstance { return renderer!.root.findByType('textarea'); }
function textOf(node: ReactTestInstance): string { return node.children.map(child => typeof child === 'string' ? child : textOf(child)).join(''); }
function button(label: string): ReactTestInstance {
  return renderer!.root.findAllByType('button').find(node => textOf(node) === label)!;
}
function select(label: string): ReactTestInstance { return renderer!.root.findByProps({ 'aria-label': label }); }
function type(text: string): void { act(() => field().props.onChange({ target: { value: text } })); }
function begin(mode: 'new' | 'copy'): void { act(() => select('canvas.agentCard.tasks.new').props.onChange({ target: { value: mode } })); }
function send(): void { renderer!.root.findByProps({ 'aria-label': 'canvas.agentCard.send' }).props.onClick({ stopPropagation: () => {} }); }
function draft(sessionId: string): string | undefined { return useGraphStore.getState().agentSessionInputs[agentSessionInputKey(agent.id, sessionId)]?.text; }
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  useGraphStore.setState(initialGraph, true);
  useGraphStore.setState({ agents: [agent], projects: { p: { name: 'Project', path: project } }, activeProject: 'Project',
    agentProjects: { [agent.id]: 'Project' }, agentConfigs: {}, subAgents: { [agent.id]: [sub('old-session'), sub('other-session')] },
    appBubbles: [oldNode, otherNode], agentSessionInputs: {}, queuedCommands: {}, completedCommands: {}, runningSubagentTasks: {},
    acknowledgedSubAgents: {}, selectedSubByAgent: {}, ideOverlays: {}, selectIntentId: null, addCommand });
  useCardTaskStore.setState({ entries: { [key]: { book: book() } } });
  addCommand.mockReset().mockResolvedValue({ id: 'accepted', subAgentId: 'old-session' });
  reserve.mockReset().mockResolvedValue(undefined);
  vi.mocked(restoreCardTaskDraft).mockReset().mockResolvedValue(undefined);
  vi.mocked(selectCardTask).mockReset().mockResolvedValue(undefined);
  vi.mocked(recordCardTaskSend).mockReset().mockResolvedValue(undefined);
  vi.mocked(composeLinkedBriefs).mockReset().mockResolvedValue([]);
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  useGraphStore.setState(initialGraph, true);
  useCardTaskStore.setState({ entries: {} });
  vi.useRealTimers();
});

describe('AgentCardNode task interactions', () => {
  it('shows the current work and sends to its saved conversation ahead of another active IDE session', async () => {
    useGraphStore.setState({ subAgents: { [agent.id]: [sub('old-session'), sub('other-session', 'active')] },
      selectedSubByAgent: { [agent.id]: 'other-session' }, ideOverlays: { pane: { ...DEFAULT_IDE_OVERLAY,
        projectId: 'Project', agentId: agent.id, activeSessionId: 'other-session', z: 1 } } });
    useGraphStore.getState().setAgentSessionInputText(agent.id, 'old-session', '창문을 크게 바꿔줘');
    useGraphStore.getState().setAgentSessionInputText(agent.id, 'other-session', 'Other draft');
    mount();
    expect(select('canvas.agentCard.tasks.history').props).toMatchObject({ value: 'apartment', title: 'Apartment model' });
    expect(field().props).toMatchObject({ value: '창문을 크게 바꿔줘', placeholder: 'canvas.agentCard.tasks.editPlaceholder' });
    expect(button('Apartment result')).toBeDefined(); expect(button('Tree result')).toBeUndefined();
    await act(async () => send());
    expect(addCommand).toHaveBeenCalledWith(agent.id, '창문을 크게 바꿔줘', 'old-session', undefined, { draftText: '창문을 크게 바꿔줘' });
    expect(draft('other-session')).toBe('Other draft');
  });

  it('keeps the current draft and the new-task draft separate across cancel and reopen', () => {
    useGraphStore.getState().setAgentSessionInputText(agent.id, 'old-session', '기존 창문 수정');
    mount(); begin('new');
    expect(field().props.value).toBe('');
    expect(field().props.placeholder).toBe('canvas.agentCard.tasks.placeholder');
    expect(textOf(renderer!.root)).toContain('canvas.agentCard.tasks.newNotice');
    type('별도 자동차 모델');
    act(() => button('canvas.agentCard.tasks.cancel').props.onClick());
    expect(field().props.value).toBe('기존 창문 수정');
    expect(draft(CARD_TASK_DRAFT)).toBe('별도 자동차 모델');
    begin('copy');
    expect(field().props.value).toBe('별도 자동차 모델');
    expect(textOf(renderer!.root)).toContain('canvas.agentCard.tasks.copyNotice');
    expect(reserve).not.toHaveBeenCalled(); expect(addCommand).not.toHaveBeenCalled();
  });

  it('reserves a separate new request while keeping the current result and showing the queued text', async () => {
    reserve.mockImplementationOnce(async (args) => {
      useCardTaskStore.getState().patch(key, { book: { ...book(), pending: { id: 'pending', mode: args.mode,
        text: args.text, sourceTaskId: 'apartment', nodeIds: args.targetNodeIds, createdAt: 1, status: 'waiting' } } });
      useGraphStore.getState().setAgentSessionInputText(agent.id, CARD_TASK_DRAFT, '');
    });
    mount(); begin('new'); type('Separate car');
    await act(async () => send());
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ projectId: project, agentId: agent.id,
      mode: 'new', text: 'Separate car', sessionId: 'old-session', currentNodes: [oldNode], targetNodeIds: [oldNode.id], title: 'Apartment model' }));
    expect(field().props).toMatchObject({ value: 'Separate car', readOnly: true });
    expect(textOf(renderer!.root)).toContain('canvas.agentCard.tasks.queued');
    expect(select('canvas.agentCard.tasks.new').props.disabled).toBe(true);
    expect(useGraphStore.getState().appBubbles).toEqual([oldNode, otherNode]);
    expect(addCommand).not.toHaveBeenCalled();
  });

  it('asks where an ambiguous creation request belongs and sends only after current work is chosen', async () => {
    mount(); type('자동차 만들어줘');
    act(() => send());
    expect(textOf(renderer!.root)).toContain('canvas.agentCard.tasks.destination');
    expect(addCommand).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
    await act(async () => button('canvas.agentCard.tasks.here').props.onClick());
    expect(addCommand).toHaveBeenCalledWith(agent.id, '자동차 만들어줘', 'old-session', undefined, { draftText: '자동차 만들어줘' });
    expect(reserve).not.toHaveBeenCalled();
    expect(button('canvas.agentCard.tasks.separate')).toBeUndefined();
  });

  it('clears an ambiguous current draft only after the separate-task reservation succeeds', async () => {
    const reservation = deferred(); reserve.mockReturnValueOnce(reservation.promise);
    mount(); type('자동차 만들어줘'); act(() => send());
    act(() => button('canvas.agentCard.tasks.separate').props.onClick());
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ mode: 'new', text: '자동차 만들어줘', sessionId: 'old-session' }));
    expect(draft('old-session')).toBe('자동차 만들어줘');
    expect(select('canvas.agentCard.tasks.new').props.disabled).toBe(true);
    await act(async () => { reservation.resolve(); await reservation.promise; });
    expect(draft('old-session')).toBe('');
    expect(addCommand).not.toHaveBeenCalled();
  });

  it('preserves the current and recovery drafts when reserving a separate request fails', async () => {
    reserve.mockRejectedValueOnce(new Error('history-save-failed'));
    mount(); type('자동차 만들어줘'); act(() => send());
    await act(async () => button('canvas.agentCard.tasks.separate').props.onClick());
    expect(draft('old-session')).toBe('자동차 만들어줘');
    expect(draft(CARD_TASK_DRAFT)).toBe('자동차 만들어줘');
    expect(field().props).toMatchObject({ value: '자동차 만들어줘', readOnly: false });
    expect(textOf(renderer!.root)).toContain('canvas.agentCard.tasks.failed');
    expect(addCommand).not.toHaveBeenCalled();
  });

  it('selects history and restores that conversation draft and result without rebinding the old documents', async () => {
    vi.mocked(selectCardTask).mockImplementation(async (_project, _agent, id) => {
      useCardTaskStore.getState().patch(key, { book: { ...book(), activeTaskId: id } });
    });
    useGraphStore.getState().setAgentSessionInputText(agent.id, 'old-session', 'Apartment draft');
    useGraphStore.getState().setAgentSessionInputText(agent.id, 'other-session', 'Tree draft');
    mount();
    await act(async () => select('canvas.agentCard.tasks.history').props.onChange({ target: { value: 'tree' } }));
    expect(selectCardTask).toHaveBeenCalledWith(project, agent.id, 'tree');
    expect(field().props.value).toBe('Tree draft');
    expect(button('Tree result')).toBeDefined(); expect(button('Apartment result')).toBeUndefined();
    await act(async () => select('canvas.agentCard.tasks.history').props.onChange({ target: { value: 'apartment' } }));
    expect(field().props.value).toBe('Apartment draft');
    expect(button('Apartment result')).toBeDefined();
    expect(useGraphStore.getState().appBubbles).toEqual([oldNode, otherNode]);
    expect(addCommand).not.toHaveBeenCalled();
  });
});

describe('AgentCardTaskControls recovery clock', () => {
  it('reveals explicit draft recovery after the preparation lease expires without allowing an early duplicate send', () => {
    const restore = vi.fn();
    const pending: AgentCardTaskBook = { ...book(), pending: { id: 'pending', mode: 'new', text: 'Keep this request',
      sourceTaskId: 'apartment', nodeIds: [oldNode.id], createdAt: Date.now(), status: 'preparing', leaseUntil: Date.now() + 1000 } };
    act(() => { renderer = create(createElement(AgentCardTaskControls, { book: pending, title: 'Apartment model', disabled: false,
      canCopy: true, choosing: false, begin: vi.fn(), select: vi.fn(), cancel: vi.fn(), restore, choose: vi.fn() })); });
    expect(button('canvas.agentCard.tasks.restore')).toBeUndefined();
    expect(select('canvas.agentCard.tasks.history').props.disabled).toBe(true);
    expect(select('canvas.agentCard.tasks.new').props.disabled).toBe(true);
    act(() => { vi.advanceTimersByTime(1001); });
    expect(button('canvas.agentCard.tasks.restore')).toBeDefined();
    expect(restore).not.toHaveBeenCalled();
    act(() => button('canvas.agentCard.tasks.restore').props.onClick());
    expect(restore).toHaveBeenCalledTimes(1);
  });
});
