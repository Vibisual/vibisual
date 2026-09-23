import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enableAsyncDiskWrites, flushPendingDiskWritesSync, getDiskWriteQueueStats,
  queueAtomicWrite, shutdownDiskWriteQueue, retryFailedDiskWrites,
  acknowledgeSynchronousDiskWrite, writeFileAtomicSyncRaw,
} from './diskWriteQueue.js';

let tmpRoot: string;
const obstructions: string[] = [];

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-disk-retry-')));
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const target of obstructions.splice(0)) {
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) fs.rmdirSync(target);
  }
  shutdownDiskWriteQueue();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 3000, interval: 10 });
}

function obstruct(target: string): void {
  fs.mkdirSync(target);
  obstructions.push(target);
}

describe('disk write failures keep accepted snapshots available for retry', () => {
  it('retains a payload when both the real worker and synchronous fallback cannot rename it', async () => {
    const target = path.join(tmpRoot, 'checkpoint.json');
    obstruct(target);
    const failures = getDiskWriteQueueStats().failed;
    enableAsyncDiskWrites();
    expect(queueAtomicWrite(target, '{"saved":1}')).toBe(true);
    await waitFor(() => getDiskWriteQueueStats().failed > failures);

    expect(getDiskWriteQueueStats().pending).toBe(1);
    fs.rmdirSync(target);
    expect(flushPendingDiskWritesSync()).toBe(1);
    expect(fs.readFileSync(target, 'utf8')).toBe('{"saved":1}');
    expect(getDiskWriteQueueStats().pending).toBe(0);
  });

  it('a failed synchronous flush keeps the payload for the next flush', () => {
    const target = path.join(tmpRoot, 'checkpoint.json');
    obstruct(target);
    enableAsyncDiskWrites();
    expect(queueAtomicWrite(target, '{"saved":2}')).toBe(true);

    expect(flushPendingDiskWritesSync()).toBe(0);
    expect(getDiskWriteQueueStats().pending).toBe(1);
    fs.rmdirSync(target);
    expect(flushPendingDiskWritesSync()).toBe(1);
    expect(fs.readFileSync(target, 'utf8')).toBe('{"saved":2}');
  });

  it('a failed file does not loop or block unrelated files, and retries when requested', async () => {
    const target = path.join(tmpRoot, 'blocked.json');
    const other = path.join(tmpRoot, 'other.json');
    obstruct(target);
    const failures = getDiskWriteQueueStats().failed;
    enableAsyncDiskWrites();
    expect(queueAtomicWrite(target, '{"saved":3}')).toBe(true);
    await waitFor(() => getDiskWriteQueueStats().failed > failures);

    expect(queueAtomicWrite(other, '{"other":true}')).toBe(true);
    await waitFor(() => fs.existsSync(other));
    expect(getDiskWriteQueueStats().failed).toBe(failures + 1);
    expect(getDiskWriteQueueStats().pending).toBe(1);

    fs.rmdirSync(target);
    retryFailedDiskWrites();
    await waitFor(() => getDiskWriteQueueStats().pending === 0);
    expect(fs.readFileSync(target, 'utf8')).toBe('{"saved":3}');
  });

  it('a newer successful flush removes an older failed snapshot of the same file', () => {
    const target = path.join(tmpRoot, 'checkpoint.json');
    enableAsyncDiskWrites();
    expect(queueAtomicWrite(target, '{"seq":1}')).toBe(true);
    expect(queueAtomicWrite(target, '{"seq":2}')).toBe(true);
    const rename = fs.renameSync;
    let failFirst = true;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (failFirst && to === target) {
        failFirst = false;
        throw new Error('First pending version failed');
      }
      rename(from, to);
    });

    expect(flushPendingDiskWritesSync()).toBe(1);
    expect(getDiskWriteQueueStats().pending).toBe(0);
    expect(fs.readFileSync(target, 'utf8')).toBe('{"seq":2}');
    expect(flushPendingDiskWritesSync()).toBe(0);
  });

  it('successful synchronous fallback supersedes a retained failed snapshot', async () => {
    const target = path.join(tmpRoot, 'checkpoint.json');
    obstruct(target);
    const failures = getDiskWriteQueueStats().failed;
    enableAsyncDiskWrites();
    expect(queueAtomicWrite(target, '{"seq":1}')).toBe(true);
    await waitFor(() => getDiskWriteQueueStats().failed > failures);
    shutdownDiskWriteQueue();
    expect(getDiskWriteQueueStats().pending).toBe(1);
    // 워커가 내려간 false 경로. 실패한 이전 판본은 동기 저장 성공 전까지 보존한다.
    expect(queueAtomicWrite(target, '{"seq":2}')).toBe(false);
    fs.rmdirSync(target);
    writeFileAtomicSyncRaw(target, '{"seq":2}');
    acknowledgeSynchronousDiskWrite(target);

    expect(flushPendingDiskWritesSync()).toBe(0);
    expect(fs.readFileSync(target, 'utf8')).toBe('{"seq":2}');
  });
});
