import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubAgentStreamEvent } from '@vibisual/shared';
import { appendEvent, deleteAgentStreams, deleteBuffer, flushAll, hasBuffer, loadBuffer } from './streamBufferStore.js';

let dir: string;

beforeEach((): void => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-stream-retry-'));
});

afterEach((): void => {
  vi.restoreAllMocks();
  flushAll();
  fs.rmSync(dir, { recursive: true, force: true });
});

function event(id: string): SubAgentStreamEvent {
  return { id, subAgentId: 'sub-retry', parentAgentId: 'agent-retry', timestamp: 1, eventType: 'text', content: id };
}

function failNextAppend(): void {
  vi.spyOn(fs, 'appendFileSync').mockImplementationOnce((): never => {
    throw new Error('temporary file lock');
  });
}

describe('스트림 저장의 일시 실패', (): void => {
  it('쓰기 실패 뒤 다음 flush가 같은 메시지를 순서대로 한 번만 저장한다', (): void => {
    appendEvent(dir, event('first'));
    failNextAppend();
    flushAll();
    expect(hasBuffer(dir, 'sub-retry')).toBe(true);
    appendEvent(dir, event('second'));
    flushAll();
    flushAll();
    expect(loadBuffer(dir, 'sub-retry', 10).map((entry) => entry.id)).toEqual(['first', 'second']);
  });

  it('실패한 첫 메시지도 다음 읽기에서 저장을 재시도한다', (): void => {
    appendEvent(dir, event('first'));
    failNextAppend();
    flushAll();
    expect(loadBuffer(dir, 'sub-retry', 10).map((entry) => entry.id)).toEqual(['first']);
  });

  it('일부 메시지와 반쪽 JSON을 쓴 뒤 실패해도 재시도는 누락·중복을 남기지 않는다', (): void => {
    appendEvent(dir, event('saved'));
    flushAll();
    appendEvent(dir, event('first'));
    appendEvent(dir, event('second'));
    const append = fs.appendFileSync;
    vi.spyOn(fs, 'appendFileSync').mockImplementationOnce((file, data, options): never => {
      const text = String(data);
      append(file, text.slice(0, text.indexOf('\n') + 12), options);
      throw new Error('disk full after a partial write');
    });
    flushAll();
    // Even a failed rollback must retain the original offset for a later retry.
    vi.spyOn(fs, 'truncateSync').mockImplementationOnce((): never => { throw new Error('file busy'); });
    flushAll();
    appendEvent(dir, event('third'));
    flushAll();
    expect(loadBuffer(dir, 'sub-retry', 10).map((entry) => entry.id)).toEqual(['saved', 'first', 'second', 'third']);
  });

  it('저장 실패 뒤 명시 삭제한 메시지는 다음 flush에서 되살리지 않는다', (): void => {
    appendEvent(dir, event('deleted'));
    failNextAppend();
    flushAll();
    deleteBuffer(dir, 'sub-retry');
    flushAll();
    expect(hasBuffer(dir, 'sub-retry')).toBe(false);
    expect(loadBuffer(dir, 'sub-retry', 10)).toEqual([]);
  });

  it('실패한 배치의 부모 폴더를 지우면 다른 부모의 저장만 이어진다', (): void => {
    const parentDir = path.join(dir, 'deleted-parent');
    appendEvent(parentDir, event('deleted'));
    failNextAppend();
    flushAll();
    appendEvent(dir, event('survivor'));
    deleteAgentStreams(parentDir);
    flushAll();
    expect(fs.existsSync(parentDir)).toBe(false);
    expect(loadBuffer(dir, 'sub-retry', 10).map((entry) => entry.id)).toEqual(['survivor']);
  });
});
