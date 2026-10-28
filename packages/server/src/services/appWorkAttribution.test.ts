/**
 * §5.1 #2-1 (F) — 앱과 연결해 한 일의 파일에 `appWork` 꼬리표가 붙는가. 가짜 입력이 아니라 실제 모양(앱 작업이 쓴 `artifacts/vibi3d-korean-corner/` 파일,
 * 노드는 `ref` 만, 본문에 노드 id 가 든 명령, 다른 에이전트와 나눠 쓰는 `artifacts` 폴더)을 픽스처로 쓴다 — 그 모양에서 하나도 안 묶이던 것을 재현한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BubbleData, HookEventPayload, QueuedCommand, SubAgent } from '@vibisual/shared';
import { APP_WORK } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { subAgentManager } from './subAgentManager.js';
import { toLocalHookPayload } from './localHookPayload.js';

let root: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-appwork-')));
});

afterEach(() => {
  vi.restoreAllMocks();
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
});

const WORK_DIR = ['artifacts', 'vibi3d-korean-corner'];
/** 사진 속 실제 작업 파일(이름 그대로). */
const WORK_FILES = ['scene-work.mjs', 'generate-materials.mjs', 'palette.mjs', 'continuation.md', 'final-captures.json'];

function writeFile(rel: string[], body = 'x'): string {
  const abs = path.join(root, ...rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
}

/**
 * `linked: false` = 앱 노드가 에이전트를 잇지 않은 캔버스. 이어진 동안엔 앱 노드 없는 명령도 꼬리표가 붙으므로(§5.1 #2-1 (F) ①)
 * 명령만으로 귀속·기능 이전 캔버스 시험은 잇지 않고 쓴다.
 */
function setup(opts: { linked?: boolean } = {}): {
  graph: ProjectGraph;
  projectName: string;
  queues: Map<string, QueuedCommand[]>;
  archive: Map<string, QueuedCommand[]>;
  agent: BubbleData;
  sessionKey: string;
  appId: string;
} {
  const graph = new ProjectGraph();
  const queues = new Map<string, QueuedCommand[]>();
  const archive = new Map<string, QueuedCommand[]>();
  graph.setCommandQueuesRef(queues);
  graph.setCompletedCommandArchiveRef(archive);
  const projectName = graph.registerProject(root).name;
  const agent = graph.createCustomAgent('Vibi3D builder', undefined, projectName);
  const sessionKey = graph.findSessionByAgentId(agent.id)!;
  const linkedAgentIds = opts.linked === false ? [] : [agent.id];
  const app = graph.createAppBubble({ projectName, appId: 'vibi3d', x: 0, y: 0, ref: 'source-048d9c', linkedAgentIds });
  return { graph, projectName, queues, archive, agent, sessionKey, appId: app.id };
}

function mockSubs(...subs: Array<{ id: string; parentAgentId: string; sessionId: string }>): void {
  vi.spyOn(subAgentManager, 'getAllSubsFlat').mockReturnValue(
    subs.map((s) => ({ ...s, label: s.id, lastActivityAt: 1 }) as unknown as SubAgent),
  );
}

function hook(sessionId: string, tool: string, input: Record<string, unknown>, phase: 'PreToolUse' | 'PostToolUse' = 'PostToolUse'): HookEventPayload {
  return { session_id: sessionId, hook_event_name: phase, tool_name: tool, tool_input: input, cwd: root } as HookEventPayload;
}

/** 라벨로 노드를 찾는다 — 윈도·맥은 경로 키를 접으므로(`normalize`) 라벨도 접혀 있을 수 있다(대소문자 무시로 찾는다). */
function nodeByLabel(graph: ProjectGraph, projectName: string, label: string): BubbleData | undefined {
  const cp = graph.toProjectCheckpoint(projectName);
  const want = label.toLowerCase();
  return Object.values(cp.graph.nodes).find((n) => n.label.toLowerCase() === want);
}

function command(id: string, subId: string, extra: Partial<QueuedCommand> = {}): QueuedCommand {
  return { id, text: 'work', timestamp: 1_000, startedAt: 1_000, subAgentId: subId, status: 'executing', ...extra } as QueuedCommand;
}

describe('§5.1 #2-1 (F) ① — 실시간 귀속', () => {
  it('도는 명령의 앱 노드가 그 명령 중 쓴 파일에 붙는다(확장자 무관) · 읽기만 한 파일에는 안 붙는다', () => {
    const { graph, projectName, queues, agent, sessionKey, appId } = setup();
    mockSubs({ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' });
    queues.set(sessionKey, [command('cmd-1', 'sub-a', { appNodeIds: [appId] })]);
    for (const name of [...WORK_FILES, 'Makefile', 'odd.qqq']) {
      const abs = writeFile([...WORK_DIR, name]);
      graph.processHookEvent(hook('cli-a', 'Write', { file_path: abs }));
    }
    const readOnly = writeFile(['docs', 'reference.md']);
    graph.processHookEvent(hook('cli-a', 'Read', { file_path: readOnly }));

    for (const name of [...WORK_FILES, 'Makefile', 'odd.qqq']) {
      expect(nodeByLabel(graph, projectName, name)?.appWork?.[appId]).toMatchObject({ w: 1 });
    }
    expect(nodeByLabel(graph, projectName, 'reference.md')?.appWork).toBeUndefined();
  });

  it('옛 명령(appNodeIds 없음)은 본문의 노드 id 를 읽는다 · 없는 노드는 버린다', () => {
    const { graph, projectName, queues, agent, sessionKey, appId } = setup();
    mockSubs({ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' });
    queues.set(sessionKey, [command('cmd-1', 'sub-a', { text: `작업 완성 시켜\n--- Linked canvas nodes ---\n${appId}\napp-gone-00000` })]);
    const abs = writeFile([...WORK_DIR, 'scene-work.mjs']);
    graph.processHookEvent(hook('cli-a', 'Edit', { file_path: abs, old_string: 'x', new_string: 'y' }));
    const marks = nodeByLabel(graph, projectName, 'scene-work.mjs')?.appWork ?? {};
    expect(Object.keys(marks)).toEqual([appId]);
  });

  it('같은 세션의 마지막 앱 명령이 IDE 에서 이어 보낸 명령의 귀속이 된다', () => {
    const { graph, projectName, queues, archive, agent, sessionKey, appId } = setup();
    mockSubs({ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' });
    archive.set(sessionKey, [command('cmd-0', 'sub-a', { status: 'completed', appNodeIds: [appId] })]);
    queues.set(sessionKey, [command('cmd-1', 'sub-a', { text: '창문 더 크게' })]);
    const abs = writeFile([...WORK_DIR, 'upgrade.mjs']);
    graph.processHookEvent(hook('cli-a', 'Write', { file_path: abs }));
    expect(nodeByLabel(graph, projectName, 'upgrade.mjs')?.appWork?.[appId]).toBeDefined();
  });

  it('이어진 동안 IDE 로 시킨 일(앱 노드 없는 명령 · 앞 앱 명령 없음)도 이어진 앱 노드의 작업물이다', () => {
    const { graph, projectName, queues, agent, sessionKey, appId } = setup();
    mockSubs({ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' });
    queues.set(sessionKey, [command('cmd-1', 'sub-a', { text: '노트 정리해' })]);
    graph.processHookEvent(hook('cli-a', 'Write', { file_path: writeFile(['notes', 'todo.md']) }));
    expect(nodeByLabel(graph, projectName, 'todo.md')?.appWork?.[appId]).toMatchObject({ w: 1 });
  });

  it('말풍선에서 앱을 모두 뺀 명령은 꼬리표가 없다 — 이어진 앱 · 앞 앱 명령 폴백도 타지 않는다', () => {
    const { graph, projectName, queues, archive, agent, sessionKey, appId } = setup();
    mockSubs({ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' });
    archive.set(sessionKey, [command('cmd-0', 'sub-a', { status: 'completed', appNodeIds: [appId] })]);
    queues.set(sessionKey, [command('cmd-1', 'sub-a', { text: '테스트만 고쳐', appNodesOff: true })]);
    graph.processHookEvent(hook('cli-a', 'Write', { file_path: writeFile(['src', 'unrelated.ts']) }));
    expect(nodeByLabel(graph, projectName, 'unrelated.ts')?.appWork).toBeUndefined();
  });

  it('앞 앱 명령의 노드가 아직 이어져 있으면 그 노드로 좁힌다 · 끊겼으면 지금 이어진 노드 전부', () => {
    const { graph, projectName, queues, archive, agent, sessionKey, appId } = setup();
    const image = graph.createAppBubble({ projectName, appId: 'vibimage', x: 0, y: 0, linkedAgentIds: [agent.id] });
    const gone = graph.createAppBubble({ projectName, appId: 'vibisound', x: 0, y: 0, linkedAgentIds: [] });
    mockSubs({ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' }, { id: 'sub-b', parentAgentId: agent.id, sessionId: 'cli-b' });
    archive.set(sessionKey, [
      command('cmd-0', 'sub-a', { status: 'completed', appNodeIds: [image.id] }),
      command('cmd-9', 'sub-b', { status: 'completed', appNodeIds: [gone.id] }),
    ]);
    queues.set(sessionKey, [command('cmd-1', 'sub-a', { text: '간판 더 밝게' }), command('cmd-2', 'sub-b', { text: '이어서' })]);
    graph.processHookEvent(hook('cli-a', 'Write', { file_path: writeFile(['out', 'sign.png']) }));
    graph.processHookEvent(hook('cli-b', 'Write', { file_path: writeFile(['out', 'mix.json']) }));
    expect(Object.keys(nodeByLabel(graph, projectName, 'sign.png')?.appWork ?? {})).toEqual([image.id]);
    // sub-b 의 앞 앱 명령 노드는 이 에이전트를 잇지 않는다 — 지금 이어진 노드 전부의 작업물이다.
    expect(Object.keys(nodeByLabel(graph, projectName, 'mix.json')?.appWork ?? {}).sort()).toEqual([appId, image.id].sort());
  });

  it('이은 앱이 없으면 종전대로 같은 세션의 마지막 앱 명령을 잇는다', () => {
    const { graph, projectName, queues, archive, agent, sessionKey, appId } = setup({ linked: false });
    mockSubs({ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' });
    archive.set(sessionKey, [command('cmd-0', 'sub-a', { status: 'completed', appNodeIds: [appId] })]);
    queues.set(sessionKey, [command('cmd-1', 'sub-a', { text: '창문 더 크게' })]);
    graph.processHookEvent(hook('cli-a', 'Write', { file_path: writeFile([...WORK_DIR, 'upgrade.mjs']) }));
    expect(nodeByLabel(graph, projectName, 'upgrade.mjs')?.appWork?.[appId]).toBeDefined();
  });

  it('사전 이벤트는 꼬리표만 세우고 쓰기 수는 사후에 센다 · 다른 sub 의 쓰기는 그 명령에 귀속되지 않는다', () => {
    const { graph, projectName, queues, agent, sessionKey, appId } = setup({ linked: false });
    mockSubs(
      { id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' },
      { id: 'sub-b', parentAgentId: agent.id, sessionId: 'cli-b' },
    );
    queues.set(sessionKey, [command('cmd-1', 'sub-a', { appNodeIds: [appId] }), command('cmd-2', 'sub-b')]);
    const mine = writeFile([...WORK_DIR, 'palette.mjs']);
    graph.processHookEvent(hook('cli-a', 'Write', { file_path: mine }, 'PreToolUse'));
    expect(nodeByLabel(graph, projectName, 'palette.mjs')?.appWork?.[appId]?.w).toBe(0);
    graph.processHookEvent(hook('cli-a', 'Write', { file_path: mine }));
    expect(nodeByLabel(graph, projectName, 'palette.mjs')?.appWork?.[appId]?.w).toBe(1);
    const other = writeFile(['src', 'unrelated.ts']);
    graph.processHookEvent(hook('cli-b', 'Write', { file_path: other }));
    expect(nodeByLabel(graph, projectName, 'unrelated.ts')?.appWork).toBeUndefined();
  });

  it('꼬리표는 체크포인트를 왕복한다(노드 객체째)', () => {
    const { graph, projectName, queues, agent, sessionKey, appId } = setup();
    mockSubs({ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' });
    queues.set(sessionKey, [command('cmd-1', 'sub-a', { appNodeIds: [appId] })]);
    graph.processHookEvent(hook('cli-a', 'Write', { file_path: writeFile([...WORK_DIR, 'scene-work.mjs']) }));
    const cp = JSON.parse(JSON.stringify(graph.toProjectCheckpoint(projectName)));
    const revived = new ProjectGraph();
    revived.setCommandQueuesRef(new Map());
    revived.setCompletedCommandArchiveRef(new Map());
    revived.registerProject(root);
    revived.restoreFromCheckpoint(cp);
    expect(nodeByLabel(revived, projectName, 'scene-work.mjs')?.appWork?.[appId]).toMatchObject({ w: 1 });
  });
});

describe('§5.1 #2-1 (F) ② — 이미 떠 있던 캔버스 되짚기(사진 속 실제 경우)', () => {
  /**
   * 기능이 없던 때의 캔버스: 에이전트가 Vibi3D 작업으로 쓴 파일 다섯 · 다른 에이전트도 쓰는 `artifacts` 폴더 · 그 에이전트가
   * 읽기만 한 문서 · 명령은 본문에 노드 id 가 적힌 옛 말풍선 명령 두 건(appNodeIds 없음). 껐다 켜면 되짚어야 한다.
   */
  function oldCanvas(): { cp: unknown; projectName: string; appId: string } {
    const { graph, projectName, archive, agent, sessionKey, appId } = setup({ linked: false });
    const other = graph.createCustomAgent('Dokkaebi builder', undefined, projectName);
    mockSubs(
      { id: 'sub-mvdp3hid-sn4g', parentAgentId: agent.id, sessionId: 'cli-a' },
      { id: 'sub-other', parentAgentId: other.id, sessionId: 'cli-o' },
    );
    for (const name of WORK_FILES) graph.processHookEvent(hook('cli-a', 'Write', { file_path: writeFile([...WORK_DIR, name]) }));
    graph.processHookEvent(hook('cli-a', 'Read', { file_path: writeFile(['docs', 'brief.md']) }));
    graph.processHookEvent(hook('cli-o', 'Write', { file_path: writeFile(['artifacts', 'dokkaebi', 'preview.tsx']) }));
    // 기능 이전에 끝난 명령들 — 본문에 앱 노드 id(말풍선 프로토콜 블록)만 있다.
    archive.set(sessionKey, [
      command('cmd-1792320075877-0', 'sub-mvdp3hid-sn4g', { status: 'completed', text: `연결된 Vibi3D 문서에 한국 구도심의 상가 모퉁이 … ${appId}` }),
      command('cmd-1792379113243-0', 'sub-mvdp3hid-sn4g', { status: 'completed', text: `작업 완성 시켜  --- Linked canvas nodes (Vibi3D) ${appId}` }),
    ]);
    for (const name of WORK_FILES) expect(nodeByLabel(graph, projectName, name)?.appWork).toBeUndefined();
    return { cp: JSON.parse(JSON.stringify(graph.toProjectCheckpoint(projectName))), projectName, appId };
  }

  it('그 에이전트의 명령이 전부 같은 앱 노드면 혼자 쓴 파일 다섯이 모두 그 노드의 작업물이 된다', () => {
    const { cp, projectName, appId } = oldCanvas();
    const revived = new ProjectGraph();
    revived.setCommandQueuesRef(new Map());
    revived.setCompletedCommandArchiveRef(new Map());
    revived.registerProject(root);
    revived.restoreFromCheckpoint(cp as Parameters<ProjectGraph['restoreFromCheckpoint']>[0]);
    for (const name of WORK_FILES) {
      expect(nodeByLabel(revived, projectName, name)?.appWork?.[appId]).toMatchObject({ retro: true });
    }
    // 읽기만 한 문서 · 남의 파일 · 폴더는 묶지 않는다(판단이 서지 않으면 묶지 않는다).
    expect(nodeByLabel(revived, projectName, 'brief.md')?.appWork).toBeUndefined();
    expect(nodeByLabel(revived, projectName, 'preview.tsx')?.appWork).toBeUndefined();
    expect(nodeByLabel(revived, projectName, 'artifacts')?.appWork).toBeUndefined();
  });

  it('명령이 섞여 있고 sub 가 둘이면 묶지 않는다', () => {
    const { graph, projectName, archive, agent, sessionKey, appId } = setup({ linked: false });
    mockSubs(
      { id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' },
      { id: 'sub-b', parentAgentId: agent.id, sessionId: 'cli-b' },
    );
    graph.processHookEvent(hook('cli-a', 'Write', { file_path: writeFile([...WORK_DIR, 'scene-work.mjs']) }));
    archive.set(sessionKey, [
      command('cmd-1', 'sub-a', { status: 'completed', appNodeIds: [appId] }),
      command('cmd-2', 'sub-b', { status: 'completed', text: '테스트 고쳐' }),
    ]);
    expect(graph.backfillAppWork()).toBe(0);
    expect(nodeByLabel(graph, projectName, 'scene-work.mjs')?.appWork).toBeUndefined();
  });
});

describe('§5.1 #2-1 (F) ③ — 스크립트가 만든 파일(작업 폴더 훑기)', () => {
  it('앱 작업 중의 Bash 가 끝나면 그 명령 뒤에 생긴 파일을 확장자와 무관하게 올리고 script 표식을 단다', async () => {
    const { graph, projectName, queues, agent, sessionKey, appId } = setup();
    mockSubs({ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' });
    const script = writeFile([...WORK_DIR, 'generate-materials.mjs']);
    const old = writeFile([...WORK_DIR, 'textures', 'stale.png']);
    const past = (Date.now() - 60_000) / 1000;
    fs.utimesSync(old, past, past);
    fs.utimesSync(script, past, past);
    queues.set(sessionKey, [command('cmd-1', 'sub-a', { appNodeIds: [appId], startedAt: Date.now() - 1_000 })]);
    // 스크립트가 만든 산출물 — 도구 기록에는 이름이 없다.
    writeFile([...WORK_DIR, 'textures', 'brick_albedo.png']);
    writeFile([...WORK_DIR, 'out', 'street.glb']);
    writeFile([...WORK_DIR, 'out', 'notes.weird']);
    writeFile(['node_modules', 'pkg', 'index.js']);
    graph.processHookEvent(hook('cli-a', 'Bash', { command: `node ${path.join(...WORK_DIR, 'generate-materials.mjs').replace(/\\/g, '/')}` }));

    await vi.waitFor(() => {
      expect(nodeByLabel(graph, projectName, 'street.glb')?.appWork?.[appId]).toMatchObject({ script: true });
    }, { timeout: APP_WORK.scanDelayMs + 4_000, interval: 50 });
    expect(nodeByLabel(graph, projectName, 'brick_albedo.png')?.appWork?.[appId]).toMatchObject({ script: true });
    expect(nodeByLabel(graph, projectName, 'notes.weird')?.appWork?.[appId]).toMatchObject({ script: true });
    // 명령 전에 있던 파일 · 훑지 않는 폴더는 올리지 않는다.
    expect(nodeByLabel(graph, projectName, 'stale.png')).toBeUndefined();
    expect(nodeByLabel(graph, projectName, 'index.js')).toBeUndefined();
  });

  it('프로젝트 밖 낱말은 디스크에 묻지도 않는다 — Blender `//renders/…` · 다른 폴더(Windows 는 UNC 조회로 입출력이 묶인다)', async () => {
    const { graph, projectName, queues, agent, sessionKey, appId } = setup();
    mockSubs({ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' });
    queues.set(sessionKey, [command('cmd-1', 'sub-a', { appNodeIds: [appId], startedAt: Date.now() - 1_000 })]);
    const rel = path.join(...WORK_DIR, 'out', 'street.glb').replace(/\\/g, '/');
    writeFile([...WORK_DIR, 'out', 'street.glb']);
    const outside = path.join(path.dirname(root), 'vibi-appwork-outside', 'copy.glb').replace(/\\/g, '/');
    const stat = vi.spyOn(fs.promises, 'stat');
    graph.processHookEvent(hook('cli-a', 'Bash', { command: `blender -b scene.blend -o //renders/frame_#### -a && cp ${rel} ${outside}` }));
    await vi.waitFor(() => {
      expect(nodeByLabel(graph, projectName, 'street.glb')?.appWork?.[appId]).toMatchObject({ script: true });
    }, { timeout: APP_WORK.scanDelayMs + 4_000, interval: 50 });
    // 윈도·맥의 normalize 는 경로를 접으므로 시험의 비교도 접는다.
    const inside = `${root.replace(/\\/g, '/').toLowerCase()}/`;
    const asked = stat.mock.calls.map(([p]) => String(p).replace(/\\/g, '/').toLowerCase());
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.filter((p) => !p.startsWith(inside))).toEqual([]);
  });

  it('앱 작업이 아니면 훑지 않는다 — 이은 앱이 없거나 · 말풍선에서 앱을 모두 뺀 명령', async () => {
    for (const variant of ['unlinked', 'appsOff'] as const) {
      const { graph, projectName, queues, agent, sessionKey } = setup({ linked: variant !== 'unlinked' });
      mockSubs({ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' });
      const script = writeFile([...WORK_DIR, `build-${variant}.mjs`]);
      const off = variant === 'appsOff' ? { appNodesOff: true as const } : {};
      queues.set(sessionKey, [command('cmd-1', 'sub-a', { startedAt: Date.now() - 1_000, ...off })]);
      writeFile([...WORK_DIR, 'out', `model-${variant}.glb`]);
      graph.processHookEvent(hook('cli-a', 'Bash', { command: `node ${script.replace(/\\/g, '/')}` }));
      await new Promise((r) => setTimeout(r, APP_WORK.scanDelayMs + 300));
      expect(nodeByLabel(graph, projectName, `model-${variant}.glb`)).toBeUndefined();
      vi.restoreAllMocks();
    }
  });

  it('이어진 동안 IDE 로 돌린 스크립트의 출력도 훑는다 — 시작 시각은 도는 명령의 것', async () => {
    const { graph, projectName, queues, agent, sessionKey, appId } = setup();
    mockSubs({ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' });
    const script = writeFile([...WORK_DIR, 'render.mjs']);
    const past = (Date.now() - 60_000) / 1000;
    fs.utimesSync(script, past, past);
    queues.set(sessionKey, [command('cmd-1', 'sub-a', { text: '렌더 다시', startedAt: Date.now() - 1_000 })]);
    writeFile([...WORK_DIR, 'out', 'shot.glb']);
    graph.processHookEvent(hook('cli-a', 'Bash', { command: `node ${script.replace(/\\/g, '/')}` }));
    await vi.waitFor(() => {
      expect(nodeByLabel(graph, projectName, 'shot.glb')?.appWork?.[appId]).toMatchObject({ script: true });
    }, { timeout: APP_WORK.scanDelayMs + 4_000, interval: 50 });
    // 명령 전에 있던 스크립트 자신은 스크립트 출력이 아니다.
    expect(nodeByLabel(graph, projectName, 'render.mjs')).toBeUndefined();
  });
});

/**
 * §5.1 #1-1 (D) — 실제 라우트가 넘기는 모양 그대로. 우리가 띄운 세션은 전부 소유자 태그를 달아 라우트가 `session_id` 를
 * **주인 버블 키**로 바꿔 쓰므로, 위 시험들이 쓰는 워커 세션 id(`cli-a`) 길은 실제로는 돌지 않는다(2026-10-22 실측 —
 * 실데이터 꼬리표가 전부 되짚기 `retro`). 그 일을 한 sub 는 훅·라우트·방출기가 `_vibisualSubAgentId` 로 싣는다.
 */
describe('§5.1 #1-1 (D) — 라우트 모양: 세션 키는 주인 버블 것, sub 는 명시로', () => {
  function mockSubsWithLookup(...subs: Array<{ id: string; parentAgentId: string; sessionId: string }>): void {
    mockSubs(...subs);
    vi.spyOn(subAgentManager, 'getSub').mockImplementation(
      (id: string) => subs.find((s) => s.id === id) as unknown as SubAgent | undefined,
    );
  }

  it('주인 키 + 명시 sub → 쓴 파일에 꼬리표가 붙는다', () => {
    const { graph, projectName, queues, agent, sessionKey, appId } = setup();
    mockSubsWithLookup({ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' });
    queues.set(sessionKey, [command('cmd-1', 'sub-a', { appNodeIds: [appId] })]);
    const abs = writeFile([...WORK_DIR, 'route-shape.mjs']);
    graph.processHookEvent({
      ...hook(sessionKey, 'Write', { file_path: abs }),
      _vibisualOwnerAgentId: agent.id,
      _vibisualSubAgentId: 'sub-a',
    });
    expect(nodeByLabel(graph, projectName, 'route-shape.mjs')?.appWork?.[appId]).toMatchObject({ w: 1 });
  });

  it('명시 sub 가 없으면 주인 키만으로는 sub 를 못 찾는다 — 이번에 고친 자리', () => {
    const { graph, projectName, queues, agent, sessionKey, appId } = setup({ linked: false });
    mockSubsWithLookup({ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' });
    queues.set(sessionKey, [command('cmd-1', 'sub-a', { appNodeIds: [appId] })]);
    const abs = writeFile([...WORK_DIR, 'no-sub.mjs']);
    graph.processHookEvent({ ...hook(sessionKey, 'Write', { file_path: abs }), _vibisualOwnerAgentId: agent.id });
    expect(nodeByLabel(graph, projectName, 'no-sub.mjs')?.appWork).toBeUndefined();
  });

  it('남의 에이전트의 sub id 는 받지 않는다', () => {
    const { graph, projectName, queues, agent, sessionKey, appId } = setup();
    mockSubsWithLookup({ id: 'sub-x', parentAgentId: 'agent-someone-else', sessionId: 'cli-x' });
    queues.set(sessionKey, [command('cmd-1', 'sub-x', { appNodeIds: [appId] })]);
    const abs = writeFile([...WORK_DIR, 'foreign.mjs']);
    graph.processHookEvent({
      ...hook(sessionKey, 'Write', { file_path: abs }),
      _vibisualOwnerAgentId: agent.id,
      _vibisualSubAgentId: 'sub-x',
    });
    expect(nodeByLabel(graph, projectName, 'foreign.mjs')?.appWork).toBeUndefined();
  });

  it('셸로 쓴 파일도 — 라우트 모양의 Bash 사전·사후', () => {
    const { graph, projectName, queues, agent, sessionKey, appId } = setup();
    mockSubsWithLookup({ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' });
    queues.set(sessionKey, [command('cmd-1', 'sub-a', { appNodeIds: [appId] })]);
    const abs = writeFile([...WORK_DIR, 'shell-out.json'], '{}');
    const input = { command: `echo '{"a":1}' > '${abs.split(path.sep).join('/')}'` };
    for (const phase of ['PreToolUse', 'PostToolUse'] as const) {
      graph.processHookEvent({
        ...hook(sessionKey, 'Bash', input, phase),
        tool_use_id: 'toolu-route-bash',
        _vibisualOwnerAgentId: agent.id,
        _vibisualSubAgentId: 'sub-a',
      });
    }
    expect(nodeByLabel(graph, projectName, 'shell-out.json')?.appWork?.[appId]).toMatchObject({ w: 1 });
  });

  it('로컬·코덱스 방출기 — toLocalHookPayload 가 그 sub 를 싣는다', () => {
    const { graph, projectName, queues, agent, sessionKey, appId } = setup();
    mockSubsWithLookup({ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a' });
    queues.set(sessionKey, [command('cmd-1', 'sub-a', { appNodeIds: [appId] })]);
    writeFile([...WORK_DIR, 'codex-made.mjs']);
    const payload = toLocalHookPayload(sessionKey, {
      phase: 'post',
      toolName: 'Write',
      toolInput: { path: [...WORK_DIR, 'codex-made.mjs'].join('/') },
      toolUseId: 'codex-file:1',
      cwd: root,
    }, { subAgentId: 'sub-a' });
    graph.processHookEvent(payload);
    expect(nodeByLabel(graph, projectName, 'codex-made.mjs')?.appWork?.[appId]).toMatchObject({ w: 1 });
  });
});
