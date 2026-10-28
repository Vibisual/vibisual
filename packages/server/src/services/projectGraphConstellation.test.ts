/**
 * §5.1 #2-1 (C)(D) — 별자리 서버 몫: ① 위성 상한은 자리 수 — 한 무리의 같은 미디어 종류(하위 폴더·직속 무관)는 한 자리(`moonMax` 까지), 다른 종류는 낱자리
 * ①-1 미디어 위성 사본의 묶음 정보(주인 폴더 id·그 아래 같은 종류 사용 수·함께 든 가장 가까운 폴더, 범위로 선언된 폴더는 그 아래 전부가 위성 목록에)
 * ② 글 언급은 비동기로 `mentions` 에, 다 읽으면 알림 ③ 파일 위성에 `fileMtime`. ①-1·②·③ 은 표시 전용이라 체크포인트에 안 실린다.
 */
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
  return (snap.satellites[folder.id] ?? []).map((b) => b.label).sort();
}

function findSatellite(graph: ProjectGraph, label: string): BubbleData | undefined {
  const snap = graph.getSnapshot();
  return Object.values(snap.satellites).flat().find((b) => b.label === label);
}

describe('위성 상한 — 같은 종류 묶음은 한 자리', () => {
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

  it('폴더의 직속 파일도 같은 종류면 한 자리로 함께 남는다', () => {
    const graph = makeGraph();
    touch(graph, 'video/a.mp4', 'mp4', 'Read');
    expect(graph.setFolderMaxSatellites('video', 2)).toBe(true);
    touch(graph, 'video/b.mp4', 'mp4', 'Read');
    touch(graph, 'video/c.mp4', 'mp4', 'Read');
    touch(graph, 'video/notes.md');
    // 자리: [video 의 영상 a·b·c] · notes.md → 상한 2 안(직속 영상도 한 자리).
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
    // 옛 판정이 남긴 상한 넘침을 흉내 낸다 — 여덟 개가 모두 위성 목록에 있다.
    cp.graph.hierarchy.satelliteMap['media'] = [...loose.map((n) => `media/${n}`), 'media/clips/x.mp4', 'media/clips/y.mp4'];
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(cp);
    // 기본 상한 두 자리: [clips 영상 묶음] + 최근 낱자리 하나(f). 파일 노드는 그대로다(목록만 줄었다).
    expect(satelliteNames(restored, 'media')).toEqual(['f.ts', 'x.mp4', 'y.mp4']);
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
    // 기본 상한 두 자리: [png 다섯 — 한 자리] + 최근 글(new.md).
    expect(satelliteNames(graph, 'assets')).toEqual(['new.md', 'shot-1.png', 'shot-2.png', 'shot-3.png', 'shot-4.png', 'shot-5.png']);
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
    expect(pngs.length).toBe(CONSTELLATION.moonMax);
    for (const b of pngs) {
      expect(b.folderNodeId).toBe(many.id);
      expect(b.folderKindCount).toBe(total);
      expect(b.folderKindDir).toBe('many');
    }
    // 미디어가 아닌 파일에는 싣지 않는다(묶이지 않는다).
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
    expect(sats).toHaveLength(3);
    for (const b of sats) {
      expect(b.folderNodeId).toBe(media.id);
      expect(b.folderKindCount).toBe(3);
      expect(b.folderKindDir).toBe('media/clips'); // 이름은 `clips` — 종전 이름 그대로
    }
    // 같은 파일이 `clips` 의 위성일 때는 `clips` 가 주인이다(사본마다 따로 싣는다).
    for (const b of snap.satellites[clips.id] ?? []) expect(b.folderNodeId).toBe(clips.id);
  });

  it('흩어진 하위 폴더의 같은 종류는 그 위 폴더 이름으로, 수는 위성 상한으로 빠진 것까지 그 아래 전부다', () => {
    const graph = makeGraph();
    const total = CONSTELLATION.moonMax + 3;
    for (let i = 1; i <= total; i += 1) touch(graph, `assets/attachments/s${i}/shot.png`, 'png', 'Read');
    const snap = graph.getSnapshot();
    const assets = snap.topFolders.find((b) => b.label === 'assets')!;
    const pngs = (snap.satellites[assets.id] ?? []).filter((b) => b.label === 'shot.png');
    expect(pngs).toHaveLength(CONSTELLATION.moonMax);
    for (const b of pngs) {
      expect(b.folderNodeId).toBe(assets.id);
      expect(b.folderKindCount).toBe(total);
      expect(b.folderKindDir).toBe('assets/attachments');
    }
  });

  it('범위로 선언된 폴더(묶음 안)에만 그 아래 같은 종류 전부를 덧붙인다 — 선언하지 않으면 목록은 그대로다', () => {
    const graph = makeGraph();
    const total = CONSTELLATION.moonMax + 5;
    for (let i = 1; i <= total; i += 1) touch(graph, `assets/attachments/s${i}/shot.png`, 'png', 'Read');
    touch(graph, 'assets/notes.md');
    const base = graph.getSnapshot();
    const assets = base.topFolders.find((b) => b.label === 'assets')!;
    const pngsOf = (snap: ReturnType<ProjectGraph['getSnapshot']>): BubbleData[] =>
      (snap.satellites[assets.id] ?? []).filter((b) => b.label === 'shot.png');
    // 전량(선언 없음)·메인 화면(빈 선언) — 위성 상한이 남긴 것만.
    expect(pngsOf(base)).toHaveLength(CONSTELLATION.moonMax);
    expect(pngsOf(graph.getSnapshot(new Set()))).toHaveLength(CONSTELLATION.moonMax);
    // 묶음 안 — 주인 폴더를 선언하면 그 아래 사진 전부(상한 interiorMax 안), 각자 같은 수를 싣는다. 다른 종류는 덧붙지 않는다.
    const scoped = graph.getSnapshot(new Set([assets.id]));
    const all = pngsOf(scoped);
    expect(all).toHaveLength(Math.min(total, BUNDLE_BUBBLE.interiorMax));
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

describe('묶음은 아직 확인하지 않은 턴에 쓴 것만 — 그 에이전트가 이번 턴에 쓴 것만 담고 전부 모으지 않는다', () => {
  const shotsOf = (snap: ReturnType<ProjectGraph['getSnapshot']>, folderId: string): BubbleData[] =>
    (snap.satellites[folderId] ?? []).filter((b) => b.label === 'shot.png');

  it('다시 읽어 들여 살아난 지난 턴의 그림은 수 · 묶음 안 · 턴 표시에서 빠진다 — 사진 속 `.vibisual` 경우', () => {
    const graph = makeGraph();
    const past = 6;
    for (let i = 1; i <= past; i += 1) touch(graph, `assets/attachments/old${i}/shot.png`, 'png', 'Read');
    const cp = graph.toProjectCheckpoint(projName);
    // 소유 기록이 빈 지난 턴의 그림(실측 png 227장 중 기록이 남은 것 15장).
    //   복원은 모든 버블에 5분 유예를 다시 주므로 이것도 산다.
    for (const key of Object.keys(cp.graph.refs.nodeAgentRefs)) {
      if (key.includes('/old')) cp.graph.refs.nodeAgentRefs[key] = [];
    }
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(cp);
    const fresh = CONSTELLATION.moonMax + 2;
    for (let i = 1; i <= fresh; i += 1) touch(restored, `assets/attachments/new${i}/shot.png`, 'png', 'Read');

    const full = restored.getSnapshot();
    const assets = full.topFolders.find((b) => b.label === 'assets')!;
    const shown = shotsOf(full, assets.id);
    expect(shown).toHaveLength(CONSTELLATION.moonMax);
    for (const b of shown) {
      expect(b.path).toContain('/new');
      expect(b.inOpenTurn).toBe(true);
      expect(b.folderKindCount).toBe(fresh); // 종전: 살아 있는 것 전부(past + fresh)
    }
    // 지난 턴 그림은 살아 있지만(유예) 턴 표시가 없다 — 화면이 묶음 안에서 자식을 훑을 때 이것으로 거른다.
    const pastFiles = Object.values(full.children).flat().filter((b) => b.bubbleType === 'file' && b.path.includes('/old'));
    expect(pastFiles).toHaveLength(past);
    for (const b of pastFiles) expect(b.inOpenTurn).toBeUndefined();

    // 묶음 안 — 주인 폴더를 선언해도 턴의 것만 덧붙는다.
    const inside = shotsOf(restored.getSnapshot(new Set([assets.id])), assets.id);
    expect(inside).toHaveLength(fresh);
    expect(inside.every((b) => b.path.includes('/new'))).toBe(true);
  });

  it('두 에이전트의 턴은 합치고, 한쪽을 확인하면 핀으로 남은 그쪽 그림도 묶음에서 빠진다', () => {
    const graph = makeGraph();
    // A 의 그림은 B 와 함께 쓰는 `assets` 바로 아래 — A 혼자 쓴 하위 폴더에 두면 확인 때 폴더째 걷혀 핀도 함께 사라진다(§2.4 cascade).
    touch(graph, 'assets/a1.png', 'png', 'Read', 'sess-turn-a');
    touch(graph, 'assets/a2.png', 'png', 'Read', 'sess-turn-a');
    const fresh = CONSTELLATION.moonMax;
    for (let i = 1; i <= fresh; i += 1) touch(graph, `assets/b${i}/shot.png`, 'png', 'Read', 'sess-turn-b');
    const pngsOf = (snap: ReturnType<ProjectGraph['getSnapshot']>, folderId: string): BubbleData[] =>
      (snap.satellites[folderId] ?? []).filter((b) => b.label.endsWith('.png'));

    const before = graph.getSnapshot();
    const assets = before.topFolders.find((b) => b.label === 'assets')!;
    // 위성 목록은 최근 B 의 것뿐이지만 수는 두 턴을 합친다.
    expect(pngsOf(before, assets.id).every((b) => b.label === 'shot.png')).toBe(true);
    for (const b of pngsOf(before, assets.id)) expect(b.folderKindCount).toBe(2 + fresh);

    // A 의 그림 하나를 고정한 뒤 A 를 확인한다 — 고정한 버블은 남지만(§2.4) 그 턴은 닫혔다.
    const pinned = (before.children[assets.id] ?? []).find((b) => b.label === 'a1.png')!;
    expect(graph.togglePreservePinned(pinned.id)).toBe(true);
    graph.markAgentIdle('sess-turn-a', true);

    const after = graph.getSnapshot();
    const kept = (after.children[assets.id] ?? []).find((b) => b.id === pinned.id);
    expect(kept).toBeDefined();
    expect(kept!.inOpenTurn).toBeUndefined();
    expect((after.children[assets.id] ?? []).some((b) => b.label === 'a2.png')).toBe(false); // 고정 안 한 A 그림은 확인 때 걷혔다
    for (const b of pngsOf(after, assets.id)) expect(b.folderKindCount).toBe(fresh); // 종전: 고정한 A 그림까지 fresh + 1
    expect(pngsOf(graph.getSnapshot(new Set([assets.id])), assets.id).map((b) => b.id)).not.toContain(pinned.id);
  });
});

describe('턴은 서버 장부다 — 새 명령이 열고 캔버스·IDE 확인이 닫는다(확인한 앞 턴의 것은 새 묶음에 남지 않는다)', () => {
  const S = 'sess-turn-ledger';
  /** 스냅샷 어디든(위성·자식) 턴 표시가 붙은 그림 이름. */
  const turnPngs = (graph: ProjectGraph, scope: ReadonlySet<string> | null = null): string[] => {
    const snap = graph.getSnapshot(scope);
    const all = [...Object.values(snap.satellites).flat(), ...Object.values(snap.children).flat()];
    return [...new Set(all.filter((b) => b.label.endsWith('.png') && b.inOpenTurn === true).map((b) => b.label))].sort();
  };
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

  it('확인 없이 이어 보낸 명령 — 새 명령이 지난 명령의 그림을 수 · 턴 표시 · 묶음 안에서 뺀다(사진 속 경우)', () => {
    const graph = makeGraph();
    twoCommands(graph, 3, 2);

    const snap = graph.getSnapshot();
    const assets = snap.topFolders.find((b) => b.label === 'assets')!;
    const listed = (snap.satellites[assets.id] ?? []).filter((b) => b.label.endsWith('.png'));
    expect(listed.length).toBe(5); // 위성 목록은 그대로 다섯(한 묶음 moonMax 까지) — 화면이 턴 표시로 구성을 거른다
    for (const b of listed) expect(b.folderKindCount).toBe(2); // 종전: 5 — 지난 명령의 그림까지 셌다
    expect(turnPngs(graph)).toEqual(['b1.png', 'b2.png']); // 종전: a1~a3 까지
    expect(turnPngs(graph, new Set([assets.id]))).toEqual(['b1.png', 'b2.png']);
  });

  it('IDE 에서 확인하면 묶음에서만 빠진다 — 버블은 그대로, 턴 도중의 확인과 덧말은 그 턴을 닫지 않는다', () => {
    const graph = makeGraph();
    const agentId = twoCommands(graph, 1, 2);
    // 턴 도중 — 확인도, 끼어든 문장도 그 턴을 닫지 않는다.
    expect(graph.acknowledgeAgentTurn(agentId)).toBe(false);
    expect(graph.beginAgentPromptTurn(agentId)).toBe(false);
    expect(turnPngs(graph)).toEqual(['b1.png', 'b2.png']);
    // 턴이 끝난 뒤의 확인은 닫는다.
    graph.endAgentPromptTurn(agentId);
    expect(graph.acknowledgeAgentTurn(agentId)).toBe(true);
    expect(turnPngs(graph)).toEqual([]);
    const snap = graph.getSnapshot();
    const files = [...Object.values(snap.children).flat()].filter((b) => b.label.endsWith('.png')).map((b) => b.label);
    expect(files).toEqual(expect.arrayContaining(['b1.png', 'b2.png'])); // 캔버스 확인과 달리 버블은 걷지 않는다
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

  it('캔버스 확인은 종전대로 그 턴을 닫는다', () => {
    const graph = makeGraph();
    twoCommands(graph, 1, 2);
    graph.markAgentIdle(S, true);
    expect(turnPngs(graph)).toEqual([]);
  });

  it('장부는 체크포인트로 저장돼 다시 켜도 지금 턴이 그대로이고, 칸이 없는 옛 저장분은 빈 장부로 시작한다', () => {
    const graph = makeGraph();
    twoCommands(graph, 2, 2);
    const cp = graph.toProjectCheckpoint(projName);
    // 장부는 소유 기록과 같은 자리에서 적어 그 턴에 함께 만진 폴더도 든다 — 그림은 이번 명령의 둘뿐이다.
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
