import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPathWithin, pathKey, type BubbleData, type HookEventPayload, type PlatformName, type QueuedCommand } from '@vibisual/shared';
import { ProjectGraphManager, pickHookProjectRoot, resolveProjectRootInfo } from './projectGraphManager.js';
import { isCustomSessionKey, ProjectGraph } from './projectGraph.js';

// ⚠ `registerProject` 는 사용자 홈의 `~/.vibisual/app-state.json` 에 열린 프로젝트를 **실제로 기록한다**.
//   테스트가 만든 임시 폴더가 그 목록에 쌓이면 다음 부팅에서 유령 탭을 복원하려 든다 — 쓰기만 막는다.
vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

/**
 * §3.5 — **훅 이벤트는 그 세션의 버블을 가진 프로젝트로 간다.** cwd 는 그 다음이다.
 *
 * 실측(2026-09-30): `.git` 없는 폴더를 프로젝트로 연 사용자의 커스텀 세션이 하위 폴더(`research/…`)
 * 로 `cd` 한 채 재개되자, 라우팅 표가 비어 있던 그 순간 cwd 만 보고 그 하위 폴더에 **새 인스턴스**(유령
 * 탭 + 사용자 폴더 안 `.vibisual/save`)가 섰다. 그 뒤 그 세션의 이벤트가 전부 유령으로 갔고, 유령은 커스텀
 * 키로 **훅 버블**을 찍었으며, 생존 판정이 그 버블을 2초마다 지웠다 — 지울 때마다 **전 프로젝트 공유**
 * 명령 큐·완료 이력이 함께 지워져 입력이 몇 초 안에 사라지고 이력 32건을 잃었다. 명령 접수도 유령의
 * 훅 버블을 보고 "읽기 전용"(403)으로 거절했다. 여섯 시간 동안 1,171 회 돌았다.
 *
 * 이 파일이 못 박는 것:
 *  ① 표식 없는 하위 폴더 cwd 는 열린 프로젝트로 간다(세 OS 판정 표 포함).
 *  ② 커스텀 세션 이벤트는 새 프로젝트를 세우지 않고 주인 버블에 붙는다.
 *  ③ 이미 유령에 고정된 라우팅도 다음 이벤트·조회에서 주인으로 풀린다.
 *  ④ 같은 세션 키를 다른 인스턴스가 쥐고 있으면 공유 큐·이력을 지우지 않는다.
 *  ⑤ 커스텀 합성 키로는 훅 버블을 찍지 않고 생존 판정에도 넣지 않는다.
 */

const tmpDirs: string[] = [];

function makeProjectDir(tag: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `vibi-hookroute-${tag}-`)));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 정리 실패는 테스트와 무관 */ }
  }
});

function bashEvent(sessionId: string, cwd: string, extra: Partial<HookEventPayload> = {}): HookEventPayload {
  return {
    session_id: sessionId,
    hook_event_name: 'PreToolUse',
    cwd,
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
    ...extra,
  };
}

type ManagerInternals = {
  instances: Map<string, ProjectGraph>;
  sessionRouting: Map<string, string>;
};

function internals(manager: ProjectGraphManager): ManagerInternals {
  return manager as unknown as ManagerInternals;
}

function queued(id: string, sessionId: string): QueuedCommand {
  return { id, sessionId, text: 'keep me', queuedAt: 1, status: 'queued', subAgentId: null } as unknown as QueuedCommand;
}

describe('§3.5 pickHookProjectRoot — 훅 cwd 를 붙일 루트(세 OS 판정 표)', () => {
  const on = (platform: PlatformName) => ({
    within: (c: string, r: string) => isPathWithin(c, r, platform),
    keyOf: (p: string) => pathKey(p, platform),
  });

  it.each(['win32', 'darwin', 'linux'] as const)('표식 없는 하위 폴더는 그 폴더를 품은 열린 프로젝트로 간다 (%s)', (platform) => {
    const { within, keyOf } = on(platform);
    const base = platform === 'win32' ? 'D:\\work\\proj' : '/srv/work/proj';
    const sep = platform === 'win32' ? '\\' : '/';
    const cwd = `${base}${sep}research${sep}notes`;
    expect(pickHookProjectRoot({ root: cwd, via: 'none' }, cwd, [base], within, keyOf)).toBe(base);
  });

  it('열린 프로젝트가 cwd 를 품지 않으면 종전 그대로(표식 루트·cwd)', () => {
    const { within, keyOf } = on('win32');
    expect(pickHookProjectRoot({ root: 'D:\\else\\x', via: 'none' }, 'D:\\else\\x', ['C:\\p'], within, keyOf)).toBe('D:\\else\\x');
    expect(pickHookProjectRoot({ root: 'D:\\else', via: 'marker' }, 'D:\\else\\x', [], within, keyOf)).toBe('D:\\else');
  });

  it('이름 앞부분만 같은 형제 폴더(`p` vs `p2`)는 품은 것으로 치지 않는다', () => {
    const { within, keyOf } = on('linux');
    expect(pickHookProjectRoot({ root: '/w/p2/x', via: 'none' }, '/w/p2/x', ['/w/p'], within, keyOf)).toBe('/w/p2/x');
  });

  it('여러 열린 프로젝트가 품으면 가장 깊은 쪽이 이긴다', () => {
    const { within, keyOf } = on('linux');
    expect(pickHookProjectRoot({ root: '/a/b/c', via: 'none' }, '/a/b/c', ['/a', '/a/b'], within, keyOf)).toBe('/a/b');
  });

  it('대소문자: win·mac 은 접어서 품고, linux 는 케이스가 다르면 다른 폴더다', () => {
    const win = on('win32');
    expect(pickHookProjectRoot({ root: 'C:\\P\\sub', via: 'none' }, 'C:\\P\\sub', ['c:\\p'], win.within, win.keyOf)).toBe('c:\\p');
    const mac = on('darwin');
    expect(pickHookProjectRoot({ root: '/Volumes/Data/P/sub', via: 'none' }, '/Volumes/Data/P/sub', ['/volumes/data/p'], mac.within, mac.keyOf)).toBe('/volumes/data/p');
    const linux = on('linux');
    expect(pickHookProjectRoot({ root: '/srv/work/P/sub', via: 'none' }, '/srv/work/P/sub', ['/srv/work/p'], linux.within, linux.keyOf)).toBe('/srv/work/P/sub');
  });

  it('표식 루트가 곧 열린 프로젝트면 그대로 쓴다', () => {
    const { within, keyOf } = on('linux');
    expect(pickHookProjectRoot({ root: '/repo', via: 'marker' }, '/repo/packages/app/src', ['/repo', '/repo/packages/app'], within, keyOf)).toBe('/repo');
  });

  it('모노레포 하위 패키지를 프로젝트로 연 경우 — 위쪽 표식 루트가 아니라 연 패키지로 간다', () => {
    const { within, keyOf } = on('linux');
    expect(pickHookProjectRoot({ root: '/repo', via: 'marker' }, '/repo/packages/app/src', ['/repo/packages/app'], within, keyOf)).toBe('/repo/packages/app');
  });

  it('열린 프로젝트 안의 독립 저장소·워크트리는 종전대로 자기 표식 루트(자기 탭 동작 유지)', () => {
    const { within, keyOf } = on('linux');
    expect(pickHookProjectRoot({ root: '/p/vendor/lib', via: 'marker' }, '/p/vendor/lib/src', ['/p'], within, keyOf)).toBe('/p/vendor/lib');
    expect(pickHookProjectRoot({ root: '/p/repo', via: 'worktree' }, '/p/repo/.claude/worktrees/x', ['/p'], within, keyOf)).toBe('/p/repo');
  });
});

describe('§3.5 훅 라우팅 — 세션 주인 우선 · 하위 폴더 승격', () => {
  it('커스텀 세션이 표식 없는 하위 폴더에서 훅을 쏴도 새 프로젝트를 세우지 않고 주인 버블에 붙는다', () => {
    const root = makeProjectDir('owner');
    expect(resolveProjectRootInfo(root).via).toBe('none'); // 전제 — 임시 폴더 위에 표식이 없다
    const sub = path.join(root, 'research', 'notes');
    fs.mkdirSync(sub, { recursive: true });

    const manager = new ProjectGraphManager();
    const info = manager.registerProject(root);
    const agent = manager.createCustomAgent('Claude Agent 2', undefined, info.name);
    expect(agent).not.toBeNull();
    const key = agent!.path;
    expect(isCustomSessionKey(key)).toBe(true);

    // 라우트가 소유자 태그로 session_id 를 커스텀 키로 바꿔 쓴 뒤의 모양 그대로.
    const before = agent!.activity;
    manager.processHookEvent(bashEvent(key, sub, { _vibisualOwnerAgentId: agent!.id }));
    manager.processHookEvent(bashEvent(key, root, { _vibisualOwnerAgentId: agent!.id }));

    expect(internals(manager).instances.size).toBe(1);
    expect(manager.getProjectNames()).toEqual([info.name]);
    // 버려진 게 아니라 **주인에게 도착했다** — 표가 주인 인스턴스를 가리키고 버블이 두 번 움직였다.
    expect(internals(manager).sessionRouting.get(key)).toBe(pathKey(info.path, process.platform));
    expect(manager.getAgentBySession(key)!.activity).toBe(before + 2);
    // 조회(명령 접수·실행이 쓰는 것)가 주인의 **커스텀** 버블을 돌려준다 — 훅 버블 사본이 아니다.
    expect(manager.getAgentBySession(key)?.customCreated).toBe(true);
    expect(manager.findAgentIdBySession(key)).toBe(agent!.id);
    // 커스텀 키는 생존 판정 대상이 아니다(세션 파일이 없어 늘 "죽은 것"으로 나온다).
    expect(manager.getSessionIds()).not.toContain(key);
  });

  it('소유자 태그가 빠진 커스텀 키 이벤트(로컬 훅 문 등)도 하위 폴더에 프로젝트를 세우지 않고 주인에게 간다', () => {
    const root = makeProjectDir('notag');
    const sub = path.join(root, 'research', 'cache', 'tools');
    fs.mkdirSync(sub, { recursive: true });

    const manager = new ProjectGraphManager();
    // 다른 프로젝트가 **먼저** 열려 있어도(인스턴스 순회 순서와 무관하게) 주인을 찾는다.
    manager.registerProject(makeProjectDir('other'));
    const info = manager.registerProject(root);
    const agent = manager.createCustomAgent('Claude Agent 2', undefined, info.name)!;

    manager.processHookEvent(bashEvent(agent.path, sub));
    expect(internals(manager).instances.size).toBe(2);
    expect(internals(manager).sessionRouting.get(agent.path)).toBe(pathKey(info.path, process.platform));
    expect(manager.getAgentBySession(agent.path)?.customCreated).toBe(true);
  });

  it('외부 훅 세션이 표식 없는 하위 폴더에서 시작해도 열린 프로젝트로 붙는다(SessionStart 문 포함)', () => {
    const root = makeProjectDir('hook');
    const sub = path.join(root, 'docs', 'drafts');
    fs.mkdirSync(sub, { recursive: true });

    const manager = new ProjectGraphManager();
    const info = manager.registerProject(root);

    const viaStart = manager.registerProjectForHookCwd(sub);
    expect(viaStart.path).toBe(info.path);

    const sessionId = '11111111-2222-4333-8444-555555555555';
    manager.processHookEvent(bashEvent(sessionId, sub));
    expect(internals(manager).instances.size).toBe(1);
    expect(manager.getAgentBySession(sessionId)).not.toBeNull();
  });

  it('열린 프로젝트 안이라도 자기 `.git` 을 가진 저장소는 종전대로 따로 선다', () => {
    const root = makeProjectDir('nested');
    const nested = path.join(root, 'vendor', 'lib');
    fs.mkdirSync(path.join(nested, '.git'), { recursive: true });

    const manager = new ProjectGraphManager();
    manager.registerProject(root);
    manager.processHookEvent(bashEvent('aaaaaaaa-2222-4333-8444-555555555555', nested));
    expect(internals(manager).instances.size).toBe(2);
  });

  it('이미 유령 인스턴스에 고정된 라우팅은 조회에서도, 다음 이벤트에서도 주인으로 풀린다', () => {
    const root = makeProjectDir('heal');
    const sub = path.join(root, 'research', 'notes');
    fs.mkdirSync(sub, { recursive: true });

    const manager = new ProjectGraphManager();
    const info = manager.registerProject(root);
    // 과거 판본이 남긴 유령 — 하위 폴더에 선 인스턴스(재기동 뒤에도 열린 탭으로 복원된다).
    const ghost = manager.registerProject(sub);
    expect(internals(manager).instances.size).toBe(2);
    const agent = manager.createCustomAgent('Claude Agent 2', undefined, info.name)!;
    const key = agent.path;

    // 옛 판본이 해 둔 고정: 이 세션 → 유령 인스턴스.
    const ghostKey = pathKey(ghost.path, process.platform);
    expect(internals(manager).instances.has(ghostKey)).toBe(true);
    internals(manager).sessionRouting.set(key, ghostKey);

    // 조회는 표만 믿고 null(명령 접수 404 · 실행 정지)을 돌려주지 않는다.
    expect(manager.getAgentBySession(key)?.customCreated).toBe(true);
    expect(manager.getAgentCwd(key)).not.toBeNull();

    // 다음 훅 이벤트가 표를 주인 쪽으로 고치고, 유령에는 한 줄도 남기지 않는다.
    manager.processHookEvent(bashEvent(key, sub, { _vibisualOwnerAgentId: agent.id }));
    expect(internals(manager).sessionRouting.get(key)).not.toBe(ghostKey);
    expect(internals(manager).instances.get(ghostKey)!.getAgentBySession(key)).toBeNull();
    expect(manager.getAgentBySession(key)?.customCreated).toBe(true);
  });

  it('우리가 띄운 세션(소유자 태그)은 모르는 폴더에 새 프로젝트를 세우지 않는다', () => {
    const root = makeProjectDir('open');
    const stray = makeProjectDir('stray');
    const manager = new ProjectGraphManager();
    manager.registerProject(root);

    const result = manager.processHookEvent(bashEvent('bbbbbbbb-2222-4333-8444-555555555555', stray, { _vibisualOwnerAgentId: 'agent-missing' }));
    expect(result).toBeNull();
    expect(internals(manager).instances.size).toBe(1);
  });
});

describe('§3.5 공유 명령 맵 — 남의 큐·이력을 지우지 않는다', () => {
  it('같은 세션 키를 다른 인스턴스가 쥐고 있으면 제거가 큐·완료 이력·pop 메타를 남긴다', () => {
    const a = makeProjectDir('share-a');
    const b = makeProjectDir('share-b');
    const manager = new ProjectGraphManager();
    const queues = new Map<string, QueuedCommand[]>();
    const archive = new Map<string, QueuedCommand[]>();
    const popped = new Map<string, { text: string; queuedAt: number; poppedAt: number }[]>();
    manager.setCommandQueuesRef(queues);
    manager.setCompletedCommandArchiveRef(archive);
    manager.setPoppedCommandsRef(popped);
    manager.registerProject(a);
    manager.registerProject(b);

    const sessionId = 'cccccccc-2222-4333-8444-555555555555';
    manager.processHookEvent(bashEvent(sessionId, a));
    const [instA, instB] = [...internals(manager).instances.values()];
    // 같은 키의 사본이 B 에도 생긴 상태(옛 판본의 유령이 만들던 모양).
    instB!.processHookEvent(bashEvent(sessionId, b));
    expect(instA!.getAgentBySession(sessionId)).not.toBeNull();
    expect(instB!.getAgentBySession(sessionId)).not.toBeNull();

    queues.set(sessionId, [queued('cmd-1', sessionId)]);
    archive.set(sessionId, [queued('cmd-0', sessionId)]);
    popped.set(sessionId, [{ text: 'x', queuedAt: 1, poppedAt: 2 }]);

    // B 의 사본을 생존 판정이 치운다 — A 가 아직 쥐고 있으니 공유 줄은 남아야 한다.
    expect(instB!.removeAgentBySession(sessionId)).toBe(true);
    expect(queues.get(sessionId)).toHaveLength(1);
    expect(archive.get(sessionId)).toHaveLength(1);
    expect(popped.get(sessionId)).toHaveLength(1);

    // 마지막 주인이 치우면 종전대로 함께 지운다(좀비 큐 방지).
    expect(instA!.removeAgentBySession(sessionId)).toBe(true);
    expect(queues.has(sessionId)).toBe(false);
    expect(archive.has(sessionId)).toBe(false);
    expect(popped.has(sessionId)).toBe(false);
  });
});

describe('§3.5 커스텀 합성 키 — 훅 버블로 찍지 않는다', () => {
  it('주인이 다른 인스턴스에 있는 커스텀 키 이벤트는 그래프에 흔적을 남기지 않는다', () => {
    const dir = makeProjectDir('foreign');
    const graph = new ProjectGraph();
    graph.registerProject(dir);
    const key = 'custom-test0000-2-abcd';
    // 매니저가 주는 답 — 이 키의 커스텀 버블은 다른 프로젝트에 산다.
    graph.setSessionHeldElsewhere((sid) => sid === key);

    expect(graph.processHookEvent(bashEvent(key, dir))).toBeNull();
    expect(graph.getAgentBySession(key)).toBeNull();
    expect(graph.getSessionIds()).not.toContain(key);
  });

  it('매니저를 거쳐도 — 하위 폴더에 따로 열린 프로젝트가 커스텀 키 사본을 찍지 않는다', () => {
    const root = makeProjectDir('foreign-mgr');
    const sub = path.join(root, 'research', 'notes');
    fs.mkdirSync(sub, { recursive: true });
    const manager = new ProjectGraphManager();
    const info = manager.registerProject(root);
    const ghost = manager.registerProject(sub);
    const agent = manager.createCustomAgent('Claude Agent 2', undefined, info.name)!;
    const ghostInst = internals(manager).instances.get(pathKey(ghost.path, process.platform))!;

    // 라우팅을 건너뛰고 유령 인스턴스에 직접 넣어도(옛 판본이 고정해 둔 길) 사본이 서지 않는다.
    expect(ghostInst.processHookEvent(bashEvent(agent.path, sub))).toBeNull();
    expect(ghostInst.getAgentBySession(agent.path)).toBeNull();
  });

  it('옛 판본이 저장해 둔 사본(커스텀 키의 훅 버블)이 복원돼도 생존 판정 목록에 넣지 않는다', () => {
    const dir = makeProjectDir('restored');
    const graph = new ProjectGraph();
    graph.registerProject(dir);
    const key = 'custom-test0000-2-abcd';
    // 저장본에서 되살아난 모양 — customCreated 가 없는 훅 버블이 커스텀 키를 달고 있다.
    (graph as unknown as { agents: Map<string, BubbleData> }).agents.set(key, {
      id: 'agent-1', label: 'research', bubbleType: 'agent', path: key, status: 'idle', activity: 0, lastActivity: 0,
    });
    // 이 키는 세션 파일이 없어 판정에 넣으면 늘 "죽은 것"이 되고, 그 제거가 공유 큐를 쓸던 고리였다.
    expect(graph.getSessionIds()).not.toContain(key);
  });
});
