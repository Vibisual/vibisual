import { describe, expect, it } from 'vitest';

import { applyQueueAction, historyOverflow, isDue, nextScheduledAt, reorderJob, type QueueJob } from './renderQueue.js';
import { fromQueueRecord, toQueueRecord } from './queueRecord.js';

/** §5.13 (AA) 42-5·42-6 — 렌더 대기열 판정(시계·파일 없이). */

function job(id: string, extra: Partial<QueueJob> = {}): QueueJob {
  return { id, kind: 'render', projectPath: '/p', docId: 'doc', status: 'queued', progress: 0, createdAt: 1, updatedAt: 1, order: 1, ...extra };
}

describe('isDue — 집을 수 있는가', () => {
  it('줄에 섰고 · 멈추지 않았고 · 예약 시각이 지났을 때만', () => {
    expect(isDue(job('a'), 10)).toBe(true);
    expect(isDue(job('a', { held: true }), 10)).toBe(false);
    expect(isDue(job('a', { notBefore: 20 }), 10)).toBe(false);
    expect(isDue(job('a', { notBefore: 10 }), 10)).toBe(true);
    expect(isDue(job('a', { status: 'running' }), 10)).toBe(false);
  });
});

describe('applyQueueAction — 사람의 조작', () => {
  it('도는 렌더의 일시정지·재개는 멈춘 시간을 쌓는다', () => {
    const j = job('a', { status: 'running' });
    expect(applyQueueAction(j, 'pause', 100).changed).toBe(true);
    expect(j).toMatchObject({ paused: true, pausedAt: 100 });
    expect(applyQueueAction(j, 'pause', 150).changed).toBe(false);
    expect(applyQueueAction(j, 'resume', 400).changed).toBe(true);
    expect(j.paused).toBe(false);
    expect(j.pausedMs).toBe(300);
    expect(j.pausedAt).toBeUndefined();
  });

  it('기다리는 일감의 일시정지 = 멈춤, 재개 = 다시 줄에', () => {
    const j = job('a');
    applyQueueAction(j, 'pause', 1);
    expect(j).toMatchObject({ held: true, heldReason: 'user' });
    applyQueueAction(j, 'resume', 2);
    expect(j.held).toBeUndefined();
  });

  it('지금 시작은 예약·멈춤을 함께 걷는다', () => {
    const j = job('a', { held: true, heldReason: 'missed', notBefore: 999 });
    expect(applyQueueAction(j, 'start-now', 5).changed).toBe(true);
    expect(isDue(j, 5)).toBe(true);
  });

  it('취소는 끝난 것을 다시 바꾸지 않고, 멈춘 시간도 정리한다', () => {
    const running = job('a', { status: 'running', paused: true, pausedAt: 10 });
    expect(applyQueueAction(running, 'cancel', 30).changed).toBe(true);
    expect(running).toMatchObject({ status: 'canceled', finishedAt: 30, pausedMs: 20, paused: false });
    expect(applyQueueAction(running, 'cancel', 40).changed).toBe(false);
    const done = job('b', { status: 'done' });
    expect(applyQueueAction(done, 'pause', 1).error).toBe('not-active');
    expect(applyQueueAction(done, 'delivered', 1).changed).toBe(true);
    expect(applyQueueAction(done, 'delivered', 1).changed).toBe(false);
  });
});

describe('순서·예약·기록 상한', () => {
  it('위로·아래로는 같은 프로젝트의 기다리는 렌더끼리', () => {
    const a = job('a', { order: 1 });
    const b = job('b', { order: 2 });
    const other = job('o', { order: 0, projectPath: '/q' });
    const all = [a, b, other];
    expect(reorderJob(all, b, 'up')).toBe(true);
    expect([a.order, b.order]).toEqual([2, 1]);
    expect(reorderJob(all, b, 'up')).toBe(false);
    expect(other.order).toBe(0);
  });

  it('가장 이른 앞으로의 예약만', () => {
    expect(nextScheduledAt([job('a', { notBefore: 50 }), job('b', { notBefore: 30 }), job('c', { notBefore: 5 }), job('d', { notBefore: 20, held: true })], 10)).toBe(30);
    expect(nextScheduledAt([job('a')], 10)).toBeNull();
  });

  it('끝난 기록은 최근 것부터 상한까지(기다리는 것은 세지 않는다)', () => {
    const jobs = [
      job('old', { status: 'done', finishedAt: 1 }),
      job('mid', { status: 'error', finishedAt: 2 }),
      job('new', { status: 'canceled', finishedAt: 3 }),
      job('wait'),
    ];
    expect(historyOverflow(jobs, '/p', 2)).toEqual(['old']);
  });
});

describe('되살리기 — 42-6', () => {
  const now = 1_000;
  const restore = (extra: Partial<QueueJob>, raw: Record<string, unknown> = {}): QueueJob | null =>
    fromQueueRecord({ ...toQueueRecord(job('job-1', extra)), ...raw }, '/p', now);

  it('돌던 것은 멈춘 채 다시 줄에(끊김)', () => {
    const r = restore({ status: 'running', progress: 0.4, startedAt: 500 });
    expect(r).toMatchObject({ status: 'queued', progress: 0, held: true, heldReason: 'interrupted' });
    expect(r?.startedAt).toBeUndefined();
  });

  it('줄에 서 있던 것도 멈춘 채로 — 켜자마자 저절로 돌지 않게', () => {
    expect(restore({})).toMatchObject({ held: true, heldReason: 'interrupted' });
  });

  it('꺼져 있는 동안 지난 예약은 놓친 예약, 앞으로의 예약은 그대로', () => {
    expect(restore({ notBefore: 900 })).toMatchObject({ held: true, heldReason: 'missed' });
    const future = restore({ notBefore: 5_000 });
    expect(future?.held).toBeUndefined();
    expect(future?.notBefore).toBe(5_000);
  });

  it('사람이 멈춘 것은 그 까닭 그대로, 끝난 것은 그대로', () => {
    expect(restore({ held: true, heldReason: 'user' })).toMatchObject({ held: true, heldReason: 'user' });
    expect(restore({ status: 'done', progress: 1, result: '/p/out.mp4', delivered: true })).toMatchObject({ status: 'done', progress: 1, result: '/p/out.mp4', delivered: true });
  });

  it('모양이 틀린 줄은 버린다', () => {
    expect(fromQueueRecord({ id: '../x', docId: 'd', status: 'queued' }, '/p', now)).toBeNull();
    expect(fromQueueRecord({ id: 'a', docId: 'd', status: 'weird' }, '/p', now)).toBeNull();
    expect(fromQueueRecord(null, '/p', now)).toBeNull();
  });

  it('파일 기록에는 진행 중의 순간값을 적지 않는다', () => {
    const rec = toQueueRecord(job('a', { status: 'running', progress: 0.7, paused: true, pausedAt: 3 }));
    expect(rec.progress).toBe(0);
    expect('paused' in rec).toBe(false);
    expect('projectPath' in rec).toBe(false);
  });
});
