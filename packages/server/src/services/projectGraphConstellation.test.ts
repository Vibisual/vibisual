import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BubbleData } from '@vibisual/shared';
import { BUNDLE_BUBBLE, CONSTELLATION } from '@vibisual/shared';
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

/** 파일을 디스크에 만들고 그 파일을 만진 훅 한 방(사후)을 보낸다. `session` 이 그 파일을 쓴 에이전트(훅 세션)다. */
function touch(graph: ProjectGraph, rel: string, body = 'x', toolName = 'Write', session = SESSION): void {
  const abs = path.join(projRoot, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, 'utf8');
  toolSeq += 1;
  graph.processHookEvent({
    session_id: session,
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
  const listed = snap.satellites[folder.id] ?? [];
  const all = new Map(listed.map((node) => [node.id, node]));
  for (const kind of ['video', 'image', 'audio', 'model', 'doc', 'code'] as const) {
    for (let page = 0; ; page++) {
      const result = graph.getBundleFiles(folder.id, kind, SESSION, page);
      for (const node of result?.items ?? []) all.set(node.id, node);
      if (!result || (page + 1) * BUNDLE_BUBBLE.interiorMax >= result.total) break;
    }
  }
  return [...all.values()].map((node) => node.label).sort();
}

function findSatellite(graph: ProjectGraph, label: string): BubbleData | undefined {
  const snap = graph.getSnapshot();
  return Object.values(snap.satellites).flat().find((b) => b.label === label);
}

describe('일반 문서 상한과 별개인 미리보기 위성', () => {
  it('하위 폴더 영상은 일반 문서 상한을 쓰지 않는다', () => {
    const graph = makeGraph();
    touch(graph, 'media/clips/a.mp4', 'mp4', 'Read');
    expect(graph.setFolderMaxSatellites('media', 2)).toBe(true);
    touch(graph, 'media/x.ts');
    touch(graph, 'media/clips/b.mp4', 'mp4', 'Read');
    touch(graph, 'media/clips/c.mp4', 'mp4', 'Read');
    touch(graph, 'media/y.ts');
    expect(satelliteNames(graph, 'media')).toEqual(['a.mp4', 'b.mp4', 'c.mp4', 'x.ts', 'y.ts']);
  });

  it('폴더의 직속 미리보기 파일도 모두 남는다', () => {
    const graph = makeGraph();
    touch(graph, 'video/a.mp4', 'mp4', 'Read');
    expect(graph.setFolderMaxSatellites('video', 2)).toBe(true);
    touch(graph, 'video/b.mp4', 'mp4', 'Read');
    touch(graph, 'video/c.mp4', 'mp4', 'Read');
    touch(graph, 'video/notes.md');
    expect(satelliteNames(graph, 'video')).toEqual(['a.mp4', 'b.mp4', 'c.mp4', 'notes.md']);
  });

  it('직속 사진은 묶음 표시 상한보다 많아도 서버 목록에 모두 남는다', () => {
    const graph = makeGraph();
    const total = CONSTELLATION.moonMax + 4;
    for (let i = 1; i <= total; i += 1) touch(graph, `many/p${String(i).padStart(2, '0')}.png`, 'png', 'Read');
    const names = satelliteNames(graph, 'many');
    expect(names).toHaveLength(total);
    expect(names).toContain(`p${String(total).padStart(2, '0')}.png`);
    expect(names).toContain('p01.png');
    const snap = graph.getSnapshot();
    const many = snap.topFolders.find((b) => b.label === 'many')!;
    expect(graph.getBundleFiles(many.id, 'image', SESSION)?.total).toBe(total);
  });

  it('오래된 미리보기 구성도 일반 문서 상한에서 제외한다', () => {
    const graph = makeGraph();
    touch(graph, 'media/clips/c0.mp4', 'mp4', 'Read');
    expect(graph.setFolderMaxSatellites('media', 1)).toBe(true);
    for (let i = 1; i < CONSTELLATION.moonMax + 3; i += 1) touch(graph, `media/clips/c${i}.mp4`, 'mp4', 'Read');
    const names = satelliteNames(graph, 'media');
    expect(names).toHaveLength(CONSTELLATION.moonMax + 3);
    expect(names).toContain('c0.mp4');
    expect(names).toContain(`c${CONSTELLATION.moonMax + 2}.mp4`);
  });

  it('일반 문서 한 자리와 별도로 단일 영상도 유지한다', () => {
    const graph = makeGraph();
    touch(graph, 'video/out.mp4', 'mp4', 'Read');
    expect(graph.setFolderMaxSatellites('video', 1)).toBe(true);
    touch(graph, 'video/render.ts', 'const output = "out.mp4";');
    expect(satelliteNames(graph, 'video')).toEqual(['out.mp4', 'render.ts']);
  });

  it('옛 판정으로 저장된 위성 목록은 실을 때 지금 상한으로 맞춘다 — 같은 종류 묶음은 그대로 남는다', () => {
    const graph = makeGraph();
    const loose = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'];
    for (const n of loose) touch(graph, `media/${n}`);
    touch(graph, 'media/clips/x.mp4', 'mp4', 'Read');
    touch(graph, 'media/clips/y.mp4', 'mp4', 'Read');
    const cp = graph.toProjectCheckpoint(projName);
    cp.graph.hierarchy.satelliteMap['media'] = [...loose.map((n) => `media/${n}`), 'media/clips/x.mp4', 'media/clips/y.mp4'];
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(cp);
    expect(satelliteNames(restored, 'media')).toEqual(['e.ts', 'f.ts', 'x.mp4', 'y.mp4']);
  });

  it('묶이지 않은 파일들은 종전처럼 오래된 것부터 빠진다', () => {
    const graph = makeGraph();
    touch(graph, 'video/one.ts');
    expect(graph.setFolderMaxSatellites('video', 2)).toBe(true);
    touch(graph, 'video/two.ts');
    touch(graph, 'video/three.ts');
    expect(satelliteNames(graph, 'video')).toEqual(['three.ts', 'two.ts']);
  });

  it('하위 폴더가 달라도 같은 종류는 한 자리다 — 사진 속 `.vibisual` 처럼 png 다섯이 다섯 폴더에 흩어져도(2026-10-26)', () => {
    const graph = makeGraph();
    touch(graph, 'assets/old.md');
    for (const n of [1, 2, 3, 4, 5]) touch(graph, `assets/attachments/s${n}/shot-${n}.png`, 'png', 'Read');
    touch(graph, 'assets/new.md');
    expect(satelliteNames(graph, 'assets')).toEqual(['new.md', 'old.md', 'shot-1.png', 'shot-2.png', 'shot-3.png', 'shot-4.png', 'shot-5.png']);
  });
});

describe('묶음의 폴더 · 같은 종류 사용 수 · 공통 폴더 — 스냅샷 사본에만 (주인 폴더 기준)', () => {
  it('직속 사진 위성에 그 폴더의 노드 id 와 위성 상한으로 빠진 것까지 센 수가 실린다', () => {
    const graph = makeGraph();
    const total = CONSTELLATION.moonMax + 4;
    for (let i = 1; i <= total; i += 1) touch(graph, `many/p${String(i).padStart(2, '0')}.png`, 'png', 'Read');
    touch(graph, 'many/readme.md');
    const snap = graph.getSnapshot();
    const many = snap.topFolders.find((b) => b.label === 'many')!;
    const sats = snap.satellites[many.id] ?? [];
    const pngs = sats.filter((b) => b.label.endsWith('.png'));
    expect(pngs.length).toBe(BUNDLE_BUBBLE.minMembers);
    for (const b of pngs) {
      expect(b.folderNodeId).toBe(many.id);
      expect(b.folderKindCount).toBe(total);
      expect(b.folderKindDir).toBe('many');
    }
    const md = sats.find((b) => b.label === 'readme.md');
    expect(md?.folderNodeId).toBeUndefined();
    expect(md?.folderKindCount).toBeUndefined();
    expect(md?.folderKindDir).toBeUndefined();
  });

  it('하위 폴더에서 올라온 위성은 그 위성을 거느린 폴더(주인)의 id 와 그 아래 전부의 수 · 함께 든 폴더를 싣는다', () => {
    const graph = makeGraph();
    for (const n of ['c1', 'c2', 'c3']) touch(graph, `media/clips/${n}.mp4`, 'mp4', 'Read');
    const snap = graph.getSnapshot();
    const media = snap.topFolders.find((b) => b.label === 'media')!;
    const clips = (snap.children[media.id] ?? []).find((b) => b.label === 'clips')!;
    expect(clips).toBeDefined();
    const sats = snap.satellites[media.id] ?? [];
    expect(sats).toHaveLength(BUNDLE_BUBBLE.minMembers);
    for (const b of sats) {
      expect(b.folderNodeId).toBe(media.id);
      expect(b.folderKindCount).toBe(3);
      expect(b.folderKindDir).toBe('media/clips'); // 이름은 `clips` — 종전 이름 그대로
    }
    for (const b of snap.satellites[clips.id] ?? []) expect(b.folderNodeId).toBe(clips.id);
  });

  it('흩어진 하위 폴더의 같은 종류는 그 위 폴더 이름으로, 수는 위성 상한으로 빠진 것까지 그 아래 전부다', () => {
    const graph = makeGraph();
    const total = CONSTELLATION.moonMax + 3;
    for (let i = 1; i <= total; i += 1) touch(graph, `assets/attachments/s${i}/shot.png`, 'png', 'Read');
    const snap = graph.getSnapshot();
    const assets = snap.topFolders.find((b) => b.label === 'assets')!;
    const pngs = (snap.satellites[assets.id] ?? []).filter((b) => b.label === 'shot.png');
    expect(pngs).toHaveLength(BUNDLE_BUBBLE.minMembers);
    for (const b of pngs) {
      expect(b.folderNodeId).toBe(assets.id);
      expect(b.folderKindCount).toBe(total);
      expect(b.folderKindDir).toBe('assets/attachments');
    }
  });

  it('스냅샷은 대표만 싣고 페이지 조회는 전체 구성에 접근한다', () => {
    const graph = makeGraph();
    const total = CONSTELLATION.moonMax + 5;
    for (let i = 1; i <= total; i += 1) touch(graph, `assets/attachments/s${i}/shot.png`, 'png', 'Read');
    touch(graph, 'assets/notes.md');
    const base = graph.getSnapshot();
    const assets = base.topFolders.find((b) => b.label === 'assets')!;
    const pngsOf = (snap: ReturnType<ProjectGraph['getSnapshot']>): BubbleData[] =>
      (snap.satellites[assets.id] ?? []).filter((b) => b.label === 'shot.png');
    expect(pngsOf(base)).toHaveLength(BUNDLE_BUBBLE.minMembers);
    expect(pngsOf(graph.getSnapshot(new Set()))).toHaveLength(BUNDLE_BUBBLE.minMembers);
    const scoped = graph.getSnapshot(new Set([assets.id]));
    const all = pngsOf(scoped);
    expect(all).toHaveLength(BUNDLE_BUBBLE.minMembers);
    expect(graph.getBundleFiles(assets.id, 'image', SESSION)?.items).toHaveLength(total);
    expect(new Set(all.map((b) => b.id)).size).toBe(all.length);
    for (const b of all) expect([b.folderNodeId, b.folderKindCount]).toEqual([assets.id, total]);
    expect((scoped.satellites[assets.id] ?? []).filter((b) => b.label === 'notes.md')).toHaveLength(1);
  });

  it('표시 전용 — 체크포인트의 노드에는 실리지 않는다', () => {
    const graph = makeGraph();
    touch(graph, 'many/a.png', 'png', 'Read');
    touch(graph, 'many/b.png', 'png', 'Read');
    const snap = graph.getSnapshot();
    expect(Object.values(snap.satellites).flat().some((b) => b.inOpenTurn === true)).toBe(true);
    const cp = graph.toProjectCheckpoint(projName);
    for (const node of Object.values(cp.graph.nodes)) {
      expect(node.folderNodeId).toBeUndefined();
      expect(node.folderKindCount).toBeUndefined();
      expect(node.folderKindDir).toBeUndefined();
      expect(node.inOpenTurn).toBeUndefined();
    }
  });
});

describe('턴은 서버 장부다 — 새 명령이 열고 캔버스·IDE 확인이 닫는다(확인한 앞 턴의 그림은 묶음에 남지 않는다)', () => {
  const S = 'sess-turn-ledger';
  /** 스냅샷 어디든(위성·자식) 턴 표시가 붙은 그림 이름. */
  const turnPngs = (graph: ProjectGraph, scope: ReadonlySet<string> | null = null): string[] => {
    const snap = graph.getSnapshot(scope);
    const all = [...Object.values(snap.satellites).flat(), ...Object.values(snap.children).flat()];
    return [...new Set(all.filter((b) => b.label.endsWith('.png') && b.inOpenTurn === true).map((b) => b.label))].sort();
  };
  /** 스냅샷 어디든(위성·자식) 선 그림 이름 — 턴 표시와 무관하게. */
  const shownPngs = (graph: ProjectGraph): string[] => {
    const snap = graph.getSnapshot();
    const all = [...Object.values(snap.satellites).flat(), ...Object.values(snap.children).flat()];
    return [...new Set(all.filter((b) => b.label.endsWith('.png')).map((b) => b.label))].sort();
  };
  const savedPngs = (graph: ProjectGraph): string[] =>
    Object.keys(graph.toProjectCheckpoint(projName).graph.nodes).filter((p) => p.endsWith('.png')).map((p) => path.basename(p)).sort();
  /** 앞 명령에 그림 `prev` 장을 쓰고 끝낸 뒤(빨강이 걷기 없이 유휴로 — 소유 기록은 남는다), 새 문장이 연 턴에 그림 `fresh` 장. */
  const twoCommands = (graph: ProjectGraph, prev: number, fresh: number): string => {
    for (let i = 1; i <= prev; i += 1) touch(graph, `assets/attachments/sub-a/a${i}.png`, 'png', 'Read', S);
    const agentId = graph.getAgentBySession(S)!.id;
    graph.endAgentPromptTurn(agentId);
    graph.markAgentIdle(S); // 끝난 빨강의 60초 자동 유휴(`expireCompletedAgents`) — 확인이 아니라 걷지 않는다
    expect(graph.beginAgentPromptTurn(agentId)).toBe(true);
    for (let i = 1; i <= fresh; i += 1) touch(graph, `assets/attachments/sub-b/b${i}.png`, 'png', 'Read', S);
    return agentId;
  };

  it('확인 없이 이어 보낸 명령 — 새 명령이 지난 명령의 그림을 묶음 수·대표·턴 표시에서 뺀다', () => {
    const graph = makeGraph();
    twoCommands(graph, 3, 2);

    const snap = graph.getSnapshot();
    const assets = snap.topFolders.find((b) => b.label === 'assets')!;
    const listed = (snap.satellites[assets.id] ?? []).filter((b) => b.label.endsWith('.png'));
    expect(listed.map((b) => b.label).sort()).toEqual(['b1.png', 'b2.png']);
    for (const b of listed) expect(b.folderKindCount).toBe(2); // 지난 명령의 a1~a3 은 세지 않는다
    expect(graph.getBundleFiles(assets.id, 'image')?.total).toBe(2);
    expect(turnPngs(graph)).toEqual(['b1.png', 'b2.png']);
    expect(turnPngs(graph, new Set([assets.id]))).toEqual(['b1.png', 'b2.png']);
    expect(savedPngs(graph)).toEqual(['a1.png', 'a2.png', 'a3.png', 'b1.png', 'b2.png']); // 노드는 확인·TTL 이 걷는다
  });

  it('IDE 확인은 그 턴의 그림을 묶음에서 빼고, 처리 중 확인과 덧말은 턴을 닫지 않는다', () => {
    const graph = makeGraph();
    const agentId = twoCommands(graph, 1, 2);
    expect(graph.acknowledgeAgentTurn(agentId)).toBe(false);
    expect(graph.beginAgentPromptTurn(agentId)).toBe(false);
    expect(turnPngs(graph)).toEqual(['b1.png', 'b2.png']);
    graph.endAgentPromptTurn(agentId);
    expect(graph.acknowledgeAgentTurn(agentId)).toBe(true);
    expect(turnPngs(graph)).toEqual([]);
    expect(shownPngs(graph)).toEqual([]);
    const assets = graph.getSnapshot().topFolders.find((b) => b.label === 'assets')!;
    expect(graph.getBundleFiles(assets.id, 'image')?.total).toBe(0);
    expect(savedPngs(graph)).toEqual(expect.arrayContaining(['b1.png', 'b2.png'])); // 캔버스 확인과 달리 노드는 지우지 않는다
  });

  it('같은 에이전트에 처리 중인 턴이 있으면 새 명령은 이어 붙고, 없으면 지난 턴을 닫는다(커스텀 발송 자리)', () => {
    const graph = makeGraph();
    for (let i = 1; i <= 2; i += 1) touch(graph, `assets/attachments/sub-a/a${i}.png`, 'png', 'Read', S);
    const agentId = graph.getAgentBySession(S)!.id;
    expect(graph.beginAgentTurn(agentId, true)).toBe(false);
    expect(turnPngs(graph)).toEqual(['a1.png', 'a2.png']);
    expect(graph.beginAgentTurn(agentId, false)).toBe(true);
    expect(turnPngs(graph)).toEqual([]);
  });

  it('캔버스 확인은 그 턴을 닫고, 그 에이전트 혼자 쓴 그림과 폴더를 바로 걷는다', () => {
    const graph = makeGraph();
    twoCommands(graph, 1, 2);
    graph.markAgentIdle(S, true);
    expect(turnPngs(graph)).toEqual([]);
    expect(shownPngs(graph)).toEqual([]);
    expect(savedPngs(graph)).toEqual([]);
    expect(graph.getSnapshot().topFolders.some((b) => b.label === 'assets')).toBe(false);
  });

  it('캔버스 확인은 다른 활성 에이전트가 함께 쓰는 그림은 남긴다', () => {
    const graph = makeGraph();
    touch(graph, 'assets/shared.png', 'png', 'Read', S);
    touch(graph, 'assets/mine.png', 'png', 'Read', S);
    touch(graph, 'assets/shared.png', 'png', 'Read', 'sess-turn-other');
    graph.markAgentIdle(S, true);
    expect(savedPngs(graph)).toEqual(['shared.png']);
    expect(shownPngs(graph)).toEqual(['shared.png']);
  });

  it('장부는 체크포인트로 저장돼 다시 켜도 지금 턴이 그대로이고, 칸이 없는 옛 저장분은 빈 장부로 시작한다', () => {
    const graph = makeGraph();
    twoCommands(graph, 2, 2);
    const cp = graph.toProjectCheckpoint(projName);
    const saved = Object.values(cp.graph.refs.agentTurnNodes ?? {}).flat().filter((p) => p.endsWith('.png'));
    expect(saved.length).toBe(2);
    expect(saved.every((p) => p.includes('sub-b'))).toBe(true);

    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(cp);
    expect(turnPngs(restored)).toEqual(['b1.png', 'b2.png']);

    const legacy = structuredClone(cp);
    delete legacy.graph.refs.agentTurnNodes;
    const old = new ProjectGraph();
    old.restoreFromCheckpoint(legacy);
    expect(turnPngs(old)).toEqual([]); // 종전 판정이면 소유 기록이 남은 a1~b2 넷이 다 턴이었다
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
