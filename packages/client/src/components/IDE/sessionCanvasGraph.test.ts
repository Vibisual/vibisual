import { describe, it, expect } from 'vitest';
import { DEFAULT_MAX_SATELLITES, WEB_SEARCH_HOST, type BubbleData, type SubAgentStreamEvent } from '@vibisual/shared';
import { collectSatellites } from '../../utils/satellite.js';
import { applyConstellations, bundleInfoOf, bundleInteriorMembers } from '../../utils/constellationView.js';
import { buildSessionBubbles } from './sessionBubbles.js';
import {
  SESSION_CENTER_NODE_ID,
  buildSessionCanvasGraph,
  canvasTwinIdOf,
  canvasToolOf,
  folderCrumbLabel,
  sessionCanvasEntryOf,
  type SessionCanvasGraph,
  type SessionCanvasInput,
} from './sessionCanvasGraph.js';

/** §5.5 #17-50 [버블] — 세션 모델이 캔버스 서버가 짓는 노드와 같은 모양으로 옮겨지는가(내부·외부 폴더 계층, 조상 위성, 노드 종류, 도구 이름 정규화). */

const S = 'sub-1';
const ROOT = 'C:/work/proj';
const AGENT = 'agent-1';
let seq = 0;
const ev = (
  ts: number,
  eventType: SubAgentStreamEvent['eventType'],
  extra: Partial<SubAgentStreamEvent> = {},
): SubAgentStreamEvent =>
  ({ id: `e${String(++seq)}`, subAgentId: S, parentAgentId: AGENT, timestamp: ts, content: '', eventType, ...extra }) as SubAgentStreamEvent;
const use = (ts: number, toolName: string, input: unknown, extra: Partial<SubAgentStreamEvent> = {}): SubAgentStreamEvent =>
  ev(ts, 'tool_use', { toolName, content: typeof input === 'string' ? input : JSON.stringify(input), ...extra });
const done = (ts: number, toolUseId: string): SubAgentStreamEvent => ev(ts, 'tool_result', { toolUseId, content: 'ok' });

const AGENT_NODE: BubbleData = {
  id: AGENT, label: 'Builder', bubbleType: 'agent', path: '', status: 'idle', activity: 3, customCreated: true, modelName: 'claude-opus',
};

function graphOf(events: SubAgentStreamEvent[], over: Partial<SessionCanvasInput> = {}): SessionCanvasGraph {
  const model = buildSessionBubbles({ streams: [{ events, commands: [] }], rootPath: over.rootPath === undefined ? ROOT : over.rootPath, platform: 'win32' });
  return buildSessionCanvasGraph({
    model,
    rootPath: ROOT,
    platform: 'win32',
    running: false,
    agentId: AGENT,
    sessionId: S,
    agent: AGENT_NODE,
    webSearchLabel: '웹 검색',
    ...over,
  });
}

const byLabel = (bubbles: readonly BubbleData[]): string[] => bubbles.map((b) => b.label);

describe('§5.5 #17-50 — 폴더는 캔버스와 같은 계층', () => {
  it('프로젝트 안은 첫 마디부터 — 최상위는 첫 마디 폴더와 루트 직속 파일, 안에는 하위 폴더·직속 파일', () => {
    const g = graphOf([
      use(10, 'Read', { file_path: `${ROOT}/packages/client/src/a.ts` }),
      use(20, 'Edit', { file_path: `${ROOT}/packages/server/b.ts`, old_string: 'x', new_string: 'y' }),
      use(30, 'Read', { file_path: `${ROOT}/README.md` }),
    ]);
    expect(g.top.map((b) => [b.label, b.bubbleType])).toEqual([
      ['packages', 'internal_folder'],
      ['README.md', 'file'],
    ]);
    const packages = g.top[0]!;
    expect(packages.path).toBe('packages');
    expect(packages.absolutePath).toBe(`${ROOT}/packages`);
    // 캔버스와 같은 셈 — 직속 자식 수(하위 폴더 둘) · 그 아래에서 만진 파일 수(둘).
    expect(packages.childCount).toBe(2);
    expect(packages.satelliteFileCount).toBe(2);
    expect(byLabel(g.folders[packages.id]!.children)).toEqual(['client', 'server']);
    const client = g.folders[packages.id]!.children[0]!;
    expect(byLabel(g.folders[client.id]!.children)).toEqual(['src']);
    expect(g.folders[client.id]!.parentId).toBe(packages.id);
  });

  it('만진 파일은 모든 조상의 위성이다 — 최근 것부터, 위성 상한까지(서버가 조상마다 다는 것과 같다)', () => {
    const files = Array.from({ length: DEFAULT_MAX_SATELLITES + 2 }, (_, i) => use(10 + i, 'Read', { file_path: `${ROOT}/src/deep/f${String(i)}.ts` }));
    const g = graphOf(files);
    const src = g.top[0]!;
    const sats = g.satellites[src.id]!;
    expect(sats).toHaveLength(DEFAULT_MAX_SATELLITES);
    expect(sats[0]!.label).toBe(`f${String(DEFAULT_MAX_SATELLITES + 1)}.ts`);
    const deep = g.folders[src.id]!.children[0]!;
    expect(g.satellites[deep.id]!.map((b) => b.id)).toEqual(sats.map((b) => b.id));
  });

  it('uses each folder document limit independently of its ancestor', () => {
    const files = Array.from({ length: 6 }, (_, i) => use(10 + i, 'Read', { file_path: `${ROOT}/src/deep/f${String(i)}.ts` }));
    const g = graphOf(files, { folderSatelliteMaxes: { 'c:/work/proj/src': 4, 'c:/work/proj/src/deep': 1 } });
    const src = g.top[0]!;
    const deep = g.folders[src.id]!.children[0]!;
    expect(src.maxSatellites).toBe(4);
    expect(deep.maxSatellites).toBe(1);
    expect(byLabel(g.satellites[src.id]!)).toEqual(['f5.ts', 'f4.ts', 'f3.ts', 'f2.ts']);
    expect(byLabel(g.satellites[deep.id]!)).toEqual(['f5.ts']);
  });

  it('프로젝트 밖은 직속 부모 하나 — 이름은 전체 경로, 파일 없는 외부 폴더(검색 범위만)는 세우지 않는다', () => {
    const g = graphOf([
      use(10, 'Read', { file_path: 'D:/notes/2026/todo.md' }),
      use(20, 'Grep', { pattern: 'x', path: 'E:/elsewhere' }),
    ]);
    expect(g.top.map((b) => [b.label, b.bubbleType])).toEqual([['D:/notes/2026', 'external_folder']]);
    const ext = g.top[0]!;
    expect(g.satellites[ext.id]!.map((b) => b.label)).toEqual(['todo.md']);
    // 경로 표시는 끝 마디로 줄인다(버블 이름은 캔버스 규칙대로 전체 경로).
    const entry = sessionCanvasEntryOf(g, ext.id);
    expect(entry?.kind).toBe('folder');
    if (entry?.kind === 'folder') expect(folderCrumbLabel(entry.folder)).toBe('2026');
  });

  it('프로젝트 루트 자신은 폴더 버블이 아니다 — 경로 없는 검색(루트 훑기)은 버블을 만들지 않는다', () => {
    const g = graphOf([use(10, 'Grep', { pattern: 'x' })]);
    expect(g.top).toEqual([]);
    expect(Object.keys(g.folders)).toEqual([]);
  });
});

describe('§5.5 #17-50 — 캔버스와 같은 노드 모양', () => {
  it('웹은 domain(검색은 web-search 의사 호스트 자리), 명령 앱은 bash + commandApp', () => {
    const g = graphOf([
      use(10, 'WebFetch', { url: 'https://docs.example.com/a', prompt: 'p' }),
      use(20, 'WebSearch', { query: 'react flow' }),
      use(30, 'Bash', { command: 'git status' }),
    ]);
    const kinds = g.top.map((b) => [b.label, b.bubbleType]);
    expect(kinds).toEqual([
      ['docs.example.com', 'domain'],
      ['웹 검색', 'domain'],
      ['Git', 'bash'],
    ]);
    expect(g.top[1]!.path).toBe(WEB_SEARCH_HOST);
    expect(g.top[2]!.commandApp?.name).toBe('Git');
    // 노드 id 는 캔버스와 겹치지 않는다.
    expect(g.top.every((b) => b.id.startsWith('sb:'))).toBe(true);
  });

  it('가운데는 캔버스의 그 에이전트 노드 그대로 — 상태만 이 칸의 판정', () => {
    expect(graphOf([]).center).toBe(AGENT_NODE);
    expect(graphOf([], { running: true }).center.status).toBe('active');
    expect(graphOf([], { running: true }).center.modelName).toBe('claude-opus');
    // 다른 세션 때문에 켜진 active 는 이 칸에서는 쉬는 중이다. 완료·실패 표시는 그 노드의 것 그대로.
    expect(graphOf([], { agent: { ...AGENT_NODE, status: 'active' } }).center.status).toBe('idle');
    expect(graphOf([], { agent: { ...AGENT_NODE, status: 'completed' } }).center.status).toBe('completed');
    // 스냅샷에 없으면 최소한의 에이전트 버블(데이터 id 는 그 에이전트).
    const bare = graphOf([], { agent: null }).center;
    expect([bare.id, bare.bubbleType]).toEqual([AGENT, 'agent']);
    expect(sessionCanvasEntryOf(graphOf([]), SESSION_CENTER_NODE_ID)).toEqual({ kind: 'center' });
  });

  it('결과가 안 온 호출은 이 칸이 도는 동안만 active — 버블과 선이 함께', () => {
    const events = [use(10, 'Edit', { file_path: `${ROOT}/a.ts`, old_string: 'x', new_string: 'y' }, { toolUseId: 'u1' })];
    const idle = graphOf(events);
    const live = graphOf(events, { running: true });
    expect(idle.top[0]!.status).toBe('idle');
    expect(live.top[0]!.status).toBe('active');
    expect(live.edges[0]!.isActive).toBe(true);
    const finished = graphOf([...events, done(11, 'u1')], { running: true });
    expect(finished.top[0]!.status).toBe('idle');
    expect(finished.edges[0]!.isActive).toBe(false);
  });

  it('같은 파일이 캔버스에 떠 있으면 그 크기·수정 시각만 빌린다', () => {
    const g = graphOf([use(10, 'Read', { file_path: `${ROOT}/img/a.png` })], {
      fileStats: (abs) => (abs.endsWith('a.png') ? { fileSize: 2048, fileMtime: 99 } : undefined),
    });
    const file = g.satellites[g.top[0]!.id]![0]!;
    expect([file.fileSize, file.fileMtime]).toEqual([2048, 99]);
  });

  it('keeps preview bundle metadata alongside document satellites', () => {
    const g = graphOf([
      use(10, 'Read', { file_path: `${ROOT}/img/a.png` }),
      use(20, 'Read', { file_path: `${ROOT}/img/b.png` }),
      use(30, 'Read', { file_path: `${ROOT}/img/c.ts` }),
    ]);
    const img = g.top[0]!;
    const sats = g.satellites[img.id]!;
    expect(byLabel(sats)).toEqual(['c.ts', 'b.png', 'a.png']);
    for (const label of ['a.png', 'b.png']) {
      const png = sats.find((b) => b.label === label)!;
      expect([png.folderNodeId, png.folderKindCount, png.folderKindDir]).toEqual([img.id, 2, 'img']);
    }
    // 묶이지 않는 글(코드)에는 싣지 않는다 · 노드 표(nodeMap)의 원본은 그대로다(사본에만).
    expect(sats.find((b) => b.label === 'c.ts')?.folderKindCount).toBeUndefined();
    expect(g.nodeMap[sats.find((b) => b.label === 'b.png')!.id]?.folderNodeId).toBeUndefined();
  });

  it('keeps earlier previews when later turns fill the document limit and bundles only matching kinds', () => {
    const g = graphOf([
      use(10, 'Read', { file_path: `${ROOT}/assets/a.png` }, { turnId: 'turn-one' }),
      use(20, 'Read', { file_path: `${ROOT}/assets/deep/b.png` }, { turnId: 'turn-one' }),
      use(30, 'Read', { file_path: `${ROOT}/assets/sound.wav` }, { turnId: 'turn-one' }),
      ...Array.from({ length: 4 }, (_, i) => use(100 + i, 'Read', { file_path: `${ROOT}/assets/code${i}.ts` }, { turnId: 'turn-two' })),
    ], { folderSatelliteMaxes: { 'c:/work/proj/assets': 1 } });
    const folder = g.top[0]!;
    const sats = g.satellites[folder.id]!;
    expect(byLabel(sats)).toEqual(['code3.ts', 'sound.wav', 'b.png', 'a.png']);
    const view = applyConstellations({
      radial: g.top, satInfos: collectSatellites(g.top, g.satellites, undefined), appHubs: [], heat: undefined, platform: 'win32',
      bundleSessionId: S,
    });
    const bundle = view.satInfos.find((s) => s.bubble.bubbleType === 'bundle')!;
    const info = bundleInfoOf(bundle.bubble)!;
    expect(info.kind).toBe('image');
    expect(info.sessionId).toBe(S);
    expect(info.count).toBe(2);
    expect(view.satInfos.filter((s) => s.parentId === bundle.bubble.id)).toHaveLength(DEFAULT_MAX_SATELLITES);
    expect(bundleInteriorMembers({ memberIds: info.memberIds, folderId: info.folderId, fileKind: info.kind }, g.nodeMap, g.children, g.satellites)
      .map((b) => b.label)).toEqual(['b.png', 'a.png']);
    expect(view.satInfos.some((s) => s.bubble.label === 'sound.wav' && s.parentId === folder.id)).toBe(true);
  });

  it('retains all preview members across subfolders without consuming document seats', () => {
    const shots = Array.from({ length: 12 }, (_, i) => use(10 + i, 'Read', { file_path: `${ROOT}/assets/attachments/s${String(i)}/shot.png` }));
    const g = graphOf([use(1, 'Read', { file_path: `${ROOT}/assets/old.md` }), ...shots, use(99, 'Read', { file_path: `${ROOT}/assets/new.md` })]);
    const assets = g.top[0]!;
    const sats = g.satellites[assets.id]!;
    expect(sats.filter((b) => b.label === 'shot.png')).toHaveLength(shots.length);
    expect(byLabel(sats.filter((b) => b.label.endsWith('.md')))).toEqual(['new.md', 'old.md']);
    for (const b of sats.filter((x) => x.label === 'shot.png')) {
      expect([b.folderNodeId, b.folderKindCount, b.folderKindDir]).toEqual([assets.id, 12, 'assets/attachments']);
    }
  });

  it('keeps PDF and HTML preview bundles separate from ordinary documents and code', () => {
    const paths = ['a.pdf', 'b.pdf', 'a.html', 'b.htm', 'readme.md', 'first.ts', 'last.ts'];
    const g = graphOf(paths.map((name, i) => use(10 + i, 'Read', { file_path: `${ROOT}/assets/${name}` })), {
      folderSatelliteMaxes: { 'c:/work/proj/assets': 1 },
    });
    const folder = g.top[0]!;
    const sats = g.satellites[folder.id]!;
    expect(byLabel(sats)).toEqual(['last.ts', 'b.htm', 'a.html', 'b.pdf', 'a.pdf']);
    expect(sats.filter((b) => b.folderKindCount === 2)).toHaveLength(4);
    const view = applyConstellations({
      radial: g.top, satInfos: collectSatellites(g.top, g.satellites, undefined), appHubs: [], heat: undefined, platform: 'win32',
      bundleSessionId: S,
    });
    expect(view.satInfos.filter((s) => s.bubble.bubbleType === 'bundle').map((s) => bundleInfoOf(s.bubble)?.kind).sort())
      .toEqual(['code', 'doc']);
  });

  it('uses the selected session bundle satellite limit without narrowing its contents', () => {
    const g = graphOf(Array.from({ length: 5 }, (_, i) => use(10 + i, 'Read', { file_path: `${ROOT}/assets/shot${i}.png` })), {
      folderBundleSatelliteMaxes: { 'c:/work/proj/assets': { [`image:${S}`]: 3, 'image:other-session': 1 } },
    });
    const view = applyConstellations({
      radial: g.top, satInfos: collectSatellites(g.top, g.satellites, undefined), appHubs: [], heat: undefined, platform: 'win32',
      bundleSessionId: S,
    });
    const bundle = view.satInfos.find((s) => s.bubble.bubbleType === 'bundle')!;
    const info = bundleInfoOf(bundle.bubble)!;
    expect(info.count).toBe(5);
    expect(view.satInfos.filter((s) => s.parentId === bundle.bubble.id)).toHaveLength(3);
    expect(bundleInteriorMembers({ memberIds: info.memberIds, folderId: info.folderId, fileKind: info.kind, sessionId: info.sessionId },
      g.nodeMap, g.children, g.satellites)).toHaveLength(5);
  });

  it('uses the project root bundle setting for root-level preview files', () => {
    const g = graphOf(Array.from({ length: 4 }, (_, i) => use(10 + i, 'Read', { file_path: `${ROOT}/shot${i}.png` })), {
      rootBundleSatelliteMaxes: { [`image:${S}`]: 1 },
    });
    const view = applyConstellations({
      radial: g.top, satInfos: [], appHubs: [], heat: undefined, platform: 'win32', bundleFolder: g.bundleRoot!,
      bundleSessionId: S,
    });
    const info = bundleInfoOf(view.radial[0]!)!;
    expect(info.count).toBe(4);
    expect(info.settingsPath).toBe('');
    expect(info.settingsAbsolutePath).toBe(ROOT);
    expect(view.satInfos).toHaveLength(1);
  });
});

describe('§5.5 #17-50 — 선은 캔버스와 같은 방향', () => {
  it('읽기 = 버블 → 가운데, 쓰기 = 가운데 → 버블(§2.1 #3 한 쌍에 방향은 하나)', () => {
    const g = graphOf([
      use(10, 'Read', { file_path: `${ROOT}/a/x.ts` }),
      use(20, 'Write', { file_path: `${ROOT}/b/y.ts`, content: 'z' }),
    ]);
    const [a, b] = g.top;
    expect(g.edges.map((e) => [e.source, e.target, e.label])).toEqual([
      [a!.id, AGENT, 'Read'],
      [AGENT, b!.id, 'Write'],
    ]);
  });

  it('셸 읽기는 캔버스처럼 Read 로 정규화한다 — 캔버스 위성선(READ_TOOLS 로 방향을 가른다)이 그대로 맞는다', () => {
    const g = graphOf([use(10, 'Bash', { command: `cat ${ROOT}/src/a.ts` })]);
    const src = g.top[0]!;
    const sat = g.satellites[src.id]![0]!;
    expect(sat.lastTool).toBe('Read');
    const [info] = collectSatellites([src], g.satellites, undefined);
    // 읽기 위성선은 위성 → 부모.
    expect([info!.edge.source, info!.edge.target]).toEqual([`sat-${sat.id}`, src.id]);
  });

  it('도구 이름 정규화 — 방향과 어긋난 이름만 바꾼다', () => {
    expect(canvasToolOf({ lastTool: 'Bash', lastDirection: 'read' })).toBe('Read');
    expect(canvasToolOf({ lastTool: 'Grep', lastDirection: 'read' })).toBe('Grep');
    expect(canvasToolOf({ lastTool: 'Bash', lastDirection: 'write' })).toBe('Bash');
    expect(canvasToolOf({ lastTool: 'Read', lastDirection: 'write' })).toBe('Write');
  });

  it('지도의 에이전트는 가운데 하나 — 서브에이전트는 버블이 아니고, 그 안쪽 호출이 만진 것도 가운데에서 선이 나온다', () => {
    const g = graphOf([
      use(10, 'Task', { description: '조사', prompt: 'p' }, { toolUseId: 'task-1' }),
      use(20, 'Agent', { description: '검토', prompt: 'p' }, { toolUseId: 'task-2' }),
      use(30, 'Read', { file_path: `${ROOT}/docs/a.md` }, { nestedUnderToolUseId: 'task-1' }),
    ]);
    expect(g.top.some((b) => b.bubbleType === 'agent')).toBe(false);
    expect(byLabel(g.top)).toEqual(['docs']);
    const docs = g.top[0]!;
    expect(g.edges.map((e) => [e.source, e.target])).toEqual([[docs.id, AGENT]]);
    // 어느 서브에이전트를 거쳤는지는 디테일 칸의 사실로 남는다.
    const entry = sessionCanvasEntryOf(g, docs.id);
    expect(entry?.kind === 'folder' ? entry.folder.viaTaskKey : null).not.toBeNull();
  });

  it('폴더 안 화면의 선은 그 폴더(← Back 자리) ↔ 자식이다', () => {
    const g = graphOf([use(10, 'Edit', { file_path: `${ROOT}/src/a.ts`, old_string: 'x', new_string: 'y' })]);
    const src = g.top[0]!;
    const inner = g.folders[src.id]!.innerEdges;
    expect(inner.map((e) => [e.source, e.target])).toEqual([[src.id, g.folders[src.id]!.children[0]!.id]]);
  });
});

describe('§5.5 #17-50 — 경로 키는 세 OS 규칙대로(멀티플랫폼 1축)', () => {
  const POSIX_ROOT = '/srv/projects/proj';
  function posixGraph(platform: 'darwin' | 'linux', events: SubAgentStreamEvent[]): SessionCanvasGraph {
    const model = buildSessionBubbles({ streams: [{ events, commands: [] }], rootPath: POSIX_ROOT, platform });
    return buildSessionCanvasGraph({
      model, rootPath: POSIX_ROOT, platform, running: false, agentId: AGENT, agent: AGENT_NODE, webSearchLabel: '웹 검색',
    });
  }
  const twoCases = (root: string): SubAgentStreamEvent[] => [
    use(10, 'Read', { file_path: `${root}/Src/A.ts` }),
    use(20, 'Read', { file_path: `${root}/src/a.ts` }),
  ];

  it('win32 · darwin 은 대소문자만 다른 폴더·파일을 하나로 접는다', () => {
    const win = graphOf(twoCases(ROOT));
    expect(win.top).toHaveLength(1);
    expect(g1Files(win)).toHaveLength(1);
    const mac = posixGraph('darwin', twoCases(POSIX_ROOT));
    expect(mac.top).toHaveLength(1);
    expect(g1Files(mac)).toHaveLength(1);
  });

  it('linux 는 접지 않는다 — Src 와 src 는 다른 폴더다', () => {
    const linux = posixGraph('linux', twoCases(POSIX_ROOT));
    expect(linux.top.map((b) => b.label).sort()).toEqual(['Src', 'src']);
    // POSIX 루트에서도 첫 마디부터 계층이고, 안팎 판정은 그 루트 기준이다.
    expect(linux.top.every((b) => b.bubbleType === 'internal_folder')).toBe(true);
    expect(linux.top.map((b) => b.absolutePath).sort()).toEqual([`${POSIX_ROOT}/Src`, `${POSIX_ROOT}/src`]);
  });

  function g1Files(g: SessionCanvasGraph): BubbleData[] {
    return Object.values(g.nodeMap).filter((b) => b.bubbleType === 'file');
  }
});

describe('§5.5 #17-50 (F) — 디테일 창은 캔버스의 같은 노드로 선다', () => {
  const canvas = (nodes: BubbleData[]): Record<string, BubbleData> => Object.fromEntries(nodes.map((n) => [n.id, n]));
  const twinOf = (
    g: SessionCanvasGraph,
    nodeId: string,
    nodeMap: Record<string, BubbleData>,
    over: { nodeProjects?: Record<string, string>; project?: string | null } = {},
  ): string | null => {
    const entry = sessionCanvasEntryOf(g, nodeId);
    expect(entry).not.toBeNull();
    return canvasTwinIdOf(entry!, { nodeMap, nodeProjects: over.nodeProjects ?? {}, project: over.project ?? null, platform: 'win32' });
  };

  it('파일·폴더는 절대 경로 키로 찾는다(win32 는 대소문자·구분자를 접는다)', () => {
    const g = graphOf([use(10, 'Read', { file_path: `${ROOT}/src/a.ts` })]);
    const folder = g.top[0]!;
    const file = g.satellites[folder.id]![0]!;
    const nodeMap = canvas([
      { id: 'folder-1', label: 'src', bubbleType: 'internal_folder', path: 'src', absolutePath: 'c:\\work\\proj\\src', status: 'idle', activity: 1 },
      { id: 'file-1', label: 'a.ts', bubbleType: 'file', path: 'src/a.ts', absolutePath: 'C:\\Work\\Proj\\src\\a.ts', status: 'idle', activity: 1 },
    ]);
    expect(twinOf(g, folder.id, nodeMap)).toBe('folder-1');
    expect(twinOf(g, `sat-${file.id}`, nodeMap)).toBe('file-1');
  });

  it('linux 는 대소문자가 다른 경로를 짝으로 읽지 않는다 · darwin 은 접는다', () => {
    const model = buildSessionBubbles({ streams: [{ events: [use(10, 'Read', { file_path: '/srv/projects/proj/src/A.ts' })], commands: [] }], rootPath: '/srv/projects/proj', platform: 'linux' });
    const entry = (platform: 'linux' | 'darwin') => {
      const g = buildSessionCanvasGraph({ model, rootPath: '/srv/projects/proj', platform, running: false, agentId: AGENT, agent: AGENT_NODE, webSearchLabel: '웹 검색' });
      const file = g.satellites[g.top[0]!.id]![0]!;
      return sessionCanvasEntryOf(g, file.id)!;
    };
    const nodeMap = canvas([
      { id: 'file-lower', label: 'a.ts', bubbleType: 'file', path: 'src/a.ts', absolutePath: '/srv/projects/proj/src/a.ts', status: 'idle', activity: 1 },
    ]);
    const base = { nodeMap, nodeProjects: {}, project: null };
    expect(canvasTwinIdOf(entry('linux'), { ...base, platform: 'linux' })).toBeNull();
    expect(canvasTwinIdOf(entry('darwin'), { ...base, platform: 'darwin' })).toBe('file-lower');
  });

  it('캔버스에 없으면 null — 지도가 지은 모양으로 선다', () => {
    const g = graphOf([use(10, 'Read', { file_path: `${ROOT}/src/a.ts` })]);
    expect(twinOf(g, g.top[0]!.id, {})).toBeNull();
    // 가운데는 열쇠로 찾지 않는다 — 지도가 에이전트 id 로 바로 찾는다.
    expect(twinOf(g, SESSION_CENTER_NODE_ID, canvas([AGENT_NODE]))).toBeNull();
  });

  it('웹은 호스트(접힌 웹 버블은 짝이 아니다) · 검색은 web-search 자리 · 명령 앱은 앱 이름', () => {
    const g = graphOf([
      use(10, 'WebFetch', { url: 'https://docs.example.com/a', prompt: 'p' }),
      use(20, 'WebSearch', { query: 'react flow' }),
      use(30, 'Bash', { command: 'git status' }),
    ]);
    const nodeMap = canvas([
      { id: 'fold', label: 'docs.example.com', bubbleType: 'domain', path: 'docs.example.com', status: 'idle', activity: 1, webFold: { hosts: [] } as unknown as BubbleData['webFold'] },
      { id: 'domain-1', label: 'docs.example.com', bubbleType: 'domain', path: 'docs.example.com', status: 'idle', activity: 1 },
      { id: 'domain-s', label: WEB_SEARCH_HOST, bubbleType: 'domain', path: WEB_SEARCH_HOST, status: 'idle', activity: 1 },
      { id: 'command-app-1', label: 'Git', bubbleType: 'bash', path: 'app', status: 'idle', activity: 1, commandApp: { id: 'git', name: 'Git', detection: 'command' } },
    ]);
    expect(twinOf(g, g.top[0]!.id, nodeMap)).toBe('domain-1');
    expect(twinOf(g, g.top[1]!.id, nodeMap)).toBe('domain-s');
    expect(twinOf(g, g.top[2]!.id, nodeMap)).toBe('command-app-1');
  });

  it('여러 프로젝트에 같은 짝이 있으면 그 에이전트의 프로젝트 것', () => {
    const g = graphOf([use(10, 'Bash', { command: 'git status' })]);
    const nodeMap = canvas([
      { id: 'app-a', label: 'Git', bubbleType: 'bash', path: 'a', status: 'idle', activity: 1, commandApp: { id: 'git', name: 'Git', detection: 'command' } },
      { id: 'app-b', label: 'Git', bubbleType: 'bash', path: 'b', status: 'idle', activity: 1, commandApp: { id: 'git', name: 'Git', detection: 'command' } },
    ]);
    expect(twinOf(g, g.top[0]!.id, nodeMap, { nodeProjects: { 'app-a': 'A', 'app-b': 'B' }, project: 'B' })).toBe('app-b');
  });
});

describe('§5.5 #17-50 — 정보 칸이 묻는 사실', () => {
  it('위성은 sat- 를 떼고 찾는다', () => {
    const g = graphOf([use(10, 'Read', { file_path: `${ROOT}/src/a.ts` })]);
    const sat = g.satellites[g.top[0]!.id]![0]!;
    const entry = sessionCanvasEntryOf(g, `sat-${sat.id}`);
    expect(entry?.kind).toBe('file');
    expect(sessionCanvasEntryOf(g, 'sat-bundle-x')).toBeNull();
  });

  it('resolves a session-scoped preview satellite to its file entry', () => {
    const g = graphOf([use(10, 'Read', { file_path: `${ROOT}/assets/a.png` })]);
    const file = g.satellites[g.top[0]!.id]![0]!;
    const entry = sessionCanvasEntryOf(g, `sat-${file.id}:preview-session:${encodeURIComponent(S)}`);
    expect(entry?.kind).toBe('file');
    if (entry?.kind === 'file') expect(entry.file.name).toBe('a.png');
  });
});
