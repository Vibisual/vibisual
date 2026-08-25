/**
 * §5.19 (H) 로컬 세션의 도구 호출이 **훅 경로에 실제로 닿는가.**
 *
 * 2026-08-21 대조: All Model 세션은 파일을 읽고 고치고 명령을 돌려도 캔버스에 자국을 하나도
 * 안 남겼다 — 파일 노드도, 감사 원장도, Bash 이력도, 띄운 서버의 프리뷰도 클로드 세션에만
 * 있었다. 통로를 이으면서 우리가 **직접 페이로드를 짓게** 됐는데, 지어낸 모양이 그래프가 기대하는
 * 모양과 한 칸이라도 어긋나면 **아무 오류 없이 조용히 아무 일도 안 일어난다**. 그게 이 시험이
 * 막는 사고다.
 *
 * 그래서 여기서는 러너가 아니라 **방출기가 만드는 그 페이로드 모양 그대로**를 그래프에 넣고,
 * 캔버스·원장·이력·포트가 실제로 채워지는지 본다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HookEventPayload } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { toLocalHookPayload } from './localHookPayload.js';
import type { LocalHookToolEvent } from './localRunner.js';

let tmpRoot: string;
const SESSION = 'custom-local-1';

beforeEach(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-localhook-')));
});
afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

/**
 * `index.ts` 의 방출기가 쓰는 **바로 그 변환**. 종전에는 여기에 같은 모양을 베껴 뒀는데,
 * 사본이 어긋나는 순간 시험은 통과하고 화면만 비었다(2026-08-24 실측: 원장엔 16줄, 파일 노드는
 * 0개). 그래서 베끼지 않고 같은 함수를 부른다 — 이 줄이 이 파일의 거짓 안심을 막는다.
 */
function toPayload(session: string, event: LocalHookToolEvent): HookEventPayload {
  return toLocalHookPayload(session, event);
}

/** 로컬 러너가 도구 한 건을 돌 때 내는 두 이벤트를 그대로 흘려보낸다. */
function runTool(
  graph: ProjectGraph,
  toolName: string,
  toolInput: Record<string, unknown>,
  response: string,
  toolUseId = `call-${toolName}-${String(Date.now())}`,
): void {
  const base = { toolName, toolInput, toolUseId, cwd: tmpRoot };
  graph.processHookEvent(toPayload(SESSION, { phase: 'pre', ...base }));
  graph.processHookEvent(toPayload(SESSION, { phase: 'post', ...base, toolResponse: response, durationMs: 12 }));
}

/**
 * 캔버스에 선 노드 전부. **루트 바로 아래 파일은 `topFolders` 에, 하위 폴더의 파일은
 * `children` 에** 앉으므로 둘을 합쳐 봐야 "그려졌는가"에 답할 수 있다.
 */
function allNodes(graph: ProjectGraph): ReturnType<ProjectGraph['getSnapshot']>['topFolders'] {
  const snap = graph.getSnapshot();
  return [...snap.topFolders, ...Object.values(snap.children).flat()];
}

function makeGraph(): ProjectGraph {
  const graph = new ProjectGraph();
  graph.registerProject(tmpRoot);
  return graph;
}

describe('로컬 도구가 캔버스에 자국을 남긴다', () => {
  it('파일을 고치면 그 파일이 노드로 선다 — 이 앱의 간판 기능이 로컬에서만 죽어 있었다', () => {
    const graph = makeGraph();
    const abs = path.join(tmpRoot, 'src', 'a.ts');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'after\n', 'utf8');

    // **로컬 도구가 실제로 보내는 모양** — 인자 이름은 `path` 이고 값은 루트 상대다
    //   (`LOCAL_TOOL_DEFS`: "File path, relative to the project root"). 절대·`file_path` 로
    //   시험하면 그래프는 통과하지만 진짜 세션은 계속 비어 있다 — 그게 2026-08-24 의 사고다.
    runTool(graph, 'Edit', { path: 'src/a.ts', old_string: 'before', new_string: 'after' }, 'edited src/a.ts');

    // 파일 노드는 폴더 아래 자식으로 선다(캔버스가 그리는 그 구조 그대로).
    const node = allNodes(graph).find((n) => n.label === 'a.ts');
    expect(node?.bubbleType).toBe('file');
    // 편집 기록도 그 노드에 붙어야 "누가 언제 무엇을 고쳤나"를 답할 수 있다.
    expect(Object.keys(graph.getSnapshot().fileEdits)).toContain(node?.id ?? '');
  });

  it('버블도 함께 선다 — 노드만 있고 주인이 없으면 누가 만졌는지 알 수 없다', () => {
    const graph = makeGraph();
    const abs = path.join(tmpRoot, 'b.ts');
    fs.writeFileSync(abs, 'x\n', 'utf8');
    runTool(graph, 'Write', { path: 'b.ts', content: 'x' }, 'wrote b.ts');

    const snap = graph.getSnapshot();
    expect(snap.agents.length).toBeGreaterThan(0);
    // 파일 노드가 그 버블을 가리켜야 캔버스에서 선이 이어진다.
    const node = allNodes(graph).find((n) => n.label === 'b.ts');
    expect(node?.activeAgentIds?.length ?? 0).toBeGreaterThan(0);
  });

  it('읽기만 해도 노드가 선다 — 사용자가 본 화면은 Glob→Read→Edit 였다', () => {
    const graph = makeGraph();
    fs.writeFileSync(path.join(tmpRoot, 'test.txt'), '안녕하세요\n', 'utf8');
    runTool(graph, 'Read', { path: 'test.txt' }, '1\t안녕하세요');

    const node = allNodes(graph).find((n) => n.label === 'test.txt');
    expect(node?.bubbleType).toBe('file');
  });

  it('클로드식 인자(`file_path` 절대)로 와도 그대로 선다 — 모델이 그 이름을 쓸 때가 있다', () => {
    const graph = makeGraph();
    const abs = path.join(tmpRoot, 'c.ts');
    fs.writeFileSync(abs, 'y\n', 'utf8');
    runTool(graph, 'Write', { file_path: abs, content: 'y' }, 'wrote c.ts');

    expect(allNodes(graph).find((n) => n.label === 'c.ts')?.bubbleType).toBe('file');
  });
});

/**
 * 이름을 옮기는 그 한 칸을 따로 못 박는다. 노드가 서는지는 위에서 보고, 여기서는 **무엇을 넘겼나**
 * 를 본다 — 상대 경로를 그대로 넘기면 `recordFileEdit` 가 서버 프로세스의 cwd 를 기준으로
 * 엉뚱한 자리를 읽어 `Write` diff 가 조용히 빈다(노드는 서므로 화면만 봐서는 안 드러난다).
 */
describe('페이로드 변환 — 로컬 인자 이름을 그래프가 읽는 이름으로', () => {
  it('`path`(상대)를 절대 `file_path` 로 올려서 넘긴다', () => {
    const payload = toLocalHookPayload(SESSION, {
      phase: 'pre', toolName: 'Edit', toolInput: { path: 'src/a.ts', old_string: 'a', new_string: 'b' },
      toolUseId: 'call-1', cwd: tmpRoot,
    });
    expect(payload.tool_input?.['file_path']).toBe(path.resolve(tmpRoot, 'src/a.ts'));
    // 원래 인자는 지우지 않는다 — 스트림의 도구 카드가 짧은 상대 경로를 계속 쓴다.
    expect(payload.tool_input?.['path']).toBe('src/a.ts');
  });

  it('파일 도구가 아니면 손대지 않는다 — Glob/Grep 의 `path` 는 그래프에서 디렉터리다', () => {
    const payload = toLocalHookPayload(SESSION, {
      phase: 'pre', toolName: 'Glob', toolInput: { pattern: '**/test.txt' }, toolUseId: 'call-2', cwd: tmpRoot,
    });
    expect(payload.tool_input?.['file_path']).toBeUndefined();
  });

  it('Bash 는 종전 그대로 — 인자를 한 칸도 바꾸지 않는다', () => {
    const input = { command: 'echo hi' };
    const payload = toLocalHookPayload(SESSION, {
      phase: 'pre', toolName: 'Bash', toolInput: input, toolUseId: 'call-3', cwd: tmpRoot,
    });
    expect(payload.tool_input).toBe(input);
  });
});

describe('로컬 도구가 감사 원장에 남는다', () => {
  it('실행한 도구가 원장 한 줄이 된다 — 종전에는 아무 기록도 없었다', () => {
    const graph = makeGraph();
    runTool(graph, 'Bash', { command: 'echo hi' }, 'hi');

    const entries = graph.getSnapshot().auditLogs?.flatMap((l) => l.entries) ?? [];
    expect(entries.some((e) => e.toolName === 'Bash')).toBe(true);
  });

  it('바깥으로 나가는 도구도 남는다 — 로컬 모델에 새로 준 힘이라 더 그렇다', () => {
    const graph = makeGraph();
    runTool(graph, 'WebFetch', { url: 'https://example.com' }, 'Example Domain');

    const entries = graph.getSnapshot().auditLogs?.flatMap((l) => l.entries) ?? [];
    expect(entries.some((e) => e.toolName === 'WebFetch')).toBe(true);
  });
});

describe('Bash 출력이 이력에 붙는다 — tool_response 모양이 어긋나면 조용히 빈칸이 된다', () => {
  it('사전 이벤트가 엔트리를 만들고 사후 이벤트가 출력을 채운다', () => {
    const graph = makeGraph();
    runTool(graph, 'Bash', { command: 'echo hello' }, 'hello world', 'call-bash-1');

    const history = Object.values(graph.getSnapshot().bashHistory ?? {}).flat();
    const entry = history.find((e) => e.id === 'call-bash-1');
    expect(entry?.command).toBe('echo hello');
    // `content` 배열이 아닌 모양으로 보내면 여기가 빈 문자열이 된다 — 그게 이 줄의 존재 이유다.
    expect(entry?.output).toContain('hello world');
  });

  it('사전만 오고 사후가 안 오면 명령은 남되 출력은 비어 있다(중지·거절 경로)', () => {
    const graph = makeGraph();
    graph.processHookEvent(toPayload(SESSION, {
      phase: 'pre', toolName: 'Bash', toolInput: { command: 'sleep 100' }, toolUseId: 'call-bash-2', cwd: tmpRoot,
    }));
    const history = Object.values(graph.getSnapshot().bashHistory ?? {}).flat();
    expect(history.find((e) => e.id === 'call-bash-2')?.command).toBe('sleep 100');
  });
});

describe('경계 — 도구 이벤트만 간다', () => {
  it('도구가 없는 이벤트는 그래프가 아무것도 하지 않는다(생명주기를 우리가 안 보내는 이유)', () => {
    const graph = makeGraph();
    // 러너는 이런 것을 보내지 않지만, 실수로 새면 무슨 일이 나는지 여기 고정해 둔다.
    expect(graph.processHookEvent({ session_id: SESSION, hook_event_name: 'Stop' })).toBeNull();
  });

  it('같은 tool_use_id 를 두 번 돌려도 Bash 이력이 두 줄로 늘지 않는다', () => {
    const graph = makeGraph();
    runTool(graph, 'Bash', { command: 'ls' }, 'a b', 'call-dup');
    const before = Object.values(graph.getSnapshot().bashHistory ?? {}).flat().length;
    graph.processHookEvent(toPayload(SESSION, {
      phase: 'post', toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 'call-dup',
      cwd: tmpRoot, toolResponse: 'a b',
    }));
    expect(Object.values(graph.getSnapshot().bashHistory ?? {}).flat().length).toBe(before);
  });
});
