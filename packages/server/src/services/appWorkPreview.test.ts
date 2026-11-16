/**
 * §5.4 #36 (L) — 결과 없는 앱 화면의 작업 중 미리보기. 턴이 끝난 뒤의 백그라운드 출력(훅 0건)까지 노드가 알아채는지,
 * 쓰는 중인 파일을 고르지 않는지, 결과가 오면 걷히는지를 실제 파일로 확인한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BubbleData, HookEventPayload, QueuedCommand, SubAgent } from '@vibisual/shared';
import { APP_WORK } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { subAgentManager } from './subAgentManager.js';

let root: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-workpreview-')));
});

afterEach(() => {
  vi.restoreAllMocks();
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
});

const START = 1_794_000_000_000;

function writeAt(rel: string, mtime: number, body = 'x'): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  fs.utimesSync(abs, new Date(mtime), new Date(mtime));
  return abs;
}

function setup(extra: { ref?: string } = {}): { graph: ProjectGraph; agent: BubbleData; sessionKey: string; appId: string; queues: Map<string, QueuedCommand[]> } {
  const graph = new ProjectGraph();
  const queues = new Map<string, QueuedCommand[]>();
  graph.setCommandQueuesRef(queues);
  graph.setCompletedCommandArchiveRef(new Map());
  const projectName = graph.registerProject(root).name;
  const agent = graph.createCustomAgent('Maker', undefined, projectName);
  const sessionKey = graph.findSessionByAgentId(agent.id)!;
  const app = graph.createAppBubble({ projectName, appId: 'vibistudio', x: 0, y: 0, linkedAgentIds: [agent.id], ...extra });
  vi.spyOn(subAgentManager, 'getAllSubsFlat').mockReturnValue(
    [{ id: 'sub-a', parentAgentId: agent.id, sessionId: 'cli-a', label: 'a', lastActivityAt: 1 } as unknown as SubAgent],
  );
  queues.set(sessionKey, [{ id: 'cmd-1', text: 'make', timestamp: START, startedAt: START, subAgentId: 'sub-a', status: 'executing' } as QueuedCommand]);
  return { graph, agent, sessionKey, appId: app.id, queues };
}

function hook(tool: string, input: Record<string, unknown>): HookEventPayload {
  return { session_id: 'cli-a', hook_event_name: 'PostToolUse', tool_name: tool, tool_input: input, cwd: root } as HookEventPayload;
}

function runBash(graph: ProjectGraph, command: string): void {
  graph.processHookEvent(hook('Bash', { command }));
}

describe('§5.4 #36 (L) — 작업 중 미리보기', () => {
  it('도구로 쓴 미디어 파일은 바로 노드에 적히고, 코드 파일은 적히지 않는다', () => {
    const { graph, appId } = setup();
    const png = writeAt('out/poster.png', START + 10);
    const code = writeAt('out/build.py', START + 20);
    graph.processHookEvent(hook('Write', { file_path: code, content: 'x' }));
    expect(graph.getAppBubble(appId)?.workPreviews).toBeUndefined();
    graph.processHookEvent(hook('Write', { file_path: png, content: 'x' }));
    expect(graph.getAppBubble(appId)?.workPreviews?.image?.file.toLowerCase()).toBe('out/poster.png');
  });

  it('턴이 끝난 뒤 백그라운드가 만든 파일도 감시가 종류마다 가장 새 것을 적는다', async () => {
    const { graph, appId, sessionKey, queues } = setup();
    const now = START + 600_000;
    writeAt('ep/06-render/qa/frame.jpg', START + 10_000);
    runBash(graph, `ls ${path.join(root, 'ep', '06-render').replace(/\\/g, '/')}`);
    queues.set(sessionKey, []); // 턴이 끝났다 — 더는 훅이 오지 않는다
    writeAt('ep/06-render/build/chunks/c0000.mp4', START + 100_000);
    writeAt('ep/06-render/build/chunks/c0001.mp4', START + 200_000);
    writeAt('ep/05-audio/old.flac', START - 1_000); // 작업 시작 전 파일
    expect(await graph.scanWorkPreviews(now)).toBe(true);
    const previews = graph.getAppBubble(appId)?.workPreviews;
    expect(previews?.video?.file.toLowerCase()).toBe('ep/06-render/build/chunks/c0001.mp4');
    expect(previews?.image?.file.toLowerCase()).toBe('ep/06-render/qa/frame.jpg');
    expect(previews?.audio).toBeUndefined();
    expect(await graph.scanWorkPreviews(now + 10_000)).toBe(false);
  });

  it('아직 쓰는 중인 파일은 고르지 않고, 잠잠해진 뒤에 고른다', async () => {
    const { graph, appId } = setup();
    runBash(graph, `ls ${path.join(root, 'render').replace(/\\/g, '/')}`);
    fs.mkdirSync(path.join(root, 'render'), { recursive: true });
    const now = START + 60_000;
    writeAt('render/c0001.part.mp4', now - APP_WORK.previewSettleMs + 1_000);
    runBash(graph, `ls ${path.join(root, 'render').replace(/\\/g, '/')}`);
    await graph.scanWorkPreviews(now);
    expect(graph.getAppBubble(appId)?.workPreviews).toBeUndefined();
    await graph.scanWorkPreviews(now + APP_WORK.previewSettleMs);
    expect(graph.getAppBubble(appId)?.workPreviews?.video?.file.toLowerCase()).toBe('render/c0001.part.mp4');
  });

  it('프로젝트 루트는 기준 자리가 아니다', async () => {
    const { graph, appId } = setup();
    writeAt('root-shot.png', START + 10_000);
    runBash(graph, `cd ${root.replace(/\\/g, '/')}`);
    await graph.scanWorkPreviews(START + 60_000);
    expect(graph.getAppBubble(appId)?.workPreviews).toBeUndefined();
  });

  it('결과나 문서가 묶이면 미리보기를 지우고, 그 뒤로는 적지 않는다', async () => {
    const { graph, appId } = setup();
    const png = writeAt('out/poster.png', START + 10);
    graph.processHookEvent(hook('Write', { file_path: png, content: 'x' }));
    expect(graph.getAppBubble(appId)?.workPreviews).toBeDefined();
    graph.setAppBubbleFile(appId, 'out/final.mp4', START + 50);
    expect(graph.getAppBubble(appId)?.workPreviews).toBeUndefined();
    graph.processHookEvent(hook('Write', { file_path: png, content: 'y' }));
    expect(graph.getAppBubble(appId)?.workPreviews).toBeUndefined();
  });

  it('문서가 묶인 노드는 처음부터 대상이 아니고, 문서를 묶는 순간 걷힌다', () => {
    const bound = setup({ ref: 'vid-1' });
    const png = writeAt('out/a.png', START + 10);
    bound.graph.processHookEvent(hook('Write', { file_path: png, content: 'x' }));
    expect(bound.graph.getAppBubble(bound.appId)?.workPreviews).toBeUndefined();
    vi.restoreAllMocks();
    const open = setup();
    open.graph.processHookEvent(hook('Write', { file_path: png, content: 'x' }));
    expect(open.graph.getAppBubble(open.appId)?.workPreviews).toBeDefined();
    open.graph.updateAppBubble(open.appId, { ref: 'vid-2' });
    expect(open.graph.getAppBubble(open.appId)?.workPreviews).toBeUndefined();
  });

  it('체크포인트를 왕복해도 남는다', () => {
    const { graph, appId } = setup();
    const png = writeAt('out/poster.png', START + 10);
    graph.processHookEvent(hook('Write', { file_path: png, content: 'x' }));
    const name = graph.getAppBubble(appId)!.projectName;
    const bubble = graph.toProjectCheckpoint(name).appBubbles?.find((b) => b.id === appId);
    expect(bubble?.workPreviews?.image?.file.toLowerCase()).toBe('out/poster.png');
  });
});
