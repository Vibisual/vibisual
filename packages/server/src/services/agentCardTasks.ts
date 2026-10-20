import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { AgentCardTask, AgentCardPendingTask, AgentCardTaskBook } from '@vibisual/shared';
import { atomicWriteFileSync } from './statePersistence.js';
import { isWithinRoot, samePath } from './pathKey.js';

export interface AgentCardTasksHost {
  rootForAgent(agentId: string): string | null;
  /** Known foreign sessions are refused; historical or not-yet-snapshotted sessions remain valid. */
  sessionOwner?(sessionId: string): string | undefined;
  writeFile?(file: string, data: string): void;
  warn?(message: string): void;
}

class TaskBookError extends Error {
  constructor(readonly status: number, message: string, readonly book?: AgentCardTaskBook) { super(message); }
}

const emptyBook = (): AgentCardTaskBook => ({ revision: 0, activeTaskId: null, tasks: [] });
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskBookError(400, 'invalid-task-book');
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TaskBookError(400, 'invalid-task-book');
  return value;
}
function nullableId(value: unknown): string | null { return value === null ? null : string(value); }
function time(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TaskBookError(400, 'invalid-task-book');
  return value;
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TaskBookError(400, 'invalid-revision');
  return value;
}
function nodeIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1000) throw new TaskBookError(400, 'invalid-task-book');
  const ids = value.map((id) => string(id));
  if (new Set(ids).size !== ids.length) throw new TaskBookError(400, 'duplicate-node-id');
  return ids;
}
function parseBook(value: unknown, nextRevision: number): AgentCardTaskBook {
  const input = object(value);
  if (!Array.isArray(input.tasks) || input.tasks.length > 1000) throw new TaskBookError(400, 'invalid-task-book');
  const tasks: AgentCardTask[] = input.tasks.map((raw) => {
    const task = object(raw);
    return { id: string(task.id), title: string(task.title, 500), sessionId: nullableId(task.sessionId), nodeIds: nodeIds(task.nodeIds), createdAt: time(task.createdAt) };
  });
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) throw new TaskBookError(400, 'duplicate-task-id');
  const activeTaskId = nullableId(input.activeTaskId);
  if (activeTaskId !== null && !ids.has(activeTaskId)) throw new TaskBookError(400, 'unknown-active-task');
  let pending: AgentCardPendingTask | undefined;
  if (input.pending !== undefined) {
    const p = object(input.pending);
    if (p.mode !== 'new' && p.mode !== 'copy') throw new TaskBookError(400, 'invalid-pending-mode');
    if (p.status !== 'waiting' && p.status !== 'preparing' && p.status !== 'failed') throw new TaskBookError(400, 'invalid-pending-status');
    const sourceTaskId = nullableId(p.sourceTaskId);
    if (sourceTaskId !== null && !ids.has(sourceTaskId)) throw new TaskBookError(400, 'unknown-source-task');
    const taskId = p.taskId === undefined ? undefined : string(p.taskId);
    if (taskId && !ids.has(taskId)) throw new TaskBookError(400, 'unknown-prepared-task');
    if (p.leaseUntil !== undefined && (typeof p.leaseUntil !== 'number' || !Number.isSafeInteger(p.leaseUntil) || p.leaseUntil < 0)) {
      throw new TaskBookError(400, 'invalid-task-lease');
    }
    pending = {
      id: string(p.id), mode: p.mode, text: string(p.text, 500_000), sourceTaskId,
      nodeIds: nodeIds(p.nodeIds), createdAt: time(p.createdAt), status: p.status,
      ...(p.error === undefined ? {} : { error: string(p.error, 4000) }),
      ...(taskId ? { taskId } : {}),
      ...(p.leaseUntil === undefined ? {} : { leaseUntil: p.leaseUntil as number }),
    };
  }
  return { revision: nextRevision, activeTaskId, tasks, ...(pending ? { pending } : {}) };
}

/** Reads and compare-and-swap writes stay synchronous: two renderer requests cannot both claim a pending task. */
export class AgentCardTasksStore {
  constructor(private readonly host: AgentCardTasksHost) {}

  private file(agentId: string, projectId: unknown): string {
    const root = this.host.rootForAgent(agentId);
    if (!root || typeof projectId !== 'string' || !path.isAbsolute(projectId)
      || !samePath(path.resolve(root), path.resolve(projectId))) throw new TaskBookError(404, 'agent-project-not-found');
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new TaskBookError(404, 'agent-project-not-found');
    const resolvedRoot = fs.realpathSync(root);
    const name = createHash('sha256').update(agentId).digest('hex');
    const file = path.join(root, '.vibisual', 'agent-card-tasks', `${name}.json`);
    // A linked storage directory must not redirect another project's book outside the authorized root.
    for (const candidate of [path.join(root, '.vibisual'), path.dirname(file), file]) {
      if (fs.existsSync(candidate) && !isWithinRoot(fs.realpathSync(candidate), resolvedRoot)) {
        throw new TaskBookError(403, 'task-book-outside-project');
      }
    }
    return file;
  }

  private read(file: string, agentId: string): AgentCardTaskBook {
    let raw: string;
    try { raw = fs.readFileSync(file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyBook();
      throw error;
    }
    try {
      const stored = object(JSON.parse(raw));
      if (stored.agentId !== agentId || stored.version !== 1) throw new Error('owner or version mismatch');
      const book = object(stored.book);
      return parseBook(book, revision(book.revision));
    } catch { throw new TaskBookError(500, 'task-book-unreadable'); }
  }

  get(agentId: string, projectId: unknown): AgentCardTaskBook {
    return this.read(this.file(agentId, projectId), agentId);
  }

  put(agentId: string, projectId: unknown, value: unknown): AgentCardTaskBook {
    const file = this.file(agentId, projectId);
    const input = object(value);
    const expected = revision(input.expectedRevision);
    const current = this.read(file, agentId);
    if (current.revision !== expected) throw new TaskBookError(409, 'revision-conflict', current);
    if (expected === Number.MAX_SAFE_INTEGER) throw new TaskBookError(409, 'revision-exhausted', current);
    const next = parseBook(input.book, expected + 1);
    for (const task of next.tasks) {
      const owner = task.sessionId ? this.host.sessionOwner?.(task.sessionId) : undefined;
      if (owner && owner !== agentId) throw new TaskBookError(404, 'session-not-found-for-agent');
    }
    // Failed persistence leaves the previous book and revision intact. Never acknowledge before the rename.
    (this.host.writeFile ?? atomicWriteFileSync)(file, JSON.stringify({ version: 1, agentId, book: next }));
    return next;
  }
}

export function mountAgentCardTaskRoutes(app: Express, host: AgentCardTasksHost, store = new AgentCardTasksStore(host)): void {
  const endpoint = (write: boolean) => (req: Request, res: Response): void => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const agentId = String(req.params['agentId']);
      const book = write ? store.put(agentId, req.query['projectId'], req.body) : store.get(agentId, req.query['projectId']);
      res.json({ ok: true, book });
    } catch (error) {
      if (error instanceof TaskBookError) {
        res.status(error.status).json({ ok: false, error: error.message, ...(error.book ? { book: error.book } : {}) });
      } else {
        host.warn?.(`[agent-card-tasks] ${req.method} failed: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({ ok: false, error: 'task-book-save-failed' });
      }
    }
  };
  app.get('/api/agent-card-tasks/:agentId', endpoint(false));
  app.put('/api/agent-card-tasks/:agentId', endpoint(true));
}
