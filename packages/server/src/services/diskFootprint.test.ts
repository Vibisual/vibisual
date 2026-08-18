/**
 * 디스크 사용량 무한 증가 방지 테스트 (v4.67).
 *
 * 회귀 방지 대상 — "쓸수록 끝없이 커지는" 세 경로. 셋 다 **기존 동작을 바꾸지 않는 것**이
 * 조건이므로, 줄었다는 것뿐 아니라 **소비자가 보는 결과가 동일하다**는 것까지 검증한다.
 *
 *  1) `debugLog` — 상한 없는 append 로 한 파일이 590MB 까지 자랐다. 회전 + 정상상태 침묵.
 *  2) `streamBufferStore` — append-only jsonl(총 44MB). 컴팩션 후에도 `loadBuffer` 결과 동일.
 *  3) `toProjectCheckpoint` 의 `fileEdits` — 노드 없는 고아 키가 저장·복원만 되고 UI 엔 못 갔다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dbg, dbgOnChange, setDebugLogDir } from './debugLog.js';
import { appendEvent, flushAll, loadBuffer, subStreamsDir, deleteAgentStreams } from './streamBufferStore.js';
import type { ProjectInfo, SubAgentStreamEvent } from '@vibisual/shared';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-footprint-'));
});

afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ─────────────────────────────────────────────────────────────
describe('debugLog — 회전과 정상상태 침묵', () => {
  const logFile = (): string => path.join(tmpRoot, 'logs', 'bubble-lifecycle.txt');

  beforeEach(() => {
    setDebugLogDir(path.join(tmpRoot, 'logs'));
  });

  it('주입한 디렉토리에 기록한다 (cwd 상대가 아니라)', () => {
    dbg('test.tag', { a: 1 });
    expect(fs.existsSync(logFile())).toBe(true);
    expect(fs.readFileSync(logFile(), 'utf8')).toContain('test.tag');
  });

  it('2MB 를 넘으면 .1 로 밀어내고 새로 시작한다 — 한 파일이 무한히 자라지 않는다', () => {
    const chunk = 'x'.repeat(64 * 1024);
    // 2MB 를 확실히 넘기도록 채운다.
    for (let i = 0; i < 40; i += 1) dbg('fill', { chunk });
    dbg('after-rotate');

    expect(fs.existsSync(`${logFile()}.1`)).toBe(true);
    const size = fs.statSync(logFile()).size;
    expect(size).toBeLessThan(2 * 1024 * 1024);
    expect(fs.readFileSync(logFile(), 'utf8')).toContain('after-rotate');
  });

  it('dbgOnChange 는 signature 가 같으면 기록하지 않고, 달라지면 기록한다', () => {
    expect(dbgOnChange('poll', 'A', 'poll.tag', { v: 'A' })).toBe(true);
    expect(dbgOnChange('poll', 'A', 'poll.tag', { v: 'A' })).toBe(false);
    expect(dbgOnChange('poll', 'A', 'poll.tag', { v: 'A' })).toBe(false);
    expect(dbgOnChange('poll', 'B', 'poll.tag', { v: 'B' })).toBe(true);

    const lines = fs.readFileSync(logFile(), 'utf8').split('\n').filter((l) => l.includes('poll.tag'));
    expect(lines).toHaveLength(2); // 반복 3회가 아니라 변화 2회만
  });

  it('key 가 다르면 서로의 침묵에 영향받지 않는다', () => {
    expect(dbgOnChange('k1', 'S', 'tag', 1)).toBe(true);
    expect(dbgOnChange('k2', 'S', 'tag', 2)).toBe(true); // 같은 signature 라도 다른 key 는 별개
    expect(dbgOnChange('k1', 'S', 'tag', 1)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
describe('streamBufferStore — 컴팩션은 소비자에게 no-op', () => {
  const info = (): ProjectInfo => ({ name: 'proj', path: tmpRoot } as ProjectInfo);

  function makeEvent(subAgentId: string, n: number, padBytes = 0): SubAgentStreamEvent {
    return {
      id: `evt-${n}`,
      subAgentId,
      parentAgentId: 'agent-1',
      type: 'text',
      text: `line-${n}${padBytes ? ` ${'p'.repeat(padBytes)}` : ''}`,
      timestamp: 1_000 + n,
    } as unknown as SubAgentStreamEvent;
  }

  it('컴팩션 전후로 loadBuffer(…, 2000) 결과가 완전히 동일하다', () => {
    const dir = subStreamsDir(info(), 'agent-1');
    const subId = 'sub-a';

    // 3MB 임계를 확실히 넘기도록 큰 이벤트를 충분히 쌓는다.
    for (let i = 0; i < 4_500; i += 1) appendEvent(dir, makeEvent(subId, i, 2_000));
    flushAll();

    const compacted = loadBuffer(dir, subId, 2_000);
    expect(compacted).toHaveLength(2_000);
    // 마지막 2,000개가 그대로 — 잘린 쪽은 어차피 읽기 경로가 버리던 앞부분이다.
    expect(compacted[0]?.id).toBe('evt-2500');
    expect(compacted[1_999]?.id).toBe('evt-4499');

    // 파일도 실제로 작아져 있어야 한다(무한 증가 차단).
    const files = fs.readdirSync(dir);
    expect(files).toContain('sub-a.jsonl');
    const lines = fs.readFileSync(path.join(dir, 'sub-a.jsonl'), 'utf8').split('\n').filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(3_000);
    // ⚠ 읽기 상한(MAX_STREAM_BUFFER=2000)보다는 반드시 많이 남아야 복원이 깎이지 않는다.
    //   §5.5 v4.92 — 상한을 올릴 때 이 두 수를 함께 올리지 않으면 복원 대화가 조용히 잘린다.
    expect(lines.length).toBeGreaterThanOrEqual(2_000);
  });

  it('임계 이하 파일은 건드리지 않는다 (모든 이벤트 보존)', () => {
    const dir = subStreamsDir(info(), 'agent-1');
    for (let i = 0; i < 30; i += 1) appendEvent(dir, makeEvent('sub-b', i));
    flushAll();

    const loaded = loadBuffer(dir, 'sub-b', 500);
    expect(loaded).toHaveLength(30);
    expect(loaded[0]?.id).toBe('evt-0');
  });

  it('deleteAgentStreams 는 폴더를 지우고, 이후 flush 가 되살리지 않는다', () => {
    const dir = subStreamsDir(info(), 'agent-1');
    appendEvent(dir, makeEvent('sub-c', 1));
    flushAll();
    expect(fs.existsSync(dir)).toBe(true);

    // 아직 디스크에 안 쓴 pending 이 남은 상태에서 삭제해도 되살아나면 안 된다.
    appendEvent(dir, makeEvent('sub-c', 2));
    deleteAgentStreams(dir);
    flushAll();

    expect(fs.existsSync(dir)).toBe(false);
  });
});
