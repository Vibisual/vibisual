import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentCardTaskBook, AppBubble, BubbleData, SubAgent } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { prepareAppTaskTransition } from '../../apps/appTaskTransition.js';
import { composeLinkedBriefs } from './linkedNodeBriefs.js';
import { cardTaskKey, loadCardTasks, saveCardTasks, useCardTaskStore } from './agentCardTaskState.js';
import { recordCardTaskSend, reserveCardTask, restoreCardTaskDraft, runReservedCardTask } from './agentCardTaskFlow.js';

vi.mock('../../apps/appTaskTransition.js', () => ({ prepareAppTaskTransition: vi.fn() }));
vi.mock('./linkedNodeBriefs.js', () => ({ composeLinkedBriefs: vi.fn() }));
vi.mock('../../apps/registry.js', () => ({ getInternalApp: () => ({ name: 'Vibi3D' }), appOutputExtensions: () => [] }));
vi.mock('./agentCardTaskState.js', async (original) => ({
  ...await original<typeof import('./agentCardTaskState.js')>(), loadCardTasks: vi.fn(), saveCardTasks: vi.fn(),
}));
const initial = useGraphStore.getState();
const agent: BubbleData = { id: 'agent', label: 'Agent', bubbleType: 'agent', path: '/project', status: 'idle', activity: 0, customCreated: true };
const sub: SubAgent = { id: 'old-session', parentAgentId: 'agent', sessionId: 'thread', label: 'Old', status: 'idle', createdAt: 1, lastActivityAt: 1 };
const source: AppBubble = { id: 'source', appId: 'vibi3d', projectName: 'Project', x: 1, y: 2, width: 200, height: 200,
  ref: 'original-doc', title: 'Building', linkedAgentIds: ['agent'], createdAt: 1 };
const key = cardTaskKey('/project', 'agent');
let book: AgentCardTaskBook;
const send = vi.fn<NonNullable<typeof initial.addCommand>>();
let requests: Array<{ url: string; body: Record<string, unknown> }>;

beforeEach(() => {
  requests = [];
  useGraphStore.setState(initial, true);
  useCardTaskStore.setState({ entries: {} });
  useGraphStore.setState({ agents: [agent], projects: { p: { path: '/project', name: 'Project' } },
    agentProjects: { agent: 'Project' }, activeProject: 'Project', subAgents: { agent: [sub] },
    appBubbles: [source], queuedCommands: {}, completedCommands: {}, runningSubagentTasks: {}, addCommand: send, agentSessionInputs: {} });
  book = { revision: 0, activeTaskId: 'old', tasks: [{ id: 'old', title: 'Building', sessionId: sub.id, nodeIds: [source.id], createdAt: 1 }] };
  vi.mocked(loadCardTasks).mockImplementation(async () => { useCardTaskStore.getState().patch(key, { book }); return book; });
  vi.mocked(saveCardTasks).mockImplementation(async (_project, _agent, next) => {
    if (next.revision !== book.revision) throw new Error('revision-conflict');
    book = { ...next, revision: book.revision + 1 };
    useCardTaskStore.getState().patch(key, { book });
    return book;
  });
  vi.mocked(prepareAppTaskTransition).mockReset().mockResolvedValue({ previous: { ref: 'original-doc' }, next: { ref: 'new-doc' } });
  vi.mocked(composeLinkedBriefs).mockReset().mockImplementation(async (nodes) => [...nodes]);
  send.mockReset().mockResolvedValue({ id: 'command', subAgentId: 'new-session' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    requests.push({ url, body });
    if (url.includes('/subagents/')) return new Response(JSON.stringify({ ok: true, subAgent: { ...sub, id: 'new-session', sessionId: '' } }));
    if (url === '/api/app-bubbles') return new Response(JSON.stringify({ ok: true, data: { ...body, createdAt: 2 } }));
    const id = url.split('/').pop();
    const bubble = useGraphStore.getState().appBubbles.find((node) => node.id === id);
    return new Response(JSON.stringify({ ok: true, data: { ...bubble, ...body } }));
  }));
});
afterEach(() => { useGraphStore.setState(initial, true); useCardTaskStore.setState({ entries: {} }); vi.unstubAllGlobals(); });
async function reserve(mode: 'new' | 'copy' = 'new'): Promise<void> {
  await reserveCardTask({ projectId: '/project', agentId: agent.id, mode, text: 'Create a tree', sessionId: sub.id,
    currentNodes: [source], targetNodeIds: [source.id], title: source.title! });
}

describe('new task reservation and dispatch', () => {
  it('saves the request while working, then creates separate outputs and an explicit fresh conversation', async () => {
    useGraphStore.setState({ subAgents: { agent: [{ ...sub, status: 'active' }] } });
    await reserve();
    await runReservedCardTask('/project', agent.id);
    expect(book.pending?.status).toBe('waiting');
    expect(prepareAppTaskTransition).not.toHaveBeenCalled();
    useGraphStore.setState({ subAgents: { agent: [sub] } });
    await runReservedCardTask('/project', agent.id);
    expect(book.pending).toBeUndefined();
    expect(book.tasks).toHaveLength(2);
    expect(book.tasks[0]?.sessionId).toBe('old-session');
    expect(book.tasks[1]?.sessionId).toBe('new-session');
    expect(book.tasks[1]?.nodeIds).not.toContain(source.id);
    expect(useGraphStore.getState().appBubbles.find((node) => node.id === source.id)?.ref).toBe('original-doc');
    expect(requests.find((request) => request.url === '/api/app-bubbles')?.body.linkedAgentIds).toEqual([]);
    expect(send).toHaveBeenCalledWith(agent.id, expect.stringContaining('Create a tree'), 'new-session', undefined,
      expect.objectContaining({ draftText: 'Create a tree', afterAgentWork: true }));
    expect(send.mock.calls[0]?.[1]).not.toContain('node source ');
  });
  it('does not allocate destinations, clear the source, or send when the live save fails', async () => {
    vi.mocked(prepareAppTaskTransition).mockRejectedValue(new Error('app-task-save-failed'));
    await reserve('copy');
    await runReservedCardTask('/project', agent.id);
    expect(book.activeTaskId).toBe('old');
    expect(book.pending).toMatchObject({ status: 'failed', text: 'Create a tree' });
    expect(requests).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    await restoreCardTaskDraft('/project', agent.id);
    expect(book.pending).toBeUndefined();
    expect(useCardTaskStore.getState().entries[key]?.mode).toBe('copy');
  });
  it('retains the prepared task after rejection and restores its draft without allocating a second document', async () => {
    send.mockResolvedValue(null);
    await reserve();
    await runReservedCardTask('/project', agent.id);
    expect(book.pending?.status).toBe('failed');
    const preparedId = book.pending?.taskId;
    expect(preparedId).toBe(book.activeTaskId);
    await restoreCardTaskDraft('/project', agent.id);
    expect(book.activeTaskId).toBe(preparedId);
    expect(book.pending).toBeUndefined();
    expect(useCardTaskStore.getState().entries[key]?.mode).toBeUndefined();
    expect(prepareAppTaskTransition).toHaveBeenCalledTimes(1);
  });
  it('only one runner can claim a persisted waiting request', async () => {
    await reserve();
    await Promise.all([runReservedCardTask('/project', agent.id), runReservedCardTask('/project', agent.id)]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('keeps a newly saved file on the original node before starting a copy', async () => {
    vi.mocked(prepareAppTaskTransition).mockResolvedValue({ previous: { file: 'building-edited.glb' }, next: { ref: 'new-doc' } });
    await reserve('copy');
    await runReservedCardTask('/project', agent.id);
    expect(requests).toContainEqual({ url: '/api/app-bubbles/source/output', body: { file: 'building-edited.glb' } });
    expect(useGraphStore.getState().appBubbles.find((node) => node.id === source.id)?.file).toBe('building-edited.glb');
  });
  it('does not include partially prepared nodes in the old task after session creation fails', async () => {
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => new Response(JSON.stringify({ ok: true, data: {
      ...JSON.parse(String(init?.body)), createdAt: 2,
    } }))).mockImplementationOnce(async () => new Response('{}', { status: 500 }));
    await reserve();
    await runReservedCardTask('/project', agent.id);
    expect(book.activeTaskId).toBe('old');
    expect(book.pending?.status).toBe('failed');
    expect(useGraphStore.getState().appBubbles.filter((node) => node.id !== source.id)
      .every((node) => !node.linkedAgentIds?.includes(agent.id))).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
  it('clears a recovered reservation without restoring an already accepted request, even across clock skew', async () => {
    send.mockResolvedValue(null);
    await reserve();
    await runReservedCardTask('/project', agent.id);
    useGraphStore.setState({ completedCommands: { agent: [{ id: 'accepted', subAgentId: 'new-session',
      timestamp: 0, text: 'Create a tree\n\nLinked instructions', status: 'completed' }] } });
    await restoreCardTaskDraft('/project', agent.id);
    expect(book.pending).toBeUndefined();
    expect(useGraphStore.getState().agentSessionInputs['agent|new-session']?.text ?? '').toBe('');
  });
  it('does not automatically replay a preparing request after a reload', async () => {
    await reserve();
    book = { ...book, pending: { ...book.pending!, status: 'preparing', leaseUntil: Date.now() + 120_000 } };
    useCardTaskStore.getState().patch(key, { book });
    await runReservedCardTask('/project', agent.id);
    await restoreCardTaskDraft('/project', agent.id);
    expect(send).not.toHaveBeenCalled();
    expect(book.pending?.status).toBe('preparing');
  });
  it('fills an initially unknown session from the receipt without selecting over another task', async () => {
    book = { ...book, tasks: [{ ...book.tasks[0]!, sessionId: null }] };
    await recordCardTaskSend('/project', agent.id, 'old', 'old-session', 'Edit', [source.id]);
    expect(book.tasks[0]?.sessionId).toBe('old-session');
  });
});
