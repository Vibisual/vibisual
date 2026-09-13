/**
 * §5.25 (F) — 코덱스 JSONL → 우리 스트림 이벤트 매핑 고정 시험.
 *
 * 이 매퍼가 이 기능의 **유일한 해석 지점**이라 여기가 틀리면 화면 전체가 같은 방식으로 틀어진다.
 * 특히 두 규율을 시험으로 못박는다:
 *   ① 모르는 줄은 `null` — 억지로 `text` 로 흘리지 않는다.
 *   ② `null`(못 알아본 줄) ≠ `{events:[]}`(알아봤지만 화면에 낼 것이 없는 줄).
 *
 * 표본은 2026-09-07 codex-cli 0.152.1 을 실제로 돌려 받은 줄이다.
 */
import { describe, it, expect } from 'vitest';
import {
  mapCodexLine, codexFileChangePaths,
  isCodexImageFile, codexImageBasename, codexImagePathFromUrl,
} from './codexStreamMap.js';

describe('mapCodexLine — 봉투(envelope) 종류', () => {
  it('thread.started 는 세션 id 를 준다(화면 이벤트는 없다)', () => {
    const r = mapCodexLine('{"type":"thread.started","thread_id":"0199c0de-dead-beef"}');
    expect(r).toEqual({ events: [], threadId: '0199c0de-dead-beef' });
  });

  it('thread_id 가 없으면 id 없이 빈 결과 — 지어내지 않는다', () => {
    expect(mapCodexLine('{"type":"thread.started"}')).toEqual({ events: [] });
  });

  it('turn.started 는 알아봤지만 낼 것이 없는 줄이다(null 이 아니다)', () => {
    const r = mapCodexLine('{"type":"turn.started"}');
    expect(r).not.toBeNull();
    expect(r?.events).toEqual([]);
    expect(r?.turnEnded).toBeUndefined();
  });

  it('turn.completed 는 턴을 끝내고 사용량을 싣는다', () => {
    const r = mapCodexLine(
      '{"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122,"reasoning_output_tokens":7}}',
    );
    expect(r?.turnEnded).toBe(true);
    expect(r?.usage).toEqual({
      inputTokens: 24763,
      cachedInputTokens: 24448,
      outputTokens: 122,
      reasoningOutputTokens: 7,
    });
  });

  it('usage 가 없는 turn.completed 도 턴은 끝난다', () => {
    const r = mapCodexLine('{"type":"turn.completed"}');
    expect(r?.turnEnded).toBe(true);
    expect(r?.usage).toBeUndefined();
  });

  it('turn.failed 는 사유를 남긴다 — 객체 모양과 문자열 모양 둘 다', () => {
    expect(mapCodexLine('{"type":"turn.failed","error":{"message":"boom"}}')).toEqual({
      events: [],
      turnEnded: true,
      error: 'boom',
    });
    expect(mapCodexLine('{"type":"turn.failed","error":"plain"}')).toEqual({
      events: [],
      turnEnded: true,
      error: 'plain',
    });
    // 사유가 비어도 실패는 실패다 — 빈 사유로 삼키지 않는다.
    expect(mapCodexLine('{"type":"turn.failed"}')?.error).toBe('turn failed');
  });

  it('error 줄은 화면에 내지만 턴을 끝내지 않는다', () => {
    // 한도 초과처럼 곧이어 turn.failed 가 따라오는 경우가 있어 여기서 턴을 닫으면 사유가 뒤바뀐다.
    const r = mapCodexLine('{"type":"error","message":"You\'ve hit your usage limit."}');
    expect(r?.events).toEqual([{ eventType: 'error', content: "You've hit your usage limit." }]);
    expect(r?.turnEnded).toBeUndefined();
  });
});

describe('mapCodexLine — 모르는 것을 넘겨짚지 않는다', () => {
  it('JSON 이 아니면 null', () => {
    expect(mapCodexLine('')).toBeNull();
    expect(mapCodexLine('   ')).toBeNull();
    expect(mapCodexLine('OpenAI Codex v0.152.1')).toBeNull();
    expect(mapCodexLine('{ not json')).toBeNull();
    expect(mapCodexLine('[1,2,3]')).toBeNull();
  });

  it('type 이 없거나 처음 보는 봉투면 null', () => {
    expect(mapCodexLine('{"foo":1}')).toBeNull();
    expect(mapCodexLine('{"type":"thread.rebased"}')).toBeNull();
  });

  it('처음 보는 item.type 이면 null — 원문이 화면에 쏟아지지 않는다', () => {
    expect(mapCodexLine('{"type":"item.completed","item":{"id":"i1","type":"hologram"}}')).toBeNull();
  });

  it('item 이 없거나 객체가 아니면 null', () => {
    expect(mapCodexLine('{"type":"item.completed"}')).toBeNull();
    expect(mapCodexLine('{"type":"item.completed","item":"nope"}')).toBeNull();
  });
});

describe('mapCodexLine — agent_message', () => {
  it('완료 줄만 본문을 낸다(최종 답변으로도 실린다)', () => {
    const r = mapCodexLine('{"type":"item.completed","item":{"id":"i3","type":"agent_message","text":"다 했습니다"}}');
    expect(r?.events).toEqual([{ eventType: 'text', content: '다 했습니다' }]);
    expect(r?.finalText).toBe('다 했습니다');
  });

  it('started/updated 는 흘리지 않는다 — 같은 말이 두 번 찍히는 것을 막는다', () => {
    const started = mapCodexLine('{"type":"item.started","item":{"id":"i3","type":"agent_message","text":"다 했"}}');
    const updated = mapCodexLine('{"type":"item.updated","item":{"id":"i3","type":"agent_message","text":"다 했습"}}');
    expect(started?.events).toEqual([]);
    expect(updated?.events).toEqual([]);
    expect(started?.finalText).toBeUndefined();
  });

  it('본문이 빈 완료 줄은 빈 말풍선을 만들지 않는다', () => {
    expect(mapCodexLine('{"type":"item.completed","item":{"id":"i3","type":"agent_message","text":""}}')?.events).toEqual([]);
  });
});

describe('mapCodexLine — reasoning', () => {
  it('완료 줄이 thinking 이 된다', () => {
    const r = mapCodexLine('{"type":"item.completed","item":{"id":"i2","type":"reasoning","text":"먼저 파일을 본다"}}');
    expect(r?.events).toEqual([{ eventType: 'thinking', content: '먼저 파일을 본다' }]);
    // 생각은 최종 답이 아니다.
    expect(r?.finalText).toBeUndefined();
  });

  it('text 가 없으면 summary 를 쓴다', () => {
    const r = mapCodexLine('{"type":"item.completed","item":{"id":"i2","type":"reasoning","summary":"요약본"}}');
    expect(r?.events).toEqual([{ eventType: 'thinking', content: '요약본' }]);
  });
});

describe('mapCodexLine — command_execution', () => {
  it('started 가 도구 카드를 세운다(id 가 짝짓기 키)', () => {
    const r = mapCodexLine(
      '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}',
    );
    expect(r?.events).toEqual([
      { eventType: 'tool_use', content: 'bash -lc ls', toolName: 'Bash', toolUseId: 'item_1' },
    ]);
  });

  it('updated 는 같은 카드의 갱신이라 흘리지 않는다', () => {
    const r = mapCodexLine(
      '{"type":"item.updated","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls"}}',
    );
    expect(r?.events).toEqual([]);
  });

  it('completed 는 종료 코드와 출력을 붙여 같은 id 로 닫는다', () => {
    const r = mapCodexLine(
      '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","exit_code":0,"aggregated_output":"a.txt\\nb.txt"}}',
    );
    expect(r?.events).toEqual([
      { eventType: 'tool_result', content: 'exit 0\na.txt\nb.txt', toolName: 'Bash', toolUseId: 'item_1' },
    ]);
  });

  it('exit_code 가 없으면 done, 출력이 없으면 머리말만', () => {
    const r = mapCodexLine('{"type":"item.completed","item":{"id":"item_1","type":"command_execution"}}');
    expect(r?.events[0]?.content).toBe('done');
  });

  it('command 가 없으면 argv 로 접는다', () => {
    const r = mapCodexLine(
      '{"type":"item.started","item":{"id":"item_9","type":"command_execution","argv":["git","status","--porcelain"]}}',
    );
    expect(r?.events[0]?.content).toBe('git status --porcelain');
  });
});

describe('mapCodexLine — file_change', () => {
  const started =
    '{"type":"item.started","item":{"id":"f1","type":"file_change","changes":[{"path":"src/a.ts","kind":"update"}]}}';
  const completed =
    '{"type":"item.completed","item":{"id":"f1","type":"file_change","changes":[{"path":"src/a.ts"},{"path":"src/b.ts"}]}}';

  it('started 는 Write 도구 카드를 세운다', () => {
    expect(mapCodexLine(started)?.events).toEqual([
      { eventType: 'tool_use', content: 'src/a.ts', toolName: 'Write', toolUseId: 'f1' },
    ]);
  });

  it('completed 는 고친 파일 수와 목록으로 닫는다', () => {
    expect(mapCodexLine(completed)?.events).toEqual([
      { eventType: 'tool_result', content: 'updated 2 file(s)\nsrc/a.ts, src/b.ts', toolName: 'Write', toolUseId: 'f1' },
    ]);
  });

  it('updated 는 흘리지 않는다', () => {
    expect(mapCodexLine(started.replace('item.started', 'item.updated'))?.events).toEqual([]);
  });
});

describe('codexFileChangePaths — 캔버스 파일 버블이 먹는 경로', () => {
  it('changes[].path 를 모은다', () => {
    expect(codexFileChangePaths({ changes: [{ path: 'a.ts' }, { path: 'b.ts' }] })).toEqual(['a.ts', 'b.ts']);
  });

  it('문자열 배열 모양도 받는다', () => {
    expect(codexFileChangePaths({ changes: ['a.ts', 'b.ts'] })).toEqual(['a.ts', 'b.ts']);
  });

  it('단일 path 모양을 받되 중복은 넣지 않는다', () => {
    expect(codexFileChangePaths({ path: 'only.ts' })).toEqual(['only.ts']);
    expect(codexFileChangePaths({ changes: [{ path: 'a.ts' }], path: 'a.ts' })).toEqual(['a.ts']);
  });

  it('경로가 없으면 빈 배열 — 이름 없는 파일 버블을 만들지 않는다', () => {
    expect(codexFileChangePaths({})).toEqual([]);
    expect(codexFileChangePaths({ changes: [{ kind: 'update' }] })).toEqual([]);
  });
});

describe('mapCodexLine — mcp_tool_call / web_search / todo_list / error', () => {
  it('mcp 는 server:tool 로 이름을 만든다', () => {
    const r = mapCodexLine(
      '{"type":"item.started","item":{"id":"m1","type":"mcp_tool_call","server":"github","tool":"search","arguments":{"q":"x"}}}',
    );
    expect(r?.events[0]?.toolName).toBe('github:search');
    expect(r?.events[0]?.eventType).toBe('tool_use');
  });

  it('mcp 완료는 결과를 문자열로 접는다', () => {
    const r = mapCodexLine(
      '{"type":"item.completed","item":{"id":"m1","type":"mcp_tool_call","server":"github","tool":"search","result":{"count":2}}}',
    );
    expect(r?.events[0]?.eventType).toBe('tool_result');
    expect(r?.events[0]?.content).toBe('{"count":2}');
  });

  it('web_search 는 시작 줄만 카드로 세운다', () => {
    expect(
      mapCodexLine('{"type":"item.started","item":{"id":"w1","type":"web_search","query":"codex hooks"}}')?.events,
    ).toEqual([{ eventType: 'tool_use', content: 'codex hooks', toolName: 'WebSearch', toolUseId: 'w1' }]);
    expect(mapCodexLine('{"type":"item.completed","item":{"id":"w1","type":"web_search"}}')?.events).toEqual([]);
  });

  it('todo_list 는 완료 줄 하나만 체크 목록으로 남긴다', () => {
    const r = mapCodexLine(
      '{"type":"item.completed","item":{"id":"t1","type":"todo_list","items":[{"text":"읽기","completed":true},{"text":"고치기","status":"pending"}]}}',
    );
    expect(r?.events).toEqual([{ eventType: 'system', content: '[x] 읽기\n[ ] 고치기' }]);
  });

  it('빈 todo_list 는 아무것도 남기지 않는다', () => {
    expect(mapCodexLine('{"type":"item.completed","item":{"id":"t1","type":"todo_list","items":[]}}')?.events).toEqual([]);
  });

  it('item 안의 error 는 오류 줄이 된다', () => {
    expect(mapCodexLine('{"type":"item.completed","item":{"id":"e1","type":"error","message":"실패"}}')?.events).toEqual([
      { eventType: 'error', content: '실패' },
    ]);
  });
});

/**
 * §5.25 (O) — 엔진이 대화에 내건 그림.
 *
 * 표본은 사용자의 코덱스 기록 1,063건을 훑어 확정한 것이다(2026-09-08). 그 1,063건은 전부
 * `item_completed` 봉투에 `{id, path, type}` 세 칸이었고, **`path` 는 평범한 경로가 아니라
 * `file:///…` URL** 이었다 — 그대로 `fs` 에 넘기면 세 OS 모두에서 "그런 파일 없음"이 된다.
 *
 * 경로가 흩어져 있다는 것도 여기서 못박는다: 프로젝트 폴더 877 · `~/.codex/generated_images` 81 ·
 * `skills` 11 · `visualizations` 9. **폴더 하나로 가둘 수 없다** — 그래서 이 매퍼는 걸러내지 않고,
 * 대신 서버가 "우리 스트림이 적어 둔 것만" 내주는 쪽으로 안전선을 세웠다.
 */
describe('§5.25 (O) ImageView — 엔진이 내건 그림', () => {
  const line = (path: string, id = 'exec-abc'): string =>
    JSON.stringify({ type: 'item.completed', item: { id, type: 'ImageView', path } });

  it('windows `file:///C:/…` 는 앞 슬래시를 떼야 경로가 된다', () => {
    const r = mapCodexLine(line('file:///C:/profile/.codex/generated_images/x/exec-1.png'), 'win32');
    expect(r?.events).toEqual([
      { eventType: 'text', content: 'exec-1.png', imagePath: 'C:/profile/.codex/generated_images/x/exec-1.png' },
    ]);
  });

  it('linux·mac 의 앞 슬래시는 경로의 뿌리라 떼면 안 된다', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const r = mapCodexLine(line('file:///srv/profile/.codex/generated_images/x/exec-1.png'), platform);
      expect(r?.events[0]?.imagePath, platform).toBe('/srv/profile/.codex/generated_images/x/exec-1.png');
    }
  });

  it('windows 에서도 드라이브 문자가 아니면 앞 슬래시를 지킨다', () => {
    // UNC·WSL 경로처럼 `/` 로 시작하는 것을 드라이브로 착각해 자르면 경로가 망가진다.
    const r = mapCodexLine(line('file:///mnt/c/work/a.png'), 'win32');
    expect(r?.events[0]?.imagePath).toBe('/mnt/c/work/a.png');
  });

  it('퍼센트 인코딩을 푼다 — 공백 있는 폴더가 흔하다', () => {
    const r = mapCodexLine(line('file:///C:/My%20Pictures/a%20b.png'), 'win32');
    expect(r?.events[0]?.imagePath).toBe('C:/My Pictures/a b.png');
  });

  it('URL 이 아닌 값이 와도 그대로 쓴다 — 엔진이 표기를 바꾸는 날 빈 값이 되지 않게', () => {
    const r = mapCodexLine(line('/srv/work/a.png'), 'linux');
    expect(r?.events[0]?.imagePath).toBe('/srv/work/a.png');
  });

  it('그림 이름을 본문에 적는다 — 그림을 못 그리는 자리에서도 무엇인지 말한다', () => {
    const r = mapCodexLine(line('file:///C:/x/reference-contact-sheet.png'), 'win32');
    expect(r?.events[0]?.content).toBe('reference-contact-sheet.png');
    expect(r?.events[0]?.eventType).toBe('text');
  });

  it('그릴 수 없는 형식은 이름만 남기고 **그림은 걸지 않는다**', () => {
    // 열지 못할 것을 열 수 있는 척하면 화면에 깨진 그림 자리가 남는다.
    const r = mapCodexLine(line('file:///C:/x/report.pdf'), 'win32');
    expect(r?.events).toEqual([{ eventType: 'text', content: 'report.pdf' }]);
  });

  it('svg 는 일부러 뺀다 — 스크립트를 품을 수 있는 문서다', () => {
    const r = mapCodexLine(line('file:///C:/x/chart.svg'), 'win32');
    expect(r?.events[0]?.imagePath).toBeUndefined();
  });

  it('jpg·jpeg·gif·webp·bmp 도 받는다(실측은 png·jpg 뿐이지만 엔진이 늘리는 쪽을 막지 않는다)', () => {
    for (const ext of ['jpg', 'JPEG', 'gif', 'webp', 'bmp']) {
      const r = mapCodexLine(line(`file:///C:/x/a.${ext}`), 'win32');
      expect(r?.events[0]?.imagePath, ext).toBe(`C:/x/a.${ext}`);
    }
  });

  it('path 가 비었으면 아무 줄도 만들지 않는다', () => {
    expect(mapCodexLine(line(''), 'win32')?.events).toEqual([]);
  });

  it('시작 줄에는 걸지 않는다 — 같은 그림을 두 번 걸지 않게', () => {
    const started = JSON.stringify({
      type: 'item.started', item: { id: 'exec-a', type: 'ImageView', path: 'file:///C:/x/a.png' },
    });
    expect(mapCodexLine(started, 'win32')?.events).toEqual([]);
  });

  it('그림 줄은 도구 카드가 아니다 — toolName·toolUseId 를 싣지 않는다', () => {
    const ev = mapCodexLine(line('file:///C:/x/a.png'), 'win32')?.events[0];
    expect(ev?.toolName).toBeUndefined();
    expect(ev?.toolUseId).toBeUndefined();
  });

  it('그림은 최종 답변이 아니다 — finalText 를 채우지 않는다', () => {
    // 채우면 턴 결과가 파일 이름 한 줄로 덮여 진짜 답이 사라진다.
    expect(mapCodexLine(line('file:///C:/x/a.png'), 'win32')?.finalText).toBeUndefined();
  });
});

describe('§5.25 (O) 경로 도우미', () => {
  it('isCodexImageFile — 질의 문자열·앵커가 붙어도 확장자를 본다', () => {
    expect(isCodexImageFile('C:/x/a.png?v=2')).toBe(true);
    expect(isCodexImageFile('C:/x/a.PNG')).toBe(true);
    expect(isCodexImageFile('C:/x/a')).toBe(false);
    expect(isCodexImageFile('C:/x/a.exe')).toBe(false);
  });

  it('codexImageBasename — 두 구분자를 다 본다(윈도우 경로가 섞여 들어온다)', () => {
    expect(codexImageBasename(String.raw`C:\work\a.png`)).toBe('a.png');
    expect(codexImageBasename('/srv/work/a.png')).toBe('a.png');
    expect(codexImageBasename('a.png')).toBe('a.png');
  });

  it('codexImagePathFromUrl — 빈 값은 빈 값으로', () => {
    expect(codexImagePathFromUrl('', 'win32')).toBe('');
    expect(codexImagePathFromUrl('   ', 'linux')).toBe('');
  });
});
