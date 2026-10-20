/**
 * §5.13 (AA) 42-6 — 렌더 대기열의 **파일 기록** ↔ 일감(껐다 켠 뒤 되살리기). 판정 규칙은 `renderQueue.ts`, 파일 읽고 쓰기는 `exportStore.ts`.
 */

import { normalizeRenderOutput, normalizeRenderSpec } from '../renderSpec.js';
import { isTerminalStatus, type QueueJob, type QueueStatus } from './renderQueue.js';

/** 파일에 적는 한 줄(진행 중의 순간값은 빼고, 끝난 것은 진행률까지). */
export type QueueRecord = Omit<QueueJob, 'kind' | 'projectPath' | 'paused' | 'pausedAt'>;

export function toQueueRecord(job: QueueJob): QueueRecord {
  const { kind: _kind, projectPath: _project, paused: _paused, pausedAt: _pausedAt, ...rest } = job;
  void _kind; void _project; void _paused; void _pausedAt;
  return { ...rest, progress: isTerminalStatus(job.status) ? job.progress : 0 };
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown, max = 4096): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;
}

/**
 * 파일 한 줄 → 일감(껐다 켠 뒤). 돌던 것·줄에 서 있던 것은 **멈춘 채로**(`interrupted`), 꺼져 있는 동안 예약 시각이 지난 것은
 * `missed` 로 멈춘다 — 켜자마자 무거운 렌더가 저절로 돌지 않게(42-6). 앞으로의 예약은 그대로 기다린다.
 */
export function fromQueueRecord(raw: unknown, projectPath: string, now: number): QueueJob | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = r['id'];
  const docId = r['docId'];
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id) || typeof docId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(docId)) return null;
  const status = r['status'];
  const known: readonly QueueStatus[] = ['queued', 'running', 'done', 'error', 'canceled'];
  if (typeof status !== 'string' || !(known as readonly string[]).includes(status)) return null;
  const createdAt = num(r['createdAt']) ?? now;
  const job: QueueJob = {
    id,
    kind: 'render',
    projectPath,
    docId,
    status: status as QueueStatus,
    progress: Math.max(0, Math.min(1, num(r['progress']) ?? 0)),
    createdAt,
    updatedAt: num(r['updatedAt']) ?? createdAt,
    order: num(r['order']) ?? createdAt,
  };
  if (r['spec'] !== undefined) job.spec = normalizeRenderSpec(r['spec']);
  if (r['output'] !== undefined) job.output = normalizeRenderOutput(r['output']);
  const title = str(r['title'], 200); if (title) job.title = title;
  const label = str(r['label'], 200); if (label) job.label = label;
  const result = str(r['result']); if (result) job.result = result;
  const exported = str(r['exported']); if (exported) job.exported = exported;
  const error = str(r['error'], 2000); if (error) job.error = error;
  const note = str(r['note'], 2000); if (note) job.note = note;
  const startedAt = num(r['startedAt']); if (startedAt !== undefined) job.startedAt = startedAt;
  const finishedAt = num(r['finishedAt']); if (finishedAt !== undefined) job.finishedAt = finishedAt;
  const pausedMs = num(r['pausedMs']); if (pausedMs !== undefined) job.pausedMs = pausedMs;
  if (r['delivered'] === true) job.delivered = true;
  if (r['hideCaptions'] === true) job.hideCaptions = true;
  if (r['transparent'] === true) job.transparent = true;
  const exportNote = r['exportNote'];
  if (exportNote && typeof exportNote === 'object') {
    const code = (exportNote as Record<string, unknown>)['code'];
    if (code === 'export-failed' || code === 'overwrite-fallback') {
      const detail = str((exportNote as Record<string, unknown>)['detail'], 500);
      job.exportNote = detail ? { code, detail } : { code };
    }
  }
  if (isTerminalStatus(job.status)) return job;
  // 아직 안 끝난 것 — 돌던 것은 처음부터 다시 줄에 선다(반쯤 그린 파일은 이어 그릴 수 없다).
  const wasRunning = job.status === 'running';
  job.status = 'queued';
  job.progress = 0;
  delete job.startedAt;
  delete job.pausedMs;
  const notBefore = num(r['notBefore']);
  const held = r['held'] === true;
  const reason = r['heldReason'];
  if (held) {
    job.held = true;
    job.heldReason = reason === 'missed' || reason === 'interrupted' ? reason : 'user';
  } else if (notBefore !== undefined && notBefore > now && !wasRunning) {
    job.notBefore = notBefore;
  } else {
    job.held = true;
    job.heldReason = notBefore !== undefined && !wasRunning ? 'missed' : 'interrupted';
  }
  if (job.held && notBefore !== undefined) job.notBefore = notBefore;
  return job;
}
