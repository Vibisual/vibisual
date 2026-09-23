import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENT_IDLE_THRESHOLD_MS, type ProjectInfo, type SubAgent, type SubAgentStreamEvent } from '@vibisual/shared';
import { SubAgentManager } from './subAgentManager.js';
import * as streamBufferStore from './streamBufferStore.js';

let manager: SubAgentManager;
let project: ProjectInfo;
let root: string;
let sub: SubAgent;

function buffers(): Map<string, SubAgentStreamEvent[]> {
  return (manager as unknown as { streamBuffers: Map<string, SubAgentStreamEvent[]> }).streamBuffers;
}

function age(): void {
  vi.setSystemTime(Date.now() + AGENT_IDLE_THRESHOLD_MS + 1);
}

beforeEach(() => {
  vi.useFakeTimers();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-idle-buffer-'));
  project = { name: 'idle-buffer', path: root };
  manager = new SubAgentManager();
  manager.setProjectResolver(() => project);
  sub = manager.create('agent-idle-buffer');
  sub.sessionId = 'saved-provider-session';
  manager.emitSystemMessage(sub.parentAgentId, sub.id, '대화 기록');
});

afterEach(() => {
  vi.restoreAllMocks();
  streamBufferStore.flushAll();
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('idle stream memory reclamation', () => {
  it.each(['idle', 'error'] as const)('releases already %s buffers without changing session state or disk history', (status) => {
    sub.status = status;
    const original = manager.getStreamBuffer(sub.id);
    age();
    // Exercise the existing periodic sweep, not just its new helper.
    expect(manager.sweepIdle(AGENT_IDLE_THRESHOLD_MS)).toEqual([]);
    expect(buffers().has(sub.id)).toBe(false);
    expect(sub.status).toBe(status);
    expect(sub.sessionId).toBe('saved-provider-session');
    expect(manager.getStreamBuffer(sub.id)).toEqual(original);
    manager.emitSystemMessage(sub.parentAgentId, sub.id, '이어서 대화');
    expect(manager.getStreamBuffer(sub.id).map((event) => event.content)).toEqual(['대화 기록', '이어서 대화']);
  });

  it('keeps recently read conversations until another idle interval passes', () => {
    age();
    manager.getStreamBuffer(sub.id);
    expect(manager.sweepIdleStreamBuffers(AGENT_IDLE_THRESHOLD_MS)).toEqual([]);
    age();
    expect(manager.sweepIdleStreamBuffers(AGENT_IDLE_THRESHOLD_MS)).toEqual([sub.id]);
  });

  it('also counts bulk history reads as cache use', () => {
    age();
    manager.getStreamBuffersForAgent(sub.parentAgentId);
    expect(manager.sweepIdleStreamBuffers(AGENT_IDLE_THRESHOLD_MS)).toEqual([]);
    age();
    expect(manager.sweepIdleStreamBuffers(AGENT_IDLE_THRESHOLD_MS)).toEqual([sub.id]);
  });

  it('never evicts active work just because output has been quiet', () => {
    sub.status = 'active';
    age();
    expect(manager.sweepIdleStreamBuffers(AGENT_IDLE_THRESHOLD_MS)).toEqual([]);
    expect(buffers().has(sub.id)).toBe(true);
  });

  it('protects background work until its owner ledger is cleared', () => {
    manager.noteSubagentTaskStart(sub.parentAgentId, 'task-background', undefined, { background: true });
    age();
    expect(manager.sweepIdleStreamBuffers(AGENT_IDLE_THRESHOLD_MS)).toEqual([]);
    manager.clearPendingSubagentTasks(sub.parentAgentId);
    age();
    expect(manager.sweepIdleStreamBuffers(AGENT_IDLE_THRESHOLD_MS)).toEqual([sub.id]);
  });

  it('retains memory-only lines when persistence fails even if an older file exists', () => {
    streamBufferStore.flushAll();
    const append = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => { throw new Error('disk unavailable'); });
    manager.emitSystemMessage(sub.parentAgentId, sub.id, '아직 저장되지 않은 대화');
    streamBufferStore.flushAll();
    age();
    expect(manager.sweepIdleStreamBuffers(AGENT_IDLE_THRESHOLD_MS)).toEqual([]);
    expect(manager.getStreamBuffer(sub.id)).toHaveLength(2);
    // Failed appends now stay pending. Once storage recovers, the next sweep can
    // persist the missing line and safely reclaim the cache without losing history.
    append.mockRestore();
    age();
    expect(manager.sweepIdleStreamBuffers(AGENT_IDLE_THRESHOLD_MS)).toEqual([sub.id]);
    expect(manager.getStreamBuffer(sub.id).map((event) => event.content)).toEqual(['대화 기록', '아직 저장되지 않은 대화']);
  });

  it('retains partial history whose project cannot be resolved', () => {
    const detached = new SubAgentManager();
    const orphan = detached.create('agent-no-stream-dir');
    detached.emitSystemMessage(orphan.parentAgentId, orphan.id, '메모리에만 있는 대화');
    age();
    expect(detached.sweepIdleStreamBuffers(AGENT_IDLE_THRESHOLD_MS)).toEqual([]);
    detached.setProjectResolver(() => project);
    expect(detached.getStreamBuffer(orphan.id).map((event) => event.content)).toEqual(['메모리에만 있는 대화']);
  });

  it('releases hint-loaded history even when the session is not in the live registry', () => {
    const subId = 'archived-session';
    const dir = streamBufferStore.subStreamsDir(project, sub.parentAgentId);
    streamBufferStore.appendEvent(dir, {
      id: 'archived-line', subAgentId: subId, parentAgentId: sub.parentAgentId,
      timestamp: Date.now(), eventType: 'text', content: '보관된 대화',
    });
    const original = manager.getStreamBuffer(subId, sub.parentAgentId);
    age();
    expect(manager.sweepIdleStreamBuffers(AGENT_IDLE_THRESHOLD_MS)).toContain(subId);
    expect(buffers().has(subId)).toBe(false);
    expect(manager.getStreamBuffer(subId, sub.parentAgentId)).toEqual(original);
  });

  it('backs off verification when disk cannot restore a cached line', () => {
    const read = vi.spyOn(streamBufferStore, 'loadBuffer').mockReturnValue([]);
    age();
    expect(manager.sweepIdleStreamBuffers(AGENT_IDLE_THRESHOLD_MS)).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 30_000);
    manager.sweepIdleStreamBuffers(AGENT_IDLE_THRESHOLD_MS);
    expect(read).toHaveBeenCalledTimes(1);
    age();
    manager.sweepIdleStreamBuffers(AGENT_IDLE_THRESHOLD_MS);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('ignores invalid idle threshold %s', (threshold) => {
    age();
    expect(manager.sweepIdleStreamBuffers(threshold)).toEqual([]);
    expect(buffers().has(sub.id)).toBe(true);
  });
});
