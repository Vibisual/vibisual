// §5.5 — IDE 상태바가 **세션마다 다른 숫자**를 그리기 위해 기대는 한 가지 사실을 고정한다.
//
// 배경: `projectGraph.getSnapshot()` 의 sub enrich 는 세션 JSONL 을 한 번 읽고
// (`readContextInfo`) 그 결과의 누적 토큰을 sub 에 실어 준다. 종전에는 그 자리를
// `subAgentManager` 만 채웠는데, 그쪽은 **명령이 끝날 때만** 갱신한다 — 그래서 도는 중인 세션은
// 숫자가 얼어 있고, 한 번도 명령을 마치지 않은 세션은 값이 아예 없어 상태바가 버블 값
// (= 그 에이전트의 **모든 세션 합계**)으로 굴러떨어졌다. 사용자 보고가 그것이다:
// "세션을 넘겨도 입력 1267.2M / 출력 7.4M 가 그대로다".
//
// 그래서 두 경로가 **같은 수를 내야** 한다 — 안 그러면 명령이 끝나는 순간 상태바 숫자가 튄다.
//   ① `readContextInfo` 의 누적 == `readSessionTokenData` 턴 합산 (subAgentManager 의 공식)
//   ② `contextUsed` 는 **마지막 턴 하나**의 입력 크기 (누적이 아니다)
//   ③ 세션이 다르면 수도 다르다 (= 상태바가 세션을 넘길 때 실제로 변한다)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readContextInfo, readSessionTokenData } from './sessionDiscovery.js';

/** 세션 JSONL 은 `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl` 에 산다. */
function sessionPath(sessionId: string, cwd: string): string {
  const slug = cwd.replace(/[/\\:.]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', slug, `${sessionId}.jsonl`);
}

function assistantLine(
  model: string,
  input: number,
  output: number,
  opts: { cacheRead?: number; cacheCreate?: number } = {},
): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-09-02T00:00:00.000Z',
    message: {
      model,
      content: [],
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

/** `subAgentManager` 가 명령 종료 시 쓰는 그 공식 — 여기 한 벌만 두고 대조한다. */
function managerTotals(cwd: string, sessionId: string): { totalIn: number; totalOut: number } {
  const data = readSessionTokenData(cwd, sessionId);
  let totalIn = 0;
  let totalOut = 0;
  for (const t of data?.turns ?? []) {
    totalIn += t.inputTokens + t.cacheReadTokens + t.cacheCreateTokens;
    totalOut += t.outputTokens;
  }
  return { totalIn, totalOut };
}

describe('readContextInfo — 세션별 누적 토큰이 명령 종료 경로와 같은 수를 낸다', () => {
  const cwd = path.join(os.tmpdir(), 'vibisual-session-context-tokens-test');
  const created: string[] = [];

  const write = (sessionId: string, body: string): string => {
    const p = sessionPath(sessionId, cwd);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    created.push(p);
    return p;
  };

  beforeEach(() => {
    for (const p of created.splice(0)) { try { fs.rmSync(p); } catch { /* 이미 없음 */ } }
  });

  afterEach(() => {
    for (const p of created.splice(0)) { try { fs.rmSync(p); } catch { /* 이미 없음 */ } }
  });

  it('누적 입출력이 subAgentManager 의 턴 합산과 정확히 같다', () => {
    const sid = 'ctxtok-a000-0000-0000-000000000001';
    write(sid, [
      userLine('첫 질문'),
      assistantLine('claude-opus-5', 100, 10),
      userLine('두 번째'),
      assistantLine('claude-opus-5', 250, 20, { cacheRead: 1_000, cacheCreate: 40 }),
      assistantLine('claude-opus-5', 300, 30, { cacheRead: 2_000 }),
    ].join('\n') + '\n');

    const info = readContextInfo(cwd, sid);
    const { totalIn, totalOut } = managerTotals(cwd, sid);

    expect(info).not.toBeNull();
    expect(info?.cumulativeInputTokens).toBe(totalIn);
    expect(info?.cumulativeOutputTokens).toBe(totalOut);
    // 손으로도 한 번 — 공식이 양쪽에서 동시에 바뀌어도 잡히도록.
    expect(totalIn).toBe(100 + (250 + 1_000 + 40) + (300 + 2_000));
    expect(totalOut).toBe(10 + 20 + 30);
  });

  it('contextUsed 는 누적이 아니라 마지막 턴 하나의 입력 크기다', () => {
    const sid = 'ctxtok-b000-0000-0000-000000000002';
    write(sid, [
      assistantLine('claude-opus-5', 100, 10),
      assistantLine('claude-opus-5', 157_000, 30, { cacheRead: 0 }),
    ].join('\n') + '\n');

    const info = readContextInfo(cwd, sid);
    expect(info?.contextUsed).toBe(157_000);
    expect(info?.cumulativeInputTokens).toBe(100 + 157_000);
    expect(info?.modelName).toBe('claude-opus-5');
  });

  it('세션이 다르면 수도 다르다 — 상태바가 탭을 넘길 때 실제로 변한다', () => {
    const a = 'ctxtok-c000-0000-0000-000000000003';
    const b = 'ctxtok-d000-0000-0000-000000000004';
    write(a, assistantLine('claude-opus-5', 9_733_989, 63_663) + '\n');
    write(b, assistantLine('claude-opus-5', 132_800_977, 551_820) + '\n');

    expect(readContextInfo(cwd, a)?.cumulativeInputTokens).toBe(9_733_989);
    expect(readContextInfo(cwd, b)?.cumulativeInputTokens).toBe(132_800_977);
    expect(readContextInfo(cwd, a)?.cumulativeOutputTokens).toBe(63_663);
    expect(readContextInfo(cwd, b)?.cumulativeOutputTokens).toBe(551_820);
  });

  it('한 턴도 안 돈 세션은 null — 상태바는 0 으로 그리고 버블 합계를 빌려오지 않는다', () => {
    const sid = 'ctxtok-e000-0000-0000-000000000005';
    write(sid, userLine('아직 답이 없다') + '\n');
    expect(readContextInfo(cwd, sid)).toBeNull();
  });
});
