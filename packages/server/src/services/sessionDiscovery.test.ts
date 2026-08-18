/**
 * §3.2.4 — `readUserMessages` · `readLastAssistantMessage` 의 **증분 이어읽기가 전량 재스캔과
 * 같은 결과**인지 고정한다.
 *
 * **배경**: 두 함수는 스냅샷 재구축이 살아있는 세션 전부에 대해 부른다. 종전엔 캐시 키가
 * (파일 크기·mtime) 뿐이라 트랜스크립트가 **한 줄이라도 자라면 처음부터 전량 재파싱**했고,
 * 캐시 예산에서 밀려나도 마찬가지였다. 실측 2026-08-16: 세션 178개(트랜스크립트 합 228MB)인
 * 기계에서 도구 이벤트 1회마다 832MB 를 읽고 코어 하나를 5초씩 잡았다. append-only 특성을 살려
 * 붙은 줄만 먹이도록 바꿨으므로, 이 테스트가 지키는 것은 하나다 — **최적화가 결과를 바꾸면 안 된다.**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_AGENT_EVENTS } from '@vibisual/shared';
import {
  readUserMessagesByPath,
  readLastAssistantMessageByPath,
  __resetSessionCachesForTest,
} from './sessionDiscovery.js';

let dir: string;
let fp: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-sessdisc-'));
  fp = path.join(dir, 'session.jsonl');
  __resetSessionCachesForTest();
});

afterEach(() => {
  __resetSessionCachesForTest();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 무시 */ }
});

let clock = 0;
/** 타임스탬프는 결과에 들어가므로(=id·timestamp) 호출 순서에 대해 결정적이어야 한다. */
function ts(): string {
  clock += 1000;
  return new Date(Date.UTC(2026, 7, 16, 0, 0, 0) + clock).toISOString();
}

function userLine(text: string): string {
  return JSON.stringify({ type: 'user', timestamp: ts(), message: { content: text } });
}

function assistantLine(text: string): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: ts(),
    message: { content: [{ type: 'text', text }] },
  });
}

function append(lines: string[]): void {
  fs.appendFileSync(fp, lines.join('\n') + '\n', 'utf8');
}

/** 캐시를 버리고 처음부터 다시 훑은 결과 — 비교 기준(= 종전 전량 재파싱). */
function fullUserMessages(): ReturnType<typeof readUserMessagesByPath> {
  __resetSessionCachesForTest();
  return readUserMessagesByPath(fp);
}

function fullLastAssistant(): string | null {
  __resetSessionCachesForTest();
  return readLastAssistantMessageByPath(fp);
}

describe('readUserMessages — 증분 == 전량 재스캔', () => {
  it('append 를 나눠 먹여도 전량 재스캔과 같다', () => {
    append([userLine('첫 질문'), assistantLine('첫 답')]);
    const warmed = readUserMessagesByPath(fp); // 캐시 워밍(증분 경로 재현)

    append([userLine('둘째 질문'), assistantLine('둘째 답')]);
    const incremental = readUserMessagesByPath(fp);

    expect(incremental).toEqual(fullUserMessages());
    expect(incremental.length).toBe(2);
    expect(warmed.length).toBe(1);
  });

  it('여러 차례 이어 먹여도 매번 전량 재스캔과 같다', () => {
    append([userLine('q0'), assistantLine('a0')]);
    readUserMessagesByPath(fp);
    for (let i = 1; i <= 6; i++) {
      append([userLine(`q${i}`), assistantLine(`a${i}`)]);
      expect(readUserMessagesByPath(fp)).toEqual(fullUserMessages());
    }
  });

  it('한 턴에 assistant 가 여러 번 붙어도(진행 중 턴) 전량 재스캔과 같다', () => {
    // ⚠ 핵심 — 마지막 턴은 아직 안 끝났을 수 있어 누적 상태에 커밋하면 안 된다.
    append([userLine('작업해줘'), assistantLine('1단계 했습니다')]);
    const mid = readUserMessagesByPath(fp);
    expect(mid).toEqual(fullUserMessages());

    append([assistantLine('2단계도 했습니다')]);
    const after = readUserMessagesByPath(fp);
    expect(after).toEqual(fullUserMessages());
    // 같은 턴 하나로 합쳐져야 한다(턴이 둘로 갈라지면 안 된다).
    expect(after.length).toBe(1);
    expect(after[0]?.response).toBe('1단계 했습니다\n\n2단계도 했습니다');
  });

  it('MAX_AGENT_EVENTS 를 넘겨도 id 일련번호가 전량 재스캔과 같다', () => {
    append([userLine('q0'), assistantLine('a0')]);
    readUserMessagesByPath(fp);
    for (let i = 1; i <= MAX_AGENT_EVENTS + 5; i++) {
      append([userLine(`q${i}`), assistantLine(`a${i}`)]);
    }
    const incremental = readUserMessagesByPath(fp);
    expect(incremental).toEqual(fullUserMessages());
    expect(incremental.length).toBe(MAX_AGENT_EVENTS);
  });

  it('개행 없이 끝난 줄은 결과에만 반영되고, 완결된 뒤에도 중복되지 않는다', () => {
    append([userLine('완결된 질문'), assistantLine('완결된 답')]);
    readUserMessagesByPath(fp);

    const partial = userLine('아직 쓰는 중');
    const head = partial.slice(0, 20);
    fs.appendFileSync(fp, head, 'utf8'); // 반쪽 줄 — JSON 으로 안 읽힌다
    expect(readUserMessagesByPath(fp)).toEqual(fullUserMessages());

    fs.appendFileSync(fp, partial.slice(20) + '\n', 'utf8'); // 줄 완결
    const done = readUserMessagesByPath(fp);
    expect(done).toEqual(fullUserMessages());
    expect(done.filter((e) => e.message === '아직 쓰는 중').length).toBe(1);
  });

  it('파일이 줄어들면(재작성) 처음부터 다시 읽어 전량 재스캔과 같다', () => {
    append([userLine('q1'), assistantLine('a1'), userLine('q2'), assistantLine('a2')]);
    readUserMessagesByPath(fp);

    fs.writeFileSync(fp, [userLine('새 대화')].join('\n') + '\n', 'utf8');
    const after = readUserMessagesByPath(fp);
    expect(after).toEqual(fullUserMessages());
    expect(after.length).toBe(1);
  });

  it('빈 파일·없는 파일에서도 전량 재스캔과 같다', () => {
    fs.writeFileSync(fp, '', 'utf8');
    expect(readUserMessagesByPath(fp)).toEqual(fullUserMessages());
    expect(readUserMessagesByPath(path.join(dir, 'nope.jsonl'))).toEqual([]);
  });

  it('돌려준 배열을 호출부가 고쳐도 캐시 원본이 오염되지 않는다', () => {
    append([userLine('q'), assistantLine('a')]);
    const first = readUserMessagesByPath(fp);
    first[0]!.response = '덮어씀';
    expect(readUserMessagesByPath(fp)[0]?.response).toBe('a');
  });
});

describe('readLastAssistantMessage — 증분 == 전량 재스캔', () => {
  it('append 를 나눠 먹여도 전량 재스캔과 같다', () => {
    append([userLine('q1'), assistantLine('a1')]);
    readUserMessagesByPath(fp);
    expect(readLastAssistantMessageByPath(fp)).toEqual(fullLastAssistant());

    append([assistantLine('a2')]);
    const incremental = readLastAssistantMessageByPath(fp);
    expect(incremental).toEqual(fullLastAssistant());
    expect(incremental).toBe('a1\n\na2');
  });

  it('새 user 가 오면 그 앞의 assistant 는 버려진다(전량 재스캔과 같다)', () => {
    append([userLine('q1'), assistantLine('a1')]);
    readLastAssistantMessageByPath(fp);

    append([userLine('q2'), assistantLine('a2')]);
    const incremental = readLastAssistantMessageByPath(fp);
    expect(incremental).toEqual(fullLastAssistant());
    expect(incremental).toBe('a2');
  });

  it('마지막 user 뒤에 assistant 가 없으면 null 이고, 그 뒤 붙으면 값이 된다', () => {
    append([userLine('q1'), assistantLine('a1'), userLine('q2')]);
    expect(readLastAssistantMessageByPath(fp)).toBeNull();
    expect(fullLastAssistant()).toBeNull();

    append([assistantLine('늦은 답')]);
    const incremental = readLastAssistantMessageByPath(fp);
    expect(incremental).toEqual(fullLastAssistant());
    expect(incremental).toBe('늦은 답');
  });

  // ⚠ 트랜스크립트는 append-only 라, 증분이 보장하는 되돌림은 **파일이 줄어든 경우**다
  //    (`readContextInfo`·`tokenScan` 도 같은 규약). 더 큰 내용으로의 전면 재작성은 규약 밖이다.
  it('파일이 줄어들면(재작성) 처음부터 다시 읽어 전량 재스캔과 같다', () => {
    for (let i = 0; i < 8; i++) append([userLine(`q${i}`), assistantLine(`a${i}`)]);
    readLastAssistantMessageByPath(fp);

    fs.writeFileSync(fp, [userLine('q'), assistantLine('새 답')].join('\n') + '\n', 'utf8');
    const after = readLastAssistantMessageByPath(fp);
    expect(after).toEqual(fullLastAssistant());
    expect(after).toBe('새 답');
  });
});
