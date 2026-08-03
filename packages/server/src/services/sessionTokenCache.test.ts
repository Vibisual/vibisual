// §9 — 세션 토큰 데이터 증분 캐시 등가성 테스트.
//
// `readSessionTokenData` 는 `/api/tokens/:sessionId` 의 본체다. DetailPanel 이 에이전트
// activity(=도구 이벤트) 마다 이 엔드포인트를 때리는데, 종전엔 호출마다 세션 JSONL **전체**를
// readFileSync + 전 줄 JSON.parse ×2벌(turns 루프 + collectSessionMeta) 했다. 자체 턴이 비면
// 서브에이전트 세션까지 연쇄 호출돼, 수 MB 파일 수십 개를 한 번에 읽으며 Electron 메인 스레드가
// 수백 ms 씩 멈췄다(= "1~2초마다 뚝뚝 끊긴다"의 정체).
//
// 증분화의 유일한 위험은 "빨라졌지만 값이 달라지는 것" 이므로 여기서는 성능이 아니라
// **전체 재파싱과 같은 결과가 나오는지**만 본다(sessionJsonlCache.test 와 같은 구성):
//   ① 한 번에 다 쓴 파일 == 여러 번 나눠 append 한 파일
//   ② 같은 파일을 다시 물어도 턴이 중복 누적되지 않는지
//   ③ 개행 없이 끝난 마지막 줄도 결과에 반영되되 캐시엔 커밋되지 않는지
//   ④ 파일이 줄어들면(재작성) 전체 재파싱으로 안전 복귀하는지
//   ⑤ meta 누적(도구 호출 수 등)이 증분 경로에서도 전체 파싱과 같은지

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionTokenData } from './sessionDiscovery.js';

/** 세션 JSONL 은 `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl` 에 산다. */
function sessionPath(sessionId: string, cwd: string): string {
  const slug = cwd.replace(/[/\\:.]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', slug, `${sessionId}.jsonl`);
}

function assistantLine(
  model: string,
  input: number,
  output: number,
  opts: { cacheRead?: number; cacheCreate?: number; tools?: string[]; ts?: string } = {},
): string {
  const content: unknown[] = (opts.tools ?? []).map((name) => ({ type: 'tool_use', name }));
  return JSON.stringify({
    type: 'assistant',
    timestamp: opts.ts ?? '2026-08-01T00:00:00.000Z',
    message: {
      model,
      content,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: opts.cacheRead ?? 0,
        cache_creation_input_tokens: opts.cacheCreate ?? 0,
      },
    },
  });
}

function userLine(text: string): string {
  return JSON.stringify({ type: 'user', message: { content: text } });
}

describe('readSessionTokenData — 증분 파싱 등가성', () => {
  const cwd = path.join(os.tmpdir(), 'vibisual-token-cache-test');
  const created: string[] = [];

  const write = (sessionId: string, body: string): string => {
    const p = sessionPath(sessionId, cwd);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    created.push(p);
    return p;
  };

  /** mtime 해상도 때문에 같은 ms 로 찍히면 캐시가 "안 바뀐 파일" 로 오인할 수 있다. */
  const touchForward = (p: string): void => {
    const t = new Date(Date.now() + 2000);
    fs.utimesSync(p, t, t);
  };

  beforeEach(() => {
    for (const p of created.splice(0)) { try { fs.rmSync(p); } catch { /* 이미 없음 */ } }
  });

  afterEach(() => {
    for (const p of created.splice(0)) { try { fs.rmSync(p); } catch { /* 이미 없음 */ } }
  });

  it('나눠 쓴 파일이 한 번에 쓴 파일과 같은 턴을 낸다', () => {
    const lines = [
      userLine('첫 질문'),
      assistantLine('claude-opus-5', 100, 10, { tools: ['Read'] }),
      userLine('두 번째 질문'),
      assistantLine('claude-opus-5', 250, 20, { cacheRead: 1000, tools: ['Edit', 'Read'] }),
      assistantLine('claude-sonnet-5', 300, 30),
    ];

    // (A) 한 번에 전부 — 전체 파싱 경로
    const whole = 'whole-tok-0000-0000-000000000001';
    write(whole, lines.join('\n') + '\n');
    const expected = readSessionTokenData(cwd, whole);

    // (B) 한 줄씩 append — 증분 경로(매 단계 호출로 캐시를 태운다)
    const inc = 'incr-tok-0000-0000-000000000002';
    const p = write(inc, lines[0] + '\n');
    readSessionTokenData(cwd, inc);
    for (let i = 1; i < lines.length; i++) {
      fs.appendFileSync(p, lines[i] + '\n');
      touchForward(p);
      readSessionTokenData(cwd, inc);
    }
    const actual = readSessionTokenData(cwd, inc);

    expect(actual?.turns).toEqual(expected?.turns);
    expect(actual?.categories).toEqual(expected?.categories);
    expect(actual?.turns).toHaveLength(3);
    // turnIndex 는 0부터 연속이어야 한다(증분 append 로도 어긋나지 않음).
    expect(actual?.turns.map((t) => t.turnIndex)).toEqual([0, 1, 2]);
    expect(actual?.turns[1]?.totalContext).toBe(250 + 1000);
    expect(actual?.turns[2]?.model).toBe('claude-sonnet-5');
  });

  it('같은 파일을 다시 물어도 턴이 중복 누적되지 않는다', () => {
    const sid = 'stable-tok-000-0000-000000000003';
    write(sid, [
      assistantLine('claude-opus-5', 500, 50),
      assistantLine('claude-opus-5', 100, 5),
    ].join('\n') + '\n');
    const first = readSessionTokenData(cwd, sid);
    const second = readSessionTokenData(cwd, sid);
    const third = readSessionTokenData(cwd, sid);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first?.turns).toHaveLength(2);
  });

  it('개행 없이 끝난 마지막 줄도 결과에 반영된다(중복 없이)', () => {
    const sid = 'tail-tok-0000-0000-000000000004';
    const p = write(sid, assistantLine('claude-opus-5', 100, 10) + '\n');
    expect(readSessionTokenData(cwd, sid)?.turns).toHaveLength(1);

    // 개행 없이 한 줄 더 — 아직 미완결이지만 값에는 보여야 한다.
    fs.appendFileSync(p, assistantLine('claude-opus-5', 70, 7));
    touchForward(p);
    const withTail = readSessionTokenData(cwd, sid);
    expect(withTail?.turns).toHaveLength(2);
    expect(withTail?.turns[1]?.inputTokens).toBe(70);

    // 개행이 붙어 완결돼도 두 번 세지 않는다.
    fs.appendFileSync(p, '\n');
    touchForward(p);
    const settled = readSessionTokenData(cwd, sid);
    expect(settled?.turns).toHaveLength(2);
    expect(settled?.turns).toEqual(withTail?.turns);
  });

  it('파일이 줄어들면(재작성) 전체 재파싱으로 복귀한다', () => {
    const sid = 'rewrite-tok-00-0000-000000000005';
    const p = write(sid, [
      assistantLine('claude-opus-5', 400, 40),
      assistantLine('claude-opus-5', 400, 40),
    ].join('\n') + '\n');
    expect(readSessionTokenData(cwd, sid)?.turns).toHaveLength(2);

    fs.writeFileSync(p, assistantLine('claude-sonnet-5', 25, 2) + '\n');
    touchForward(p);
    const after = readSessionTokenData(cwd, sid);
    expect(after?.turns).toHaveLength(1);
    expect(after?.turns[0]?.model).toBe('claude-sonnet-5');
    expect(after?.turns[0]?.inputTokens).toBe(25);
  });

  it('메타 누적(도구 호출·유저 메시지)이 증분 경로에서도 전체 파싱과 같다', () => {
    const lines = [
      userLine('a'),
      assistantLine('claude-opus-5', 10, 1, { tools: ['Read', 'Edit'] }),
      userLine('b'),
      assistantLine('claude-opus-5', 20, 2, { tools: ['Read'] }),
    ];

    const whole = 'meta-whole-000-0000-000000000006';
    write(whole, lines.join('\n') + '\n');
    const expected = readSessionTokenData(cwd, whole);

    const inc = 'meta-incr-000-0000-000000000007';
    const p = write(inc, lines[0] + '\n');
    readSessionTokenData(cwd, inc);
    for (let i = 1; i < lines.length; i++) {
      fs.appendFileSync(p, lines[i] + '\n');
      touchForward(p);
      readSessionTokenData(cwd, inc);
    }
    const actual = readSessionTokenData(cwd, inc);

    // categories 의 detail 문자열이 meta 누적에서 나온다 — 같으면 meta 도 같다.
    expect(actual?.categories).toEqual(expected?.categories);
  });

  it('반환된 turns 를 호출부가 변형해도 캐시가 오염되지 않는다', () => {
    const sid = 'isolate-tok-00-0000-000000000008';
    write(sid, [
      assistantLine('claude-opus-5', 10, 1),
      assistantLine('claude-opus-5', 20, 2),
    ].join('\n') + '\n');

    const first = readSessionTokenData(cwd, sid);
    first?.turns.reverse();
    first?.turns.push({
      turnIndex: 99, timestamp: 0, inputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheCreateTokens: 0, totalContext: 0, tools: [],
    });

    const second = readSessionTokenData(cwd, sid);
    expect(second?.turns).toHaveLength(2);
    expect(second?.turns[0]?.inputTokens).toBe(10);
    expect(second?.turns[1]?.inputTokens).toBe(20);
  });
});
