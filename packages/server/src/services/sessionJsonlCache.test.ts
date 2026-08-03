// §9 v3.89 — 세션 JSONL 증분 캐시 등가성 테스트.
//
// readContextInfo 는 스냅샷 재구축의 최대 비용 지점이었다(에이전트·서브마다 수 MB JSONL 전체
// 재파싱). 증분화의 유일한 위험은 "빨라졌지만 값이 달라지는 것" 이므로, 여기서는 성능이 아니라
// **전체 재파싱과 바이트 단위로 같은 결과가 나오는지**만 본다:
//   ① 한 번에 다 쓴 파일 == 여러 번 나눠 append 한 파일
//   ② append 후 누적 토큰/마지막 컨텍스트가 정확히 갱신되는지
//   ③ 개행 없이 끝난 마지막 줄도 결과에 반영되는지(스트리밍 중 반쯤 쓰인 줄)
//   ④ 파일이 줄어들면(재작성) 전체 재파싱으로 안전 복귀하는지

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readContextInfo } from './sessionDiscovery.js';

/** 세션 JSONL 은 `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl` 에 산다. */
function sessionPath(sessionId: string, cwd: string): string {
  const slug = cwd.replace(/[/\\:.]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', slug, `${sessionId}.jsonl`);
}

function assistantLine(model: string, input: number, output: number, cacheRead = 0): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      model,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: 0,
      },
    },
  });
}

describe('readContextInfo — 증분 파싱 등가성', () => {
  const cwd = path.join(os.tmpdir(), 'vibisual-jsonl-cache-test');
  const created: string[] = [];

  const write = (sessionId: string, body: string): string => {
    const p = sessionPath(sessionId, cwd);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    created.push(p);
    return p;
  };

  /** mtime 해상도(초 단위 FS) 때문에 같은 ms 로 찍히면 캐시가 "안 바뀐 파일" 로 오인할 수 있다. */
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

  it('나눠 쓴 파일이 한 번에 쓴 파일과 같은 값을 낸다', () => {
    const lines = [
      assistantLine('claude-opus-5', 100, 10),
      assistantLine('claude-opus-5', 250, 20, 1000),
      assistantLine('claude-sonnet-5', 300, 30),
    ];

    // (A) 한 번에 전부 — 전체 파싱 경로
    const whole = 'whole-0000-0000-0000-000000000001';
    write(whole, lines.join('\n') + '\n');
    const expected = readContextInfo(cwd, whole);

    // (B) 한 줄씩 append — 증분 경로(매 단계 호출로 캐시를 태운다)
    const inc = 'incr-0000-0000-0000-000000000002';
    const p = write(inc, lines[0] + '\n');
    readContextInfo(cwd, inc);
    fs.appendFileSync(p, lines[1] + '\n');
    touchForward(p);
    readContextInfo(cwd, inc);
    fs.appendFileSync(p, lines[2] + '\n');
    touchForward(p);
    const actual = readContextInfo(cwd, inc);

    expect(actual).toEqual(expected);
    // 누적은 전 턴 합산, 마지막 컨텍스트는 마지막 턴 값.
    expect(actual?.cumulativeInputTokens).toBe(100 + 250 + 1000 + 300);
    expect(actual?.cumulativeOutputTokens).toBe(60);
    expect(actual?.contextUsed).toBe(300);
    expect(actual?.modelName).toBe('claude-sonnet-5');
  });

  it('같은 파일을 다시 물어도 값이 중복 합산되지 않는다', () => {
    const sid = 'stable-000-0000-0000-000000000003';
    write(sid, assistantLine('claude-opus-5', 500, 50) + '\n');
    const first = readContextInfo(cwd, sid);
    const second = readContextInfo(cwd, sid);
    const third = readContextInfo(cwd, sid);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first?.cumulativeInputTokens).toBe(500);
  });

  it('개행 없이 끝난 마지막 줄도 결과에 반영된다(중복 없이)', () => {
    const sid = 'tail-0000-0000-0000-000000000004';
    const p = write(sid, assistantLine('claude-opus-5', 100, 10) + '\n');
    expect(readContextInfo(cwd, sid)?.cumulativeInputTokens).toBe(100);

    // 개행 없이 한 줄 더 — 아직 미완결이지만 값에는 보여야 한다.
    fs.appendFileSync(p, assistantLine('claude-opus-5', 70, 7));
    touchForward(p);
    expect(readContextInfo(cwd, sid)?.cumulativeInputTokens).toBe(170);

    // 개행이 붙어 완결돼도 두 번 세지 않는다.
    fs.appendFileSync(p, '\n');
    touchForward(p);
    expect(readContextInfo(cwd, sid)?.cumulativeInputTokens).toBe(170);
  });

  it('파일이 줄어들면(재작성) 전체 재파싱으로 복귀한다', () => {
    const sid = 'rewrite-00-0000-0000-000000000005';
    const p = write(sid, [
      assistantLine('claude-opus-5', 400, 40),
      assistantLine('claude-opus-5', 400, 40),
    ].join('\n') + '\n');
    expect(readContextInfo(cwd, sid)?.cumulativeInputTokens).toBe(800);

    fs.writeFileSync(p, assistantLine('claude-sonnet-5', 25, 2) + '\n');
    touchForward(p);
    const after = readContextInfo(cwd, sid);
    expect(after?.cumulativeInputTokens).toBe(25);
    expect(after?.modelName).toBe('claude-sonnet-5');
  });
});
