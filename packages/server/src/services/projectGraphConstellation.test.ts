/**
 * §5.1 #2-1 (C)(D) — 실제 `ProjectGraph` 로 재는 별자리 서버 몫.
 *
 * 고정하는 것:
 *  ① 폴더 위성 상한은 **자리** 수다 — 같은 폴더의 같은 미디어 종류(화면의 묶음 버블)는 한 자리로 세어 함께 남는다.
 *     2026-10-22 부터 폴더 직속 파일도 같은 종류면 한 자리다(사용자 지시 — 직속 제외 폐기). 다른 종류는 낱자리다.
 *     한 묶음은 `moonMax` 까지다(2026-10-21 — 파일 중심 별자리 · 언급 읽기 보류 폐기).
 *  ①-1 미디어 위성 사본에는 그 파일이 든 폴더의 노드 id 와 그 폴더의 같은 종류 사용 수가 실린다 — 위성 상한으로 빠진 것까지
 *     센다(묶음 버블의 수 · 묶음 안의 범위 선언, 2026-10-22). 표시 전용이라 체크포인트에는 실리지 않는다.
 *  ② 글 파일의 내용 언급이 비동기로 읽혀 **스냅샷 사본의 `mentions`** 에 실리고, 다 읽으면 비동기 알림이 온다.
 *  ③ 파일 위성에는 수정 시각(`fileMtime`)이 실린다.
 *  ④ 둘 다 표시 전용 파생값이라 **체크포인트에는 실리지 않는다**.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BubbleData } from '@vibisual/shared';
import { CONSTELLATION } from '@vibisual/shared';
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

describe('위성 상한 — 같은 종류 묶음은 한 자리 (2026-10-21)', () => {
  it('하위 폴더의 같은 종류(영상)는 한 자리로 세어 함께 남고, 오래된 낱자리가 빠진다', () => {
    const graph = makeGraph();
    touch(graph, 'media/clips/a.mp4', 'mp4', 'Read');
    expect(graph.setFolderMaxSatellites('media', 2)).toBe(true);
    touch(graph, 'media/x.ts');
    touch(graph, 'media/clips/b.mp4', 'mp4', 'Read');
    touch(graph, 'media/clips/c.mp4', 'mp4', 'Read');
    touch(graph, 'media/y.ts');
    // 자리: [clips 의 영상 a·b·c] · x.ts · y.ts → 상한 2 → 가장 오래된 자리(x.ts)만 빠진다. 화면에는 영상 묶음 하나 + y.ts.
    expect(satelliteNames(graph, 'media')).toEqual(['a.mp4', 'b.mp4', 'c.mp4', 'y.ts']);
  });

  it('폴더의 직속 파일도 같은 종류면 한 자리로 함께 남는다 — 직속 제외는 걷었다(2026-10-22 사용자 지시)', () => {
    const graph = makeGraph();
    touch(graph, 'video/a.mp4', 'mp4', 'Read');
    expect(graph.setFolderMaxSatellites('video', 2)).toBe(true);
    touch(graph, 'video/b.mp4', 'mp4', 'Read');
    touch(graph, 'video/c.mp4', 'mp4', 'Read');
    touch(graph, 'video/notes.md');
    // 자리: [video 의 영상 a·b·c] · notes.md → 상한 2 안. 종전에는 직속 영상이 낱자리라 a 가 빠졌다.
    expect(satelliteNames(graph, 'video')).toEqual(['a.mp4', 'b.mp4', 'c.mp4', 'notes.md']);
  });

  it('직속 사진도 한 묶음은 moonMax 까지 — 위성 목록에서 빠진 것은 파일 노드로 남는다', () => {
    const graph = makeGraph();
    const total = CONSTELLATION.moonMax + 4;
    for (let i = 1; i <= total; i += 1) touch(graph, `many/p${String(i).padStart(2, '0')}.png`, 'png', 'Read');
    const names = satelliteNames(graph, 'many');
    expect(names).toHaveLength(CONSTELLATION.moonMax);
    expect(names).toContain(`p${String(total).padStart(2, '0')}.png`);
    expect(names).not.toContain('p01.png');
    // 파일 노드는 그대로다 — 폴더 안(children)에는 전부 있다.
    const snap = graph.getSnapshot();
    const many = snap.topFolders.find((b) => b.label === 'many')!;
    expect((snap.children[many.id] ?? []).filter((b) => b.bubbleType === 'file')).toHaveLength(total);
  });

  it('한 묶음은 moonMax 까지 — 그보다 오래된 구성은 위성 목록에서 빠진다', () => {
    const graph = makeGraph();
    touch(graph, 'media/clips/c0.mp4', 'mp4', 'Read');
    expect(graph.setFolderMaxSatellites('media', 1)).toBe(true);
    for (let i = 1; i < CONSTELLATION.moonMax + 3; i += 1) touch(graph, `media/clips/c${i}.mp4`, 'mp4', 'Read');
    const names = satelliteNames(graph, 'media');
    expect(names).toHaveLength(CONSTELLATION.moonMax);
    expect(names).not.toContain('c0.mp4');
    expect(names).toContain(`c${CONSTELLATION.moonMax + 2}.mp4`);
  });

  it('다른 종류는 한 자리가 아니고, 내용 언급을 기다리지 않고 바로 줄인다(파일 중심 별자리 폐기)', () => {
    const graph = makeGraph();
    touch(graph, 'video/out.mp4', 'mp4', 'Read');
    expect(graph.setFolderMaxSatellites('video', 1)).toBe(true);
    // 종전: 코드가 영상을 적고 있을 수 있어 언급을 다 읽을 때까지 둘을 함께 남겼다. 이제 영상과 코드는 한 묶음이 아니다.
    touch(graph, 'video/render.ts', 'const output = "out.mp4";');
    expect(satelliteNames(graph, 'video')).toEqual(['render.ts']);
  });

  it('옛 판정으로 저장된 위성 목록은 실을 때 지금 상한으로 맞춘다 — 같은 종류 묶음은 그대로 남는다', () => {
    const graph = makeGraph();
    const loose = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'];
    for (const n of loose) touch(graph, `media/${n}`);
    touch(graph, 'media/clips/x.mp4', 'mp4', 'Read');
    touch(graph, 'media/clips/y.mp4', 'mp4', 'Read');
    const cp = graph.toProjectCheckpoint(projName);
    // 옛 판정(파일 중심 별자리 = 한 자리)이 남긴 상한 넘침을 흉내 낸다 — 오래된 것부터 여덟 개가 모두 위성 목록에 있다.
    cp.graph.hierarchy.satelliteMap['media'] = [...loose.map((n) => `media/${n}`), 'media/clips/x.mp4', 'media/clips/y.mp4'];
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(cp);
    // 기본 상한 다섯 자리: [clips 영상 묶음] + 최근 낱자리 넷(c~f). 파일 노드는 그대로다(목록만 줄었다).
    expect(satelliteNames(restored, 'media')).toEqual(['c.ts', 'd.ts', 'e.ts', 'f.ts', 'x.mp4', 'y.mp4']);
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

describe('묶음의 폴더 · 같은 종류 사용 수 — 스냅샷 사본에만 (2026-10-22)', () => {
  it('직속 사진 위성에 그 폴더의 노드 id 와 위성 상한으로 빠진 것까지 센 수가 실린다', () => {
    const graph = makeGraph();
    const total = CONSTELLATION.moonMax + 4;
    for (let i = 1; i <= total; i += 1) touch(graph, `many/p${String(i).padStart(2, '0')}.png`, 'png', 'Read');
    touch(graph, 'many/readme.md');
    const snap = graph.getSnapshot();
    const many = snap.topFolders.find((b) => b.label === 'many')!;
    const sats = snap.satellites[many.id] ?? [];
    const pngs = sats.filter((b) => b.label.endsWith('.png'));
    expect(pngs.length).toBe(CONSTELLATION.moonMax);
    for (const b of pngs) {
      expect(b.folderNodeId).toBe(many.id);
      expect(b.folderKindCount).toBe(total);
    }
    // 미디어가 아닌 파일에는 싣지 않는다(묶이지 않는다).
    const md = sats.find((b) => b.label === 'readme.md');
    expect(md?.folderNodeId).toBeUndefined();
    expect(md?.folderKindCount).toBeUndefined();
  });

  it('하위 폴더에서 올라온 위성은 그 하위 폴더의 id 와 수를 싣는다', () => {
    const graph = makeGraph();
    for (const n of ['c1', 'c2', 'c3']) touch(graph, `media/clips/${n}.mp4`, 'mp4', 'Read');
    const snap = graph.getSnapshot();
    const media = snap.topFolders.find((b) => b.label === 'media')!;
    const clips = (snap.children[media.id] ?? []).find((b) => b.label === 'clips')!;
    expect(clips).toBeDefined();
    const sats = snap.satellites[media.id] ?? [];
    expect(sats).toHaveLength(3);
    for (const b of sats) {
      expect(b.folderNodeId).toBe(clips.id);
      expect(b.folderKindCount).toBe(3);
    }
  });

  it('표시 전용 — 체크포인트의 노드에는 실리지 않는다', () => {
    const graph = makeGraph();
    touch(graph, 'many/a.png', 'png', 'Read');
    touch(graph, 'many/b.png', 'png', 'Read');
    graph.getSnapshot();
    const cp = graph.toProjectCheckpoint(projName);
    for (const node of Object.values(cp.graph.nodes)) {
      expect(node.folderNodeId).toBeUndefined();
      expect(node.folderKindCount).toBeUndefined();
    }
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
