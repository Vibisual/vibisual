import { hasSessionWork, makeAppBubbleId, type AgentCardTaskBook, type AgentCardPendingTask, type AppBubble, type SubAgent } from '@vibisual/shared';
import { prepareAppTaskTransition } from '../../apps/appTaskTransition.js';
import { appCommandOptions } from '../../apps/appExecutionRequirements.js';
import { appOutputExtensions, getInternalApp } from '../../apps/registry.js';
import { agentSessionInputKey, useGraphStore } from '../../stores/graphStore.js';
import { buildSessionRunInputs } from '../../utils/sessionStatus.js';
import { clientPathKey } from '../../utils/platform.js';
import { agentIDEPaneKey } from '../../stores/detachedIDEFocus.js';
import { appNodeLabel, withLinkedOutputBrief, type LinkedOutputNode } from './agentCard.js';
import { composeLinkedBriefs } from './linkedNodeBriefs.js';
import { CARD_TASK_DRAFT, cardTaskKey, loadCardTasks, saveCardTasks, useCardTaskStore } from './agentCardTaskState.js';

export function cardAgentHasWork(agentId: string): boolean {
  const state = useGraphStore.getState();
  const subs = state.subAgents[agentId] ?? [];
  const commands = state.queuedCommands[agentId];
  if (subs.some((sub) => hasSessionWork(buildSessionRunInputs({ sub, commands,
    runningTasks: state.runningSubagentTasks[agentId], acknowledged: false })))) return true;
  const known = new Set(subs.map((sub) => sub.id));
  return hasSessionWork(buildSessionRunInputs({ sub: null,
    commands: commands?.filter((command) => !command.subAgentId || !known.has(command.subAgentId)),
    runningTasks: state.runningSubagentTasks[agentId], acknowledged: false,
    ...(subs.length === 0 ? { agentStatus: state.agents.find((agent) => agent.id === agentId)?.status } : {}),
  }));
}

export function outputForTask(bubble: AppBubble): LinkedOutputNode {
  const app = getInternalApp(bubble.appId);
  return { id: bubble.id, appName: app?.name ?? bubble.appId,
    label: appNodeLabel(bubble, app?.name ?? bubble.appId), accepts: app ? appOutputExtensions(app) : [], file: bubble.file };
}

async function jsonPost<T>(url: string, body: object, method = 'POST'): Promise<T> {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json() as T;
  if (!response.ok) throw new Error('task-prepare-failed');
  return data;
}

export async function createCardTaskSession(agentId: string): Promise<string> {
  const data = await jsonPost<{ ok?: boolean; subAgent?: SubAgent }>(`/api/subagents/${encodeURIComponent(agentId)}`, {});
  if (!data.ok || !data.subAgent?.id || data.subAgent.parentAgentId !== agentId) throw new Error('session-create-failed');
  const sub = data.subAgent;
  useGraphStore.setState((state) => ({ subAgents: { ...state.subAgents,
    [agentId]: [...(state.subAgents[agentId] ?? []).filter((current) => current.id !== sub.id), sub] } }));
  return sub.id;
}

export async function reserveCardTask(args: {
  projectId: string; agentId: string; mode: 'new' | 'copy'; text: string;
  sessionId: string | null; currentNodes: readonly AppBubble[]; targetNodeIds: string[]; title: string;
}): Promise<void> {
  const { projectId, agentId } = args;
  let book = await loadCardTasks(projectId, agentId);
  if (book.pending) throw new Error('task-already-pending');
  let active = book.tasks.find((task) => task.id === book.activeTaskId);
  if (!active && (args.sessionId || args.currentNodes.length)) {
    active = { id: crypto.randomUUID(), title: args.title, sessionId: args.sessionId,
      nodeIds: args.currentNodes.map((node) => node.id), createdAt: Date.now() };
    book = { ...book, activeTaskId: active.id, tasks: [...book.tasks, active] };
  } else if (active) {
    book = { ...book, tasks: book.tasks.map((task) => task.id === active!.id
      ? { ...task, nodeIds: [...new Set([...task.nodeIds, ...args.currentNodes.map((node) => node.id)])] } : task) };
  }
  await saveCardTasks(projectId, agentId, { ...book, pending: {
    id: crypto.randomUUID(), mode: args.mode, text: args.text, sourceTaskId: active?.id ?? null,
    nodeIds: args.targetNodeIds, createdAt: Date.now(), status: 'waiting',
  } });
  const currentDraft = useGraphStore.getState().agentSessionInputs[agentSessionInputKey(agentId, CARD_TASK_DRAFT)]?.text ?? '';
  if (currentDraft.trim() === args.text.trim()) useGraphStore.getState().setAgentSessionInputText(agentId, CARD_TASK_DRAFT, '');
}

const runners = new Set<string>();

/** Reservation is durable; the renderer only claims it after all earlier work has settled. */
export async function runReservedCardTask(projectId: string, agentId: string): Promise<void> {
  const key = cardTaskKey(projectId, agentId);
  if (runners.has(key) || cardAgentHasWork(agentId)) return;
  const initial = useCardTaskStore.getState().entries[key]?.book;
  if (initial?.pending?.status !== 'waiting') return;
  runners.add(key);
  let book: AgentCardTaskBook | undefined;
  const pendingId = initial.pending.id;
  try {
    book = await saveCardTasks(projectId, agentId, { ...initial, pending: { ...initial.pending, status: 'preparing', leaseUntil: Date.now() + 120_000 } });
    const pending = book.pending!;
    const state = useGraphStore.getState();
    const project = Object.values(state.projects).find((item) => item.path.replace(/\\/g, '/') === projectId.replace(/\\/g, '/'));
    if (!project) throw new Error('project-unavailable');
    const title = pending.text.trim().split('\n')[0]!.slice(0, 72);
    const sources = pending.nodeIds.map((id) => state.appBubbles.find((bubble) => bubble.id === id));
    if (sources.some((source) => !source || source.projectName !== project.name)) throw new Error('task-source-missing');
    // Save all live sources before creating any new destination. A failure never clears the old scene.
    const prepared: Array<{ source: AppBubble; target: { ref?: string; file?: string } }> = [];
    for (const source of sources as AppBubble[]) {
      const transition = await prepareAppTaskTransition({ projectId, projectName: project.name,
        appId: source.appId, bubble: source, mode: pending.mode, title,
        requestId: `${pending.id}-${source.id}` });
      if (transition.previous.ref && transition.previous.ref !== source.ref) {
        const saved = await jsonPost<{ data?: AppBubble }>(`/api/app-bubbles/${encodeURIComponent(source.id)}`,
          { ref: transition.previous.ref }, 'PATCH');
        if (!saved.data) throw new Error('source-save-failed');
        useGraphStore.getState().patchAppBubbleLocal(source.id, saved.data);
      }
      if (transition.previous.file && transition.previous.file !== source.file) {
        const saved = await jsonPost<{ ok?: boolean; data?: Partial<AppBubble> }>(`/api/app-bubbles/${encodeURIComponent(source.id)}/output`,
          { file: transition.previous.file });
        if (!saved.ok || saved.data?.file !== transition.previous.file) throw new Error('source-save-failed');
        useGraphStore.getState().patchAppBubbleLocal(source.id, saved.data);
      }
      prepared.push({ source, target: transition.next });
      book = await saveCardTasks(projectId, agentId, { ...book, pending: { ...book.pending!, leaseUntil: Date.now() + 120_000 } });
    }
    // A newer reservation/selection must not be overwritten after a slow save.
    const latest = await loadCardTasks(projectId, agentId);
    if (latest.revision !== book.revision || latest.pending?.id !== pendingId) throw new Error('revision-conflict');
    if (cardAgentHasWork(agentId)) {
      await saveCardTasks(projectId, agentId, { ...book, pending: { ...pending, status: 'waiting' } });
      return;
    }
    const nodeIds: string[] = [];
    for (const { source, target } of prepared) {
      const input = { id: makeAppBubbleId(), projectName: source.projectName, appId: source.appId,
        x: source.x, y: source.y, width: source.width, height: source.height, title,
        ...(target.ref ? { ref: target.ref } : {}), linkedAgentIds: [] };
      const result = await jsonPost<{ ok?: boolean; data?: AppBubble }>('/api/app-bubbles', input);
      if (!result.ok || !result.data?.id) throw new Error('task-node-create-failed');
      const bubble = result.data;
      // File-backed apps use the validated output route; the create route deliberately ignores file.
      if (target.file) await jsonPost(`/api/app-bubbles/${encodeURIComponent(bubble.id)}/output`, { file: target.file });
      useGraphStore.setState((current) => ({ appBubbles: [...current.appBubbles.filter((item) => item.id !== bubble.id),
        { ...bubble, ...(target.file ? { file: target.file } : {}) }] }));
      nodeIds.push(bubble.id);
    }
    const sessionId = await createCardTaskSession(agentId);
    const task = { id: pending.id, title, sessionId, nodeIds, createdAt: Date.now() };
    book = await saveCardTasks(projectId, agentId, { ...book, activeTaskId: task.id,
      tasks: [...book.tasks, task], pending: { ...pending, taskId: task.id, leaseUntil: Date.now() + 120_000 } });
    for (const id of nodeIds) {
      const linked = await jsonPost<{ data?: AppBubble }>(`/api/app-bubbles/${encodeURIComponent(id)}`, { linkedAgentIds: [agentId] }, 'PATCH');
      if (!linked.data) throw new Error('task-node-link-failed');
      useGraphStore.getState().patchAppBubbleLocal(id, linked.data);
    }
    useGraphStore.getState().selectSubForAgent(agentId, sessionId);
    const followingDraft = useGraphStore.getState().agentSessionInputs[agentSessionInputKey(agentId, CARD_TASK_DRAFT)]?.text;
    if (followingDraft) {
      useGraphStore.getState().setAgentSessionInputText(agentId, sessionId, followingDraft);
      useGraphStore.getState().setAgentSessionInputText(agentId, CARD_TASK_DRAFT, '');
    }
    useCardTaskStore.getState().patch(key, { mode: undefined });
    const nodes = nodeIds.map((id) => useGraphStore.getState().appBubbles.find((node) => node.id === id)!);
    const briefs = await composeLinkedBriefs(nodes.map(outputForTask), pending.text);
    const beforeSend = await loadCardTasks(projectId, agentId);
    if (beforeSend.revision !== book.revision || beforeSend.pending?.id !== pendingId) throw new Error('revision-conflict');
    const receipt = await useGraphStore.getState().addCommand(agentId, withLinkedOutputBrief(pending.text, briefs), sessionId,
      undefined, { ...appCommandOptions(briefs), draftText: pending.text, draftSessionId: sessionId, afterAgentWork: true });
    if (!receipt || receipt.subAgentId !== sessionId) throw new Error('task-send-unconfirmed');
    const { pending: _done, ...done } = book;
    await saveCardTasks(projectId, agentId, done);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'task-prepare-failed';
    // A failed CAS belongs to the other window. Never overwrite its state or dispatch twice.
    if (code !== 'revision-conflict' && book?.pending?.id === pendingId) {
      try { await saveCardTasks(projectId, agentId, { ...book, pending: { ...book.pending, status: 'failed', error: code } }); }
      catch { /* The server still retains the preparing request for explicit recovery. */ }
    }
    useCardTaskStore.getState().patch(key, { error: code });
  } finally { runners.delete(key); }
}

/** The server queue and completed snapshot can prove acceptance; an absent command never proves rejection. */
async function acceptedPendingCommand(agentId: string, sessionId: string, pending: AgentCardPendingTask): Promise<boolean> {
  const matches = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    const command = value as { subAgentId?: unknown; timestamp?: unknown; text?: unknown };
    const request = pending.text.trim();
    return command.subAgentId === sessionId
      && typeof command.text === 'string' && (command.text.trim() === request || command.text.trimStart().startsWith(`${request}\n\n`));
  };
  const parentSession = useGraphStore.getState().agents.find((agent) => agent.id === agentId)?.path;
  if (parentSession) {
    try {
      const response = await fetch(`/api/commands/${encodeURIComponent(parentSession)}`);
      const body = await response.json() as { commands?: unknown[] };
      if (response.ok && Array.isArray(body.commands) && body.commands.some(matches)) return true;
    } catch { /* The latest retained snapshot is still positive acceptance evidence. */ }
  }
  const state = useGraphStore.getState();
  return (state.queuedCommands[agentId] ?? []).some(matches) || (state.completedCommands[agentId] ?? []).some(matches);
}

/** Restore the selected conversation only in this agent's project pane, never whichever pane is in front. */
function selectTaskConversation(projectId: string, agentId: string, taskId: string, sessionId: string | null): void {
  if (!sessionId || useCardTaskStore.getState().entries[cardTaskKey(projectId, agentId)]?.book?.activeTaskId !== taskId) return;
  const state = useGraphStore.getState();
  state.selectSubForAgent(agentId, sessionId);
  const project = Object.values(state.projects).find((entry) => clientPathKey(entry.path) === clientPathKey(projectId));
  const pane = project ? agentIDEPaneKey(Object.values(state.ideOverlays), project.name, agentId) : null;
  if (pane) state.setIDEActiveSession(sessionId, pane);
}

export async function restoreCardTaskDraft(projectId: string, agentId: string): Promise<void> {
  const book = await loadCardTasks(projectId, agentId);
  const pending = book.pending;
  if (!pending || runners.has(cardTaskKey(projectId, agentId))) return;
  if (pending.status === 'preparing' && (pending.leaseUntil ?? 0) > Date.now()) return;
  const task = book.tasks.find((entry) => entry.id === pending.taskId);
  const draftSession = task?.sessionId ?? CARD_TASK_DRAFT;
  const accepted = task?.sessionId ? await acceptedPendingCommand(agentId, task.sessionId, pending) : false;
  const { pending: _restored, ...rest } = book;
  await saveCardTasks(projectId, agentId, { ...rest, ...(task ? { activeTaskId: task.id } : {}) });
  // A losing restore must not leave a duplicate request in a draft while another window dispatches it.
  const state = useGraphStore.getState();
  const current = state.agentSessionInputs[agentSessionInputKey(agentId, draftSession)]?.text ?? '';
  if (!accepted) state.setAgentSessionInputText(agentId, draftSession,
    !current || current === pending.text ? pending.text : `${pending.text}\n\n${current}`);
  else if (current === pending.text) state.setAgentSessionInputText(agentId, draftSession, '');
  if (task) selectTaskConversation(projectId, agentId, task.id, task.sessionId);
  useCardTaskStore.getState().patch(cardTaskKey(projectId, agentId), { mode: task ? undefined : pending.mode, error: undefined });
}

export async function selectCardTask(projectId: string, agentId: string, taskId: string): Promise<void> {
  const book = await loadCardTasks(projectId, agentId);
  if (book.pending?.status === 'preparing') throw new Error('task-preparing');
  const task = book.tasks.find((entry) => entry.id === taskId);
  if (!task) throw new Error('task-missing');
  await saveCardTasks(projectId, agentId, { ...book, activeTaskId: task.id });
  selectTaskConversation(projectId, agentId, task.id, task.sessionId);
  useCardTaskStore.getState().patch(cardTaskKey(projectId, agentId), { mode: undefined, error: undefined });
}

export async function recordCardTaskSend(projectId: string, agentId: string, taskId: string | undefined,
  sessionId: string, text: string, nodeIds: string[]): Promise<void> {
  const book = await loadCardTasks(projectId, agentId);
  const existing = taskId ? book.tasks.find((task) => task.id === taskId)
    : book.tasks.find((task) => task.sessionId === sessionId);
  const task = existing ? { ...existing, sessionId: existing.sessionId ?? sessionId, nodeIds: [...new Set([...existing.nodeIds, ...nodeIds])] }
    : { id: crypto.randomUUID(), title: text.trim().split('\n')[0]!.slice(0, 72), sessionId, nodeIds, createdAt: Date.now() };
  await saveCardTasks(projectId, agentId, { ...book,
    // A late reply can record its work, but must never pull the user out of another task.
    activeTaskId: book.activeTaskId ?? task.id,
    tasks: existing ? book.tasks.map((item) => item.id === existing.id ? task : item) : [...book.tasks, task] });
}
