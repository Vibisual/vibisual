/** §5.13 (AA) 42-5·42-6 — 렌더 대기열 판정(일감 객체만 본다 — 예약·멈춤·순서·되살리기를 시계·파일 없이 시험으로 고정하려고). */

import type { RenderOutputSpec, RenderSpec } from '../renderSpec.js';

export type QueueStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled';

/** 사람이 일감 하나에 거는 조작. */
export type QueueAction = 'pause' | 'resume' | 'cancel' | 'start-now' | 'hold' | 'move-up' | 'move-down' | 'delivered';
export const QUEUE_ACTIONS: readonly QueueAction[] = ['pause', 'resume', 'cancel', 'start-now', 'hold', 'move-up', 'move-down', 'delivered'];

/** 줄 전체에 거는 조작. */
export type QueueBulkAction = 'start-all' | 'hold-all' | 'cancel-all' | 'clear-finished';
export const QUEUE_BULK_ACTIONS: readonly QueueBulkAction[] = ['start-all', 'hold-all', 'cancel-all', 'clear-finished'];

/** 멈춘 까닭 — 사람이 멈춤 · 꺼져 있는 동안 지난 예약 · 돌다 끊김(42-6). */
export type HeldReason = 'user' | 'missed' | 'interrupted';

/** 렌더 일감 중 대기열이 다루는 칸(서버 `VideoJob` 이 이 모양을 품는다). */
export interface QueueJob {
  id: string;
  kind: string;
  projectPath: string;
  docId: string;
  status: QueueStatus;
  progress: number;
  createdAt: number;
  updatedAt: number;
  order: number;
  held?: boolean;
  heldReason?: HeldReason;
  notBefore?: number;
  paused?: boolean;
  pausedAt?: number;
  pausedMs?: number;
  startedAt?: number;
  finishedAt?: number;
  spec?: RenderSpec;
  output?: RenderOutputSpec;
  title?: string;
  label?: string;
  result?: string;
  exported?: string;
  exportNote?: { code: 'export-failed' | 'overwrite-fallback'; detail?: string };
  error?: string;
  note?: string;
  delivered?: boolean;
  hideCaptions?: boolean;
  transparent?: boolean;
}

export function isTerminalStatus(status: QueueStatus): boolean {
  return status === 'done' || status === 'error' || status === 'canceled';
}

/** 지금 일꾼이 집을 수 있는가 — 줄에 서 있고, 멈추지 않았고, 예약 시각이 지났다. */
export function isDue(job: QueueJob, now: number): boolean {
  return job.status === 'queued' && job.held !== true && (job.notBefore === undefined || job.notBefore <= now);
}

/** 멈춘 시간을 쌓는다(멈춰 있었다면). */
function settlePause(job: QueueJob, now: number): void {
  if (job.pausedAt !== undefined) job.pausedMs = (job.pausedMs ?? 0) + Math.max(0, now - job.pausedAt);
  delete job.pausedAt;
  job.paused = false;
}

/** 지금 상태에서 뜻이 없는 조작은 `error`(화면은 그대로 둔다). 순서 바꾸기(`move-up`·`move-down`)는 이웃을 알아야 해서 `reorderJob` 이 맡는다. */
export function applyQueueAction(job: QueueJob, action: QueueAction, now: number): { changed: boolean; error?: string } {
  const terminal = isTerminalStatus(job.status);
  switch (action) {
    case 'pause':
      if (job.status === 'running') {
        if (job.paused === true) return { changed: false };
        job.paused = true;
        job.pausedAt = now;
        return { changed: true };
      }
      if (job.status === 'queued') {
        if (job.held === true) return { changed: false };
        job.held = true;
        job.heldReason = 'user';
        return { changed: true };
      }
      return { changed: false, error: 'not-active' };
    case 'hold':
      if (job.status !== 'queued') return { changed: false, error: 'not-queued' };
      if (job.held === true) return { changed: false };
      job.held = true;
      job.heldReason = 'user';
      return { changed: true };
    case 'resume':
      if (job.status === 'running') {
        if (job.paused !== true) return { changed: false };
        settlePause(job, now);
        return { changed: true };
      }
      if (job.status === 'queued') {
        if (job.held !== true) return { changed: false };
        delete job.held;
        delete job.heldReason;
        return { changed: true };
      }
      return { changed: false, error: 'not-active' };
    case 'start-now':
      if (job.status !== 'queued') return { changed: false, error: 'not-queued' };
      if (job.held !== true && job.notBefore === undefined) return { changed: false };
      delete job.held;
      delete job.heldReason;
      delete job.notBefore;
      return { changed: true };
    case 'cancel':
      if (terminal) return { changed: false };
      settlePause(job, now);
      job.status = 'canceled';
      job.finishedAt = now;
      delete job.held;
      delete job.heldReason;
      return { changed: true };
    case 'delivered':
      if (job.status !== 'done' || job.delivered === true) return { changed: false };
      job.delivered = true;
      return { changed: true };
    case 'move-up':
    case 'move-down':
      return { changed: false, error: 'use-reorder' };
    default:
      return { changed: false, error: 'unknown-action' };
  }
}

/** 아직 돌지 않은 렌더 일감(같은 프로젝트) — 순서대로. */
export function pendingInOrder(jobs: Iterable<QueueJob>, projectPath: string): QueueJob[] {
  return [...jobs].filter((j) => j.kind === 'render' && j.projectPath === projectPath && j.status === 'queued').sort((a, b) => a.order - b.order);
}

/** 위로·아래로 — 같은 프로젝트의 기다리는 렌더 사이에서 이웃과 자리를 바꾼다. */
export function reorderJob(jobs: Iterable<QueueJob>, job: QueueJob, direction: 'up' | 'down'): boolean {
  if (job.status !== 'queued') return false;
  const line = pendingInOrder(jobs, job.projectPath);
  const i = line.findIndex((j) => j.id === job.id);
  const other = line[direction === 'up' ? i - 1 : i + 1];
  if (i < 0 || !other) return false;
  const swap = other.order;
  other.order = job.order;
  job.order = swap;
  return true;
}

/** 가장 이른 예약 시각(지금 뒤의 것만 — 지난 것은 이미 집을 수 있다). 없으면 null. */
export function nextScheduledAt(jobs: Iterable<QueueJob>, now: number): number | null {
  let best: number | null = null;
  for (const j of jobs) {
    if (j.status !== 'queued' || j.held === true || j.notBefore === undefined || j.notBefore <= now) continue;
    if (best === null || j.notBefore < best) best = j.notBefore;
  }
  return best;
}

/** 지울 끝난 기록 — 프로젝트마다 최근 `max` 건만 남긴다(기록일 뿐 — 파일은 지우지 않는다 (K)). */
export function historyOverflow(jobs: Iterable<QueueJob>, projectPath: string, max: number): string[] {
  const finished = [...jobs]
    .filter((j) => j.kind === 'render' && j.projectPath === projectPath && isTerminalStatus(j.status))
    .sort((a, b) => (b.finishedAt ?? b.updatedAt) - (a.finishedAt ?? a.updatedAt));
  return finished.slice(Math.max(0, max)).map((j) => j.id);
}

/** 사람의 조작 이름인가. */
export function isQueueAction(value: unknown): value is QueueAction {
  return typeof value === 'string' && (QUEUE_ACTIONS as readonly string[]).includes(value);
}

export function isQueueBulkAction(value: unknown): value is QueueBulkAction {
  return typeof value === 'string' && (QUEUE_BULK_ACTIONS as readonly string[]).includes(value);
}
