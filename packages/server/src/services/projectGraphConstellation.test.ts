/**
 * §5.1 #2-1 (C)(D) — 실제 `ProjectGraph` 로 재는 별자리 서버 몫.
 *
 * 고정하는 것:
 *  ① 폴더 위성 상한은 **자리** 수다 — 같은 이름으로 묶인 별자리(영상 + json + 코드)는 한 자리로 세어 함께 남는다.
 *  ② 글 파일의 내용 언급이 비동기로 읽혀 **스냅샷 사본의 `mentions`** 에 실리고, 다 읽으면 비동기 알림이 온다.
 *  ③ 파일 위성에는 수정 시각(`fileMtime`)이 실린다.
 *  ④ 둘 다 표시 전용 파생값이라 **체크포인트에는 실리지 않는다**.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BubbleData } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';

let projRoot: string;
let projName: string;

const SESSION = 'sess-constellation-1';

beforeEach(() => {
  projRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-constellation-')));
  projName = path.basename(projRoot);
  fs.mkdirSync(path.join(projRoot, 'video'), { recursive: true });
  fs.mkdirSync(path.join(projRoot, 'audio'), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  try { fs.rmSync(projRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

function makeGraph(): ProjectGraph {
  const graph = new ProjectGraph();
  graph.registerProject(projRoot);
  return graph;
}

let toolSeq = 0;

/** 파일을 디스크에 만들고 그 파일을 만진 훅 한 방(사후)을 보낸다. */
function touch(graph: ProjectGraph, rel: string, body = 'x', toolName = 'Write'): void {
  const abs = path.join(projRoot, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, 'utf8');
  toolSeq += 1;
  graph.processHookEvent({
    session_id: SESSION,
    hook_event_name: 'PostToolUse',
    tool_name: toolName,
    tool_use_id: `toolu-constellation-${toolSeq}`,
    tool_input: toolName === 'Read' ? { file_path: abs } : { file_path: abs, content: body },
    tool_response: {},
    cwd: projRoot,
  });
}

/** 이 폴더(라벨)의 위성 파일 이름들. */
function satelliteNames(graph: ProjectGraph, folderLabel: string): string[] {
  const snap = graph.getSnapshot();
  const folder = [...snap.topFolders, ...Object.values(snap.children).flat()]
    .find((b: BubbleData) => b.label === folderLabel && b.bubbleType === 'internal_folder');
  if (!folder) throw new Error(`폴더 ${folderLabel} 가 없다`);
  return (snap.satellites[folder.id] ?? []).map((b) => b.label).sort();
}

function findSatellite(graph: ProjectGraph, label: string): BubbleData | undefined {
  const snap = graph.getSnapshot();
  return Object.values(snap.satellites).flat().find((b) => b.label === label);
}

describe('위성 상한 — 별자리는 한 자리', () => {
  it('같은 이름으로 묶인 영상·json·코드는 상한을 넘어도 함께 남고, 오래된 낱자리가 빠진다', async () => {
    const graph = makeGraph();
    touch(graph, 'video/teaser.mp4', 'mp4', 'Read');
    expect(graph.setFolderMaxSatellites('video', 2)).toBe(true);
    touch(graph, 'video/a.ts');
    touch(graph, 'video/teaser.json');
    touch(graph, 'video/teaser.tsx');
    touch(graph, 'video/b.ts');
    // 자리: [teaser.mp4 + teaser.json + teaser.tsx] · a.ts · b.ts → 상한 2 → 가장 오래된 자리(a.ts)만 빠진다.
    await vi.waitFor(() => expect(satelliteNames(graph, 'video')).toEqual(['b.ts', 'teaser.json', 'teaser.mp4', 'teaser.tsx']));
  });

  it('상한 1에서도 처음 읽는 코드의 내용 언급을 기다려 영상과 코드를 함께 남긴다', async () => {
    const graph = makeGraph();
    touch(graph, 'video/out.mp4', 'mp4', 'Read');
    expect(graph.setFolderMaxSatellites('video', 1)).toBe(true);
    // 직전 스냅샷의 빈 색인이 살아 있어도 방금 들어온 코드는 반드시 읽어야 한다.
    expect(satelliteNames(graph, 'video')).toEqual(['out.mp4']);
    touch(graph, 'video/render.ts', 'const output = "out.mp4";');
    expect(satelliteNames(graph, 'video')).toEqual(['out.mp4', 'render.ts']);
    await vi.waitFor(() => expect(findSatellite(graph, 'render.ts')?.mentions).toEqual([findSatellite(graph, 'out.mp4')?.id]));
    expect(satelliteNames(graph, 'video')).toEqual(['out.mp4', 'render.ts']);
  });

  it.each(['empty', 'error'] as const)('언급 스캔이 %s여도 보류한 상한을 끝내고 변경을 저장 대상으로 표시한다', async (result) => {
    const graph = makeGraph();
    const changed = vi.fn();
    graph.setOnAsyncChange(changed);
    touch(graph, 'video/out.mp4', 'mp4', 'Read');
    expect(graph.setFolderMaxSatellites('video', 1)).toBe(true);
    if (result === 'error') vi.spyOn(fs.promises, 'open').mockRejectedValueOnce(new Error('EBUSY'));
    touch(graph, 'video/render.ts', 'const value = 1;');
    const beforeCompletion = graph.getMutationVersion();
    expect(satelliteNames(graph, 'video')).toEqual(['out.mp4', 'render.ts']);
    await vi.waitFor(() => expect(satelliteNames(graph, 'video')).toEqual(['render.ts']));
    expect(graph.getMutationVersion()).toBeGreaterThan(beforeCompletion);
    expect(changed).toHaveBeenCalled();
  });

  it('묶이지 않은 파일들은 종전처럼 오래된 것부터 빠진다', () => {
    const graph = makeGraph();
    touch(graph, 'video/one.ts');
    expect(graph.setFolderMaxSatellites('video', 2)).toBe(true);
    touch(graph, 'video/two.ts');
    touch(graph, 'video/three.ts');
    expect(satelliteNames(graph, 'video')).toEqual(['three.ts', 'two.ts']);
  });
});

describe('내용 언급 · 수정 시각 — 스냅샷 사본에만', () => {
  it('json 이 적고 있는 소리 파일이 mentions 에 실리고, 체크포인트에는 실리지 않는다', async () => {
    const graph = makeGraph();
    let notified = 0;
    let wake: (() => void) | null = null;
    graph.setOnAsyncChange(() => {
      notified += 1;
      wake?.();
    });
    touch(graph, 'audio/bgm.wav', 'RIFF', 'Read');
    touch(graph, 'video/scene.json', '{"music": "audio/bgm.wav"}');

    // 처음 스냅샷은 읽기를 줄 세울 뿐이다(동기 읽기 ❌).
    expect(findSatellite(graph, 'scene.json')?.mentions).toBeUndefined();
    await new Promise<void>((resolve) => {
      wake = resolve;
      setTimeout(resolve, 2000);
    });
    expect(notified).toBeGreaterThanOrEqual(1);

    const bgm = findSatellite(graph, 'bgm.wav');
    const scene = findSatellite(graph, 'scene.json');
    expect(bgm).toBeDefined();
    expect(scene?.mentions).toEqual([bgm?.id]);
    expect(typeof scene?.fileMtime).toBe('number');

    const cp = graph.toProjectCheckpoint(projName);
    for (const node of Object.values(cp.graph.nodes)) {
      expect(node.mentions).toBeUndefined();
      expect(node.fileMtime).toBeUndefined();
    }
  });
});
