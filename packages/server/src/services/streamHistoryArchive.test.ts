/**
 * §3.2.3 · §5.5 #17-12 — **긴 대화의 앞부분은 지워지지 않고, 거슬러 읽힌다.**
 *
 * 사용자 보고(2026-09-12): 며칠 이어 쓴 대화를 다시 열면 앞 턴들이 날짜 박힌 말풍선과 짧은 마지막 답만
 * 남고 그 사이 대화가 사라져 보였다. 원인은 두 겹이었다.
 *  1. 읽기 — IDE 가 되살리는 것이 서버의 마지막 2,000건뿐이라 그보다 앞의 턴은 받아 올 길이 없었다.
 *  2. 저장 — 스트림 파일이 3MB 를 넘으면 컴팩션이 뒤 3,000줄만 남기고 **앞부분을 지웠다**
 *     (실측: 머리 약 5시간·약 48분이 이미 디스크에 없던 세션이 있었다).
 *
 * 여기서 잠그는 것 — ① 컴팩션은 앞부분을 보관 파일로 옮길 뿐 버리지 않는다 ② 옮기지 못하면 줄이지도
 * 않는다 ③ 복원 창 첫 줄에서 거슬러 올라가면 보관 파일 경계를 넘어 첫 줄까지 빠짐·겹침 없이 닿는다
 * ④ 도중에 꺼져 같은 줄이 두 곳에 남아도 한 번씩만 싣는다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectInfo, SubAgentStreamEvent } from '@vibisual/shared';
import { SUB_STREAM_ARCHIVE_SUFFIX } from '@vibisual/shared';
import { appendEvent, deleteBuffer, flushAll, loadBuffer, loadEventsBefore, subStreamsDir } from './streamBufferStore.js';

let tmpRoot: string;
let dir: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-history-'));
  dir = subStreamsDir({ name: 'history-proj', path: path.join(tmpRoot, 'history-proj') } as ProjectInfo, 'agent-h');
});

afterEach(() => {
  flushAll();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

function makeEvent(subId: string, n: number, padBytes = 0): SubAgentStreamEvent {
  return {
    id: `evt-${n}`,
    subAgentId: subId,
    parentAgentId: 'agent-h',
    timestamp: 1_000 + n,
    eventType: 'text',
    content: `line-${n}${padBytes > 0 ? ` ${'p'.repeat(padBytes)}` : ''}`,
  };
}

function idsInFile(fp: string): string[] {
  if (!fs.existsSync(fp)) return [];
  return fs.readFileSync(fp, 'utf8').split('\n').filter(Boolean).map((l) => (JSON.parse(l) as SubAgentStreamEvent).id);
}

function range(from: number, to: number): string[] {
  return Array.from({ length: to - from }, (_, i) => `evt-${from + i}`);
}

/** 3MB 임계를 넘기고 3,000줄도 넘기도록 큰 줄을 쌓는다(컴팩션이 실제로 여러 번 돈다). */
function writeLongConversation(subId: string, count: number): void {
  for (let i = 0; i < count; i += 1) appendEvent(dir, makeEvent(subId, i, 1_100));
  flushAll();
}

describe('§3.2.3 — 컴팩션은 앞부분을 보관 파일로 옮긴다(지우지 않는다)', () => {
  it('본 파일은 종전처럼 줄고, 보관 파일 + 본 파일 = 쓴 줄 전부(순서대로, 한 번씩)', () => {
    const subId = 'sub-archive';
    writeLongConversation(subId, 4_000);

    const live = idsInFile(path.join(dir, `${subId}.jsonl`));
    const archived = idsInFile(path.join(dir, `${subId}${SUB_STREAM_ARCHIVE_SUFFIX}`));
    // 본 파일의 모양은 종전 그대로 — 복원 창(2,000)보다 넉넉히, 3,000줄 이하.
    expect(live.length).toBeLessThanOrEqual(3_000);
    expect(live.length).toBeGreaterThanOrEqual(2_000);
    // 종전엔 여기가 0 이었다 — 앞부분이 디스크에서 사라졌다.
    expect(archived.length).toBeGreaterThan(0);
    expect([...archived, ...live]).toEqual(range(0, 4_000));

    // 복원 창(마지막 2,000건)은 컴팩션 전과 같다.
    const tail = loadBuffer(dir, subId, 2_000);
    expect(tail[0]?.id).toBe('evt-2000');
    expect(tail[tail.length - 1]?.id).toBe('evt-3999');
  });

  it('보관 파일에 옮겨 적지 못하면 본 파일을 줄이지 않는다 — 앞부분이 어디에도 없는 순간이 없다', () => {
    const subId = 'sub-archive-blocked';
    // 보관 파일 자리에 폴더가 있어 쓰기가 실패하는 상황(권한·잠김과 같은 결과).
    fs.mkdirSync(path.join(dir, `${subId}${SUB_STREAM_ARCHIVE_SUFFIX}`), { recursive: true });
    writeLongConversation(subId, 3_400);

    expect(idsInFile(path.join(dir, `${subId}.jsonl`))).toEqual(range(0, 3_400));
  });

  it('세션을 지우는 호출(deleteBuffer)은 보관 파일도 함께 지운다 — 주인 없는 고아를 남기지 않는다', () => {
    const subId = 'sub-archive-delete';
    writeLongConversation(subId, 3_300);
    expect(fs.existsSync(path.join(dir, `${subId}${SUB_STREAM_ARCHIVE_SUFFIX}`))).toBe(true);

    deleteBuffer(dir, subId);

    expect(fs.existsSync(path.join(dir, `${subId}.jsonl`))).toBe(false);
    expect(fs.existsSync(path.join(dir, `${subId}${SUB_STREAM_ARCHIVE_SUFFIX}`))).toBe(false);
  });
});

describe('§5.5 #17-12 — 복원 창 위쪽 거슬러 읽기(loadEventsBefore)', () => {
  it('복원 창 첫 줄에서 거슬러 올라가면 보관 파일 경계를 넘어 첫 줄까지 빠짐·겹침 없이 닿는다', () => {
    const subId = 'sub-walk';
    writeLongConversation(subId, 4_000);

    const window = loadBuffer(dir, subId, 2_000);
    const seen = window.map((e) => e.id);
    let first = window[0]!;
    let pages = 0;
    for (;;) {
      const page = loadEventsBefore(dir, subId, { beforeId: first.id, beforeTs: first.timestamp }, 700);
      pages += 1;
      if (page.events.length > 0) {
        seen.unshift(...page.events.map((e) => e.id));
        first = page.events[0]!;
      }
      if (!page.hasMore) break;
      expect(pages).toBeLessThan(10); // 무한 반복 방지
    }

    expect(seen).toEqual(range(0, 4_000));
    // 2,000 = 700 + 700 + 600 — 마지막 쪽에서만 "더 없다"가 선다.
    expect(pages).toBe(3);
  });

  it('남은 줄이 딱 한 쪽 크기면 그 쪽에서 "더 없다"를 말한다(헛 요청을 한 번 더 부르지 않게)', () => {
    const subId = 'sub-exact';
    for (let i = 0; i < 20; i += 1) appendEvent(dir, makeEvent(subId, i));
    flushAll();

    const page = loadEventsBefore(dir, subId, { beforeId: 'evt-10' }, 10);
    expect(page.events.map((e) => e.id)).toEqual(range(0, 10));
    expect(page.hasMore).toBe(false);
  });

  it('도중에 꺼져 같은 줄이 보관 파일과 본 파일에 함께 남아도 한 번씩만 싣고, 쪽 경계에서도 겹치지 않는다', () => {
    const subId = 'sub-dup';
    fs.mkdirSync(dir, { recursive: true });
    const lines = (from: number, to: number): string =>
      Array.from({ length: to - from }, (_, i) => JSON.stringify(makeEvent(subId, from + i))).join('\n') + '\n';
    // 보관 파일에 앞 50줄을 옮겨 적은 뒤, 본 파일을 줄이기 전에 꺼진 모양.
    fs.writeFileSync(path.join(dir, `${subId}${SUB_STREAM_ARCHIVE_SUFFIX}`), lines(0, 50), 'utf8');
    fs.writeFileSync(path.join(dir, `${subId}.jsonl`), lines(0, 100), 'utf8');

    const all = loadEventsBefore(dir, subId, { beforeId: 'evt-60' }, 1_000);
    expect(all.events.map((e) => e.id)).toEqual(range(0, 60));
    expect(all.hasMore).toBe(false);

    const small = loadEventsBefore(dir, subId, { beforeId: 'evt-5' }, 3);
    expect(small.events.map((e) => e.id)).toEqual(['evt-2', 'evt-3', 'evt-4']);
    expect(small.hasMore).toBe(true);
    const rest = loadEventsBefore(dir, subId, { beforeId: 'evt-2' }, 3);
    expect(rest.events.map((e) => e.id)).toEqual(['evt-0', 'evt-1']);
    expect(rest.hasMore).toBe(false);
  });

  it('기준 id 가 디스크에 없으면(디스크에 안 내려간 줄) 그 시각보다 이른 줄로 대신 고른다', () => {
    const subId = 'sub-ts';
    for (let i = 0; i < 100; i += 1) appendEvent(dir, makeEvent(subId, i));
    flushAll();

    const page = loadEventsBefore(dir, subId, { beforeId: 'memory-only', beforeTs: 1_000 + 50 }, 10);
    expect(page.events.map((e) => e.id)).toEqual(range(40, 50));
    expect(page.hasMore).toBe(true);
  });

  it('그림 줄(읽기 경로가 덧붙인 id)이 기준이면 그 그림을 낳은 본문 줄도 함께 싣는다', () => {
    const subId = 'sub-image';
    for (let i = 0; i < 10; i += 1) appendEvent(dir, makeEvent(subId, i));
    flushAll();

    const page = loadEventsBefore(dir, subId, { beforeId: 'evt-5:image:0' }, 100);
    expect(page.events.map((e) => e.id)).toEqual(range(0, 6));
    expect(page.hasMore).toBe(false);
  });

  it('아직 디스크에 안 내려간 줄도 기준점으로 찾는다(읽기 전에 먼저 내린다)', () => {
    const subId = 'sub-pending';
    for (let i = 0; i < 30; i += 1) appendEvent(dir, makeEvent(subId, i));
    // flushAll 없이 곧장 읽는다 — 배칭 대기 중인 줄에 기준점이 있다.
    const page = loadEventsBefore(dir, subId, { beforeId: 'evt-29' }, 5);
    expect(page.events.map((e) => e.id)).toEqual(range(24, 29));
  });

  it('파일이 없으면 빈 쪽 — 없는 대화를 지어내지 않는다', () => {
    const page = loadEventsBefore(dir, 'sub-none', { beforeId: 'evt-1' }, 10);
    expect(page).toEqual({ events: [], hasMore: false });
  });
});
