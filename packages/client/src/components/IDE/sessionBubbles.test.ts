import { describe, it, expect } from 'vitest';
import type { QueuedCommand, SubAgentStreamEvent } from '@vibisual/shared';
import {
  buildSessionBubbles,
  looksLikeFilePath,
  readToolInput,
  resolveSessionPath,
  SESSION_BUBBLE_KEEP,
  type SessionBubbleModel,
} from './sessionBubbles.js';

/**
 * §5.5 #17-50 [버블] — 대화 칸의 도구 호출 → 이 세션만의 버블 모델.
 * 프로젝트 그래프를 보지 않고 스트림 이벤트만으로 짓는다는 것, 그리고 판정이 캔버스와 같은 함수라는 것을 못 박는다.
 */

const S = 'sub-1';
const ROOT = 'C:/work/proj';
let seq = 0;
const ev = (
  ts: number,
  eventType: SubAgentStreamEvent['eventType'],
  extra: Partial<SubAgentStreamEvent> = {},
): SubAgentStreamEvent =>
  ({ id: `e${String(++seq)}`, subAgentId: S, parentAgentId: 'agent-1', timestamp: ts, content: '', eventType, ...extra }) as SubAgentStreamEvent;
const use = (ts: number, toolName: string, input: unknown, extra: Partial<SubAgentStreamEvent> = {}): SubAgentStreamEvent =>
  ev(ts, 'tool_use', { toolName, content: typeof input === 'string' ? input : JSON.stringify(input), ...extra });
const done = (ts: number, toolUseId: string): SubAgentStreamEvent => ev(ts, 'tool_result', { toolUseId, content: 'ok' });
const cmd = (id: string, ts: number): QueuedCommand =>
  ({ id, text: `prompt ${id}`, timestamp: ts, subAgentId: S, status: 'completed', startedAt: ts }) as QueuedCommand;

function build(events: SubAgentStreamEvent[], opts: { root?: string | null; platform?: 'win32' | 'linux' | 'darwin'; commands?: QueuedCommand[] } = {}): SessionBubbleModel {
  return buildSessionBubbles({
    streams: [{ events, commands: opts.commands ?? [] }],
    rootPath: opts.root === undefined ? ROOT : opts.root,
    platform: opts.platform ?? 'win32',
  });
}

describe('§5.5 #17-50 — 파일·폴더', () => {
  it('파일은 직속 폴더 밑 위성이 되고, 프로젝트 안이면 상대 경로·내부 폴더다', () => {
    const m = build([
      use(10, 'Read', { file_path: 'C:\\work\\proj\\src\\a.ts' }),
      use(20, 'Edit', { file_path: 'C:/work/proj/src/b.ts', old_string: 'x', new_string: 'y' }),
      use(30, 'Read', { file_path: 'D:/notes/todo.md' }),
    ]);
    expect(m.folders.map((f) => [f.relPath, f.internal, f.files.map((x) => x.name)])).toEqual([
      ['src', true, ['a.ts', 'b.ts']],
      [null, false, ['todo.md']],
    ]);
    expect(m.fileCount).toBe(3);
    expect(m.readCount).toBe(2);
    expect(m.writeCount).toBe(1);
    expect(m.empty).toBe(false);
  });

  it('방향은 마지막으로 닿은 도구가 정한다(읽고 고치면 쓰기 · 다시 읽으면 읽기) — 횟수는 둘 다 센다', () => {
    const m = build([
      use(10, 'Read', { file_path: `${ROOT}/a.ts` }),
      use(20, 'Write', { file_path: `${ROOT}/a.ts`, content: 'x' }),
    ]);
    const f = m.folders[0]!.files[0]!;
    expect([f.reads, f.writes, f.lastDirection, f.lastTool]).toEqual([1, 1, 'write', 'Write']);
    const again = build([
      use(10, 'Write', { file_path: `${ROOT}/a.ts`, content: 'x' }),
      use(20, 'Read', { file_path: `${ROOT}/a.ts` }),
    ]);
    expect(again.folders[0]!.files[0]!.lastDirection).toBe('read');
    // 폴더는 그 안에서 마지막으로 닿은 파일의 방향이다.
    expect(again.folders[0]!.lastDirection).toBe('read');
  });

  it('루트 바로 밑 파일은 루트 폴더(상대 경로 \'\') 하나로 모인다', () => {
    const m = build([use(10, 'Read', { file_path: `${ROOT}/README.md` })]);
    expect(m.folders).toHaveLength(1);
    expect(m.folders[0]!.relPath).toBe('');
    expect(m.folders[0]!.internal).toBe(true);
  });

  it('루트를 모르면 상대 경로는 버리고(지어내지 않는다) 절대 경로는 외부로 둔다', () => {
    const m = build([
      use(10, 'Read', { file_path: 'src/a.ts' }),
      use(20, 'Read', { file_path: 'C:/work/proj/src/b.ts' }),
    ], { root: null });
    expect(m.fileCount).toBe(1);
    expect(m.folders[0]!.internal).toBe(false);
  });

  it('MultiEdit · NotebookEdit · NotebookRead 도 같은 길이다', () => {
    const m = build([
      use(10, 'MultiEdit', { file_path: `${ROOT}/a.ts`, edits: [] }),
      use(20, 'NotebookEdit', { notebook_path: `${ROOT}/n.ipynb`, new_source: 'x' }),
      use(30, 'NotebookRead', { notebook_path: `${ROOT}/m.ipynb` }),
    ]);
    const files = m.folders[0]!.files;
    expect(files.map((f) => [f.name, f.lastDirection])).toEqual([['a.ts', 'write'], ['n.ipynb', 'write'], ['m.ipynb', 'read']]);
  });
});

describe('§5.5 #17-50 — 셸(캔버스와 같은 추출기)', () => {
  it('셸로 읽은 파일(sed·cat)과 리다이렉트로 쓴 파일이 뜬다 — 상대 경로는 루트에, cd 는 추출기가 잇는다', () => {
    const m = build([
      use(10, 'Bash', { command: "sed -n '1,40p' src/a.ts" }),
      use(20, 'Bash', { command: 'cd packages/client && cat src/b.ts' }),
      use(30, 'Bash', { command: 'echo hi > out/log.txt' }),
    ]);
    const all = m.folders.flatMap((f) => f.files.map((x) => [x.path, x.lastDirection]));
    expect(all).toEqual([
      ['C:/work/proj/src/a.ts', 'read'],
      ['C:/work/proj/packages/client/src/b.ts', 'read'],
      ['C:/work/proj/out/log.txt', 'write'],
    ]);
  });

  it('PowerShell 도구도 같은 판정을 탄다', () => {
    const m = build([use(10, 'PowerShell', { command: 'Get-Content C:\\work\\proj\\src\\a.ts' })]);
    expect(m.folders[0]?.files[0]?.path).toBe('C:/work/proj/src/a.ts');
  });

  it('grep -r 의 폴더는 검색 범위 폴더가 된다(searches 를 센다)', () => {
    const m = build([use(10, 'Bash', { command: 'grep -rn foo packages/server' })]);
    expect(m.folders.map((f) => [f.relPath, f.searches, f.files.length])).toEqual([['packages/server', 1, 0]]);
  });

  it('명령 앱이 버블이 되고 최근 명령을 남긴다(상한)', () => {
    const events = Array.from({ length: SESSION_BUBBLE_KEEP.appCommands + 2 }, (_, i) => use(10 + i, 'Bash', { command: `git log -n ${String(i + 1)}` }));
    const m = build(events);
    expect(m.apps).toHaveLength(1);
    expect(m.apps[0]!.name).toBe('Git');
    expect(m.apps[0]!.commands).toHaveLength(SESSION_BUBBLE_KEEP.appCommands);
    expect(m.apps[0]!.commands[0]).toBe(`git log -n ${String(SESSION_BUBBLE_KEEP.appCommands + 2)}`);
  });

  it('코덱스의 셸 줄(JSON 이 아닌 명령 원문)도 읽는다', () => {
    const m = build([use(10, 'Bash', 'cat src/a.ts')]);
    expect(m.folders[0]?.files[0]?.path).toBe('C:/work/proj/src/a.ts');
  });
});

describe('§5.5 #17-50 — 경로 키는 그 플랫폼 규칙(멀티플랫폼 1축)', () => {
  it('win32: 대소문자·구분자·git bash 드라이브가 달라도 같은 파일이다', () => {
    const m = build([
      use(10, 'Read', { file_path: 'C:\\Work\\Proj\\src\\A.ts' }),
      use(20, 'Bash', { command: 'cat /c/work/proj/src/a.ts' }),
    ], { root: 'c:/work/proj' });
    expect(m.fileCount).toBe(1);
    expect(m.folders[0]!.files[0]!.reads).toBe(2);
    expect(m.folders[0]!.internal).toBe(true);
  });

  it('linux: 대소문자만 다른 두 파일은 둘이고, /c/... 는 드라이브로 바꾸지 않는다', () => {
    const m = build([
      use(10, 'Read', { file_path: '/srv/proj/src/Foo.ts' }),
      use(20, 'Read', { file_path: '/srv/proj/src/foo.ts' }),
      use(30, 'Bash', { command: 'cat /c/x.txt' }),
    ], { root: '/srv/proj', platform: 'linux' });
    expect(m.fileCount).toBe(3);
    const outside = m.folders.find((f) => !f.internal);
    expect(outside?.path).toBe('/c');
  });

  it('darwin: 대소문자는 접지만(APFS 기본) /c/... 는 드라이브로 바꾸지 않는다', () => {
    const m = build([
      use(10, 'Read', { file_path: '/Volumes/Work/Proj/src/A.ts' }),
      use(20, 'Bash', { command: 'cat /volumes/work/proj/src/a.ts' }),
      use(30, 'Bash', { command: 'cat /c/x.txt' }),
    ], { root: '/Volumes/Work/Proj', platform: 'darwin' });
    const inside = m.folders.filter((f) => f.internal);
    expect(inside).toHaveLength(1);
    expect(inside[0]!.files).toHaveLength(1);
    expect(inside[0]!.files[0]!.reads).toBe(2);
    expect(m.folders.find((f) => !f.internal)?.path).toBe('/c');
  });

  it('resolveSessionPath — 홈·변수는 풀지 않는다, .. 는 접는다', () => {
    expect(resolveSessionPath('~/x.ts', ROOT, 'linux')).toBeNull();
    expect(resolveSessionPath('$HOME/x.ts', ROOT, 'linux')).toBeNull();
    expect(resolveSessionPath('%TEMP%\\x.ts', ROOT, 'win32')).toBeNull();
    expect(resolveSessionPath('src/../lib/x.ts', ROOT, 'win32')).toBe('C:/work/proj/lib/x.ts');
  });
});

describe('§5.5 #17-50 — 검색 도구 · 웹 · 서브에이전트', () => {
  it('Grep/Glob/LS 의 경로는 검색 범위 폴더, 경로가 없으면 그 칸의 루트, Grep 의 파일 경로는 파일', () => {
    const m = build([
      use(10, 'Grep', { pattern: 'x', path: `${ROOT}/packages` }),
      use(20, 'Glob', { pattern: '**/*.ts' }),
      use(30, 'Grep', { pattern: 'y', path: `${ROOT}/src/a.ts` }),
      use(40, 'LS', { path: `${ROOT}/docs` }),
    ]);
    expect(m.folders.map((f) => [f.relPath, f.searches, f.files.map((x) => x.name)])).toEqual([
      ['packages', 1, []],
      ['', 1, []],
      ['src', 0, ['a.ts']],
      ['docs', 1, []],
    ]);
  });

  it('WebFetch 는 호스트마다(www 를 뗀다), WebSearch 는 「웹 검색」 하나에 최근 검색어', () => {
    const m = build([
      use(10, 'WebFetch', { url: 'https://www.example.com/a', prompt: 'p' }),
      use(20, 'WebFetch', { url: 'https://example.com/b', prompt: 'p' }),
      use(30, 'WebSearch', { query: 'first' }),
      use(40, 'WebSearch', { query: 'second' }),
      use(50, 'WebSearch', '(web search)'),
    ]);
    expect(m.webs.map((w) => [w.kind, w.host, w.reads])).toEqual([['fetch', 'example.com', 2], ['search', null, 3]]);
    expect(m.webs[0]!.lastUrl).toBe('https://example.com/b');
    expect(m.webs[1]!.queries).toEqual(['second', 'first']);
  });

  it('Task 는 서브에이전트 버블, 그 안에서만 닿은 파일은 서브에이전트 경유 · 직접 닿으면 직접', () => {
    const m = build([
      use(10, 'Task', { description: '조사', subagent_type: 'Explore', prompt: 'p' }, { toolUseId: 'task-1' }),
      use(20, 'Read', { file_path: `${ROOT}/src/a.ts` }, { nestedUnderToolUseId: 'task-1' }),
      use(30, 'Read', { file_path: `${ROOT}/src/b.ts` }, { nestedUnderToolUseId: 'task-1' }),
      use(40, 'Read', { file_path: `${ROOT}/src/b.ts` }),
      done(50, 'task-1'),
    ]);
    expect(m.tasks.map((t) => [t.description, t.agentType, t.done])).toEqual([['조사', 'Explore', true]]);
    const [a, b] = m.folders[0]!.files;
    expect([a!.direct, a!.viaTaskKey]).toEqual([false, m.tasks[0]!.key]);
    expect(b!.direct).toBe(true);
  });
});

describe('§5.5 #17-50 — 도는 호출 · 턴 · 본문 모양', () => {
  it('결과가 아직 안 온 호출만 pending — 짝 id 가 없는 옛 줄은 끝난 것으로 본다', () => {
    const m = build([
      use(10, 'Read', { file_path: `${ROOT}/a.ts` }, { toolUseId: 't1' }),
      done(11, 't1'),
      use(20, 'Read', { file_path: `${ROOT}/b.ts` }, { toolUseId: 't2' }),
      use(30, 'Read', { file_path: `${ROOT}/c.ts` }),
    ]);
    expect(m.folders[0]!.files.map((f) => [f.name, f.pending])).toEqual([['a.ts', false], ['b.ts', true], ['c.ts', false]]);
    expect(m.folders[0]!.pending).toBe(true);
  });

  it('턴은 도장(turnId)이 먼저, 없으면 나간 시각으로 제 턴', () => {
    const m = build([
      use(150, 'Read', { file_path: `${ROOT}/a.ts` }),
      use(250, 'Read', { file_path: `${ROOT}/b.ts` }, { turnId: 'c1' }),
      use(50, 'Read', { file_path: `${ROOT}/early.ts` }),
    ], { commands: [cmd('c1', 100), cmd('c2', 200)] });
    const byName = Object.fromEntries(m.folders[0]!.files.map((f) => [f.name, f.turnId]));
    expect(byName).toEqual({ 'a.ts': 'c1', 'b.ts': 'c1', 'early.ts': null });
  });

  it('코덱스 file_change 줄(경로를 쉼표로 이은 본문)은 고친 파일들이다', () => {
    const m = build([use(10, 'Write', `${ROOT}/a.ts, ${ROOT}/b.ts`), use(20, 'Write', '(file change)')]);
    expect(m.folders[0]!.files.map((f) => [f.name, f.lastDirection])).toEqual([['a.ts', 'write'], ['b.ts', 'write']]);
  });

  it('미리보기 길이에서 잘린 JSON 이라도 끝까지 온 경로 칸은 건진다', () => {
    const full = JSON.stringify({ pattern: 'x'.repeat(10), path: `${ROOT}/src`, output_mode: 'content', glob: 'y'.repeat(400) });
    const cut = full.slice(0, 300);
    expect(() => JSON.parse(cut)).toThrow();
    expect(readToolInput(cut)?.['path']).toBe(`${ROOT}/src`);
    const m = build([use(10, 'Grep', cut)]);
    expect(m.folders[0]?.relPath).toBe('src');
  });

  it('버블을 만들지 않는 도구는 호출 수에만 센다 — 아무것도 없으면 빈 상태', () => {
    const m = build([use(10, 'TodoWrite', { todos: [] }), use(20, 'mcp__x__y', { a: 1 }), ev(30, 'text', { content: 'hi' })]);
    expect(m.toolCalls).toBe(2);
    expect(m.empty).toBe(true);
  });

  it('looksLikeFilePath — 끝 마디 확장자로만 가른다', () => {
    expect(looksLikeFilePath('C:/a/b.ts')).toBe(true);
    expect(looksLikeFilePath('C:/a/b')).toBe(false);
    expect(looksLikeFilePath('/a/.github')).toBe(false);
    expect(looksLikeFilePath('/a/..')).toBe(false);
  });
});

describe('§5.5 #17-50 — 자리 고정 · 해석 캐시', () => {
  it('정렬은 처음 닿은 순서 — 줄이 붙어도 앞의 버블 순서는 그대로', () => {
    const base = [
      use(10, 'Read', { file_path: `${ROOT}/b/x.ts` }),
      use(20, 'Read', { file_path: `${ROOT}/a/y.ts` }),
    ];
    const before = build(base).folders.map((f) => f.key);
    const after = build([...base, use(30, 'Read', { file_path: `${ROOT}/a/y.ts` }), use(40, 'Read', { file_path: `${ROOT}/c/z.ts` })]).folders.map((f) => f.key);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it('같은 이벤트 객체는 다시 해석하지 않지만, 루트가 바뀌면 다시 푼다(상대 경로가 달라진다)', () => {
    const events = [use(10, 'Bash', { command: 'cat src/a.ts' })];
    expect(build(events).folders[0]!.path).toBe('C:/work/proj/src');
    expect(build(events, { root: 'D:/other' }).folders[0]!.path).toBe('D:/other/src');
    expect(build(events).folders[0]!.path).toBe('C:/work/proj/src');
  });

  it('메인 탭처럼 여러 세션을 함께 넘기면 합쳐서 센다(서브에이전트 열쇠는 세션마다 따로)', () => {
    const a = use(10, 'Task', { description: 'A' }, { toolUseId: 'same' });
    const b = { ...use(20, 'Task', { description: 'B' }, { toolUseId: 'same' }), subAgentId: 'sub-2' } as SubAgentStreamEvent;
    const m = buildSessionBubbles({ streams: [{ events: [a], commands: [] }, { events: [b], commands: [] }], rootPath: ROOT, platform: 'win32' });
    expect(m.tasks.map((t) => t.description)).toEqual(['A', 'B']);
  });
});
