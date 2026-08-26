/**
 * §5.10 v2 (C) — 회상 회귀.
 *
 * 여기서 못 박는 것은 셋이다 — ① 한국어가 조사·어미와 함께 와도 찾는가 ② 세션 하나가 결과를
 * 통째로 먹지 않는가 ③ **전량을 훑지 않는가**(상시 sweep 이 트랜스크립트를 전량 재파싱해 앱이
 * 느려졌던 전례가 있어, 최근 N개 상한이 실제로 지켜지는지가 성능 계약이다).
 *
 * `listJsonlSessionIds` 는 사용자 홈(`~/.claude/projects`)을 읽으므로 반드시 대체한다 —
 * 테스트가 실제 사용자 자산을 건드리면 안 된다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let dir: string;
const files: { sessionId: string; jsonlPath: string }[] = [];

vi.mock('./sessionDiscovery.js', () => ({
  listJsonlSessionIds: () => files,
}));

/** JSONL 한 줄 — 대화 메시지. */
function msg(role: 'user' | 'assistant', text: string, iso = '2026-08-25T00:00:00.000Z'): string {
  return JSON.stringify({
    type: role,
    timestamp: iso,
    message: { role, content: [{ type: 'text', text }] },
  });
}

function writeSession(sessionId: string, lines: string[], mtimeMs?: number): void {
  const p = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(p, lines.join('\n'));
  if (mtimeMs != null) fs.utimesSync(p, mtimeMs / 1000, mtimeMs / 1000);
  files.push({ sessionId, jsonlPath: p });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-recall-'));
  files.length = 0;
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function recall(query: string, options?: { limit?: number; sessionScanMax?: number }) {
  const { recallFromSessions } = await import('./brainRecallService.js');
  return recallFromSessions({ root: dir, cwd: dir, query, ...(options ? { options } : {}) });
}

describe('회상 — 과거 세션 본문 찾기', () => {
  it('대화 본문에서 찾아 발췌를 돌려준다', async () => {
    writeSession('s1', [
      msg('user', '체크포인트 저장이 자꾸 프리즈됩니다'),
      msg('assistant', '훅 경로에서 동기 저장을 코얼레스해서 고쳤습니다'),
    ]);
    const hits = await recall('체크포인트 프리즈');
    expect(hits.length).toBe(1);
    expect(hits[0]?.sessionId).toBe('s1');
    expect(hits[0]?.excerpt).toContain('프리즈');
  });

  it('한국어 조사가 붙어도 찾는다 (어절만으로는 놓치는 자리)', async () => {
    writeSession('s1', [msg('user', '수집기는 statusLine 으로 값을 밀어 넣습니다')]);
    const hits = await recall('수집기');
    expect(hits.length).toBe(1);
  });

  it('무관한 질의면 아무것도 안 준다', async () => {
    writeSession('s1', [msg('user', '체크포인트 저장 이야기')]);
    expect(await recall('전혀 상관없는 외계어 질의')).toEqual([]);
  });

  it('빈 질의는 즉시 빈 결과다 (파일을 읽지도 않는다)', async () => {
    writeSession('s1', [msg('user', '아무 내용')]);
    expect(await recall('   ')).toEqual([]);
  });
});

describe('회상 — 잡음 제거', () => {
  it('system-reminder 상용구는 발췌에 안 나온다', async () => {
    writeSession('s1', [
      msg('user', '진짜 질문입니다<system-reminder>매 턴 붙는 상용구 체크포인트</system-reminder>'),
    ]);
    const hits = await recall('진짜 질문');
    expect(hits[0]?.excerpt).not.toContain('상용구');
  });

  it('base64 덩어리는 잘라낸다', async () => {
    const blob = 'aGVsbG93b3JsZA'.repeat(20);
    writeSession('s1', [msg('user', `체크포인트 자료 ${blob} 끝`)]);
    const hits = await recall('체크포인트 자료');
    expect(hits[0]?.excerpt).not.toContain(blob);
  });

  it('thinking·tool_use 블록은 본문으로 치지 않는다', async () => {
    writeSession('s1', [
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [
          { type: 'thinking', thinking: '체크포인트를 어떻게 고칠까 고민' },
          { type: 'tool_use', name: 'Read', input: { file_path: '체크포인트.ts' } },
        ] },
      }),
    ]);
    expect(await recall('체크포인트')).toEqual([]);
  });

  it('깨진 JSON 라인이 섞여도 던지지 않는다', async () => {
    writeSession('s1', ['not json', '{broken', msg('user', '체크포인트 프리즈')]);
    expect((await recall('체크포인트 프리즈')).length).toBe(1);
  });
});

describe('회상 — 결과 분배와 상한', () => {
  it('세션 하나가 결과를 통째로 먹지 않는다 (세션당 최대 1건)', async () => {
    writeSession('s1', [
      msg('user', '체크포인트 프리즈 1'),
      msg('user', '체크포인트 프리즈 2'),
      msg('user', '체크포인트 프리즈 3'),
    ]);
    const hits = await recall('체크포인트 프리즈');
    expect(hits.length).toBe(1);
  });

  it('여러 세션에 걸쳐 찾는다', async () => {
    writeSession('s1', [msg('user', '체크포인트 프리즈 이야기')]);
    writeSession('s2', [msg('user', '체크포인트 프리즈 다른 이야기')]);
    const hits = await recall('체크포인트 프리즈');
    expect(hits.map((h) => h.sessionId).sort()).toEqual(['s1', 's2']);
  });

  it('limit 을 넘겨 주지 않는다', async () => {
    for (let i = 0; i < 5; i++) writeSession(`s${i}`, [msg('user', '체크포인트 프리즈')]);
    expect((await recall('체크포인트 프리즈', { limit: 2 })).length).toBe(2);
  });

  it('최근 세션만 훑는다 — 오래된 세션은 상한 밖으로 밀린다 (전량 재파싱 방지)', async () => {
    const now = Date.now();
    writeSession('old', [msg('user', '체크포인트 프리즈 옛날')], now - 100_000);
    writeSession('new', [msg('user', '체크포인트 프리즈 최근')], now);
    const hits = await recall('체크포인트 프리즈', { sessionScanMax: 1 });
    expect(hits.map((h) => h.sessionId)).toEqual(['new']);
  });

  it('세션이 하나도 없으면 빈 결과다', async () => {
    expect(await recall('무엇이든')).toEqual([]);
  });
});
