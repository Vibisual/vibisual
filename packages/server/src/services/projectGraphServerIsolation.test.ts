/**
 * §7.11 / §3.5 — **남의 프로젝트 서버는 우리 캔버스에 서지 않는다.**
 *
 * 이 테스트가 지키는 것은 사용자 신고 한 줄이다: "다른 프로젝트에서 연 서버가 왜 앱을 껐다
 * 켜면 다른 프로젝트에서 보이는 거야."
 *
 * 실측(2026-09-11) — vibisual 체크포인트에 위성 두 개가 박혀 있었다.
 *   · `localhost:3456` = 옆 프로젝트 A 의 백엔드(`node  src/server.js`)
 *   · `localhost:8080` = 옆 프로젝트 B 의 vite(`"node" "…\Game2D\…\vite.js"`)
 * 정작 두 주인 탭의 iframe 위성은 0개였다. 두 위성 모두 `shellId` 가 없어 v1.48 의
 * owning-shell 검사가 port-only 로 떨어지고, 주인 프로젝트가 서버를 계속 띄워 두는 한
 * 포트는 늘 살아 있어 v2.1 의 60초 grace 자동 제거가 **한 번도 발동하지 않았다.**
 * 그래서 앱을 껐다 켤 때마다 체크포인트에서 그대로 되살아났다.
 *
 * 여기서 고정하는 것은 셋이다.
 *   ① 이미 저장된 남의 위성은 생사 sweep 이 걷어낸다(스스로 낫는다).
 *   ② 판정 불가(`unknown`)도 걷는다 — 상대경로로 띄운 서버가 정확히 그 구멍으로 들어왔다.
 *   ③ 우리 서버·고정핀·못 읽은 것은 건드리지 않는다(반대 방향 사고 차단).
 *
 * 포트 조회는 주입한다 — `platform` 을 인자로 받는 것과 같은 이유로, 실기·실서버 없이
 * 세 OS 의 판정이 단위 테스트를 지나가야 한다.
 *
 * 2026-10-01 — 사용자 신고 "A 에서 테스트하던 프리뷰 버블에 B 프로젝트 것이 열린다 — 지난번에도 그랬다".
 * 한 포트에 주인이 둘이었다(A 의 서버가 `::`, B 의 vite 가 `[::1]`, 둘 다 8080). 그래서 아래 뒤쪽 블록은
 * 포트가 아니라 **위성 주소가 실제로 닿는 리스너**로 가르는 것을 고정한다.
 *   ④ 남의 리스너에 닿는 위성은 우리 서버에 닿는 별칭으로 옮기고(지우지 않는다), 그런 별칭이 없으면 걷는다.
 *   ⑤ 새 위성의 입구는 하나다 — 판정 뒤에 서고, 거절되면 짝 ServerEntry 도 서지 않는다.
 *   ⑥ Stop/Restart 는 그 주소의 리스너만, 남의 것이면 아예 죽이지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { ProjectGraph } from './projectGraph.js';
import {
  clearPortOriginCache,
  type PortOwnership,
  type PortOwnershipLookup,
  type ProcessStartInfo,
} from './serverOrigin.js';
import type { BubbleData } from '@vibisual/shared';

const OURS = 'C:/work/vibisual';
const TRADE_APP = 'C:/work/trade-app';
const GAME = 'C:/work/Game2D';

/** 실측한 두 명령줄 그대로 — 하나는 절대경로가 박혔고, 하나는 상대경로뿐이다. */
const GAME_VITE_CMD =
  '"node" "C:\\work\\Game2D\\node_modules\\.bin\\\\..\\vite\\bin\\vite.js"';
const TRADE_APP_CMD = 'node  src/server.js';

function iframesOf(sats: BubbleData[] | undefined): BubbleData[] {
  return (sats ?? []).filter((s) => s.bubbleType === 'iframe');
}

/**
 * 체크포인트에서 복원된 모양 그대로의 위성 — 생성 경로를 타지 않고 이미 굳어 있는 것.
 * `shellId` 가 없는 것이 핵심이다(감지 폴백이 만든 위성의 모양 = port-only 후방호환 가지).
 */
function restoredSatellite(sessionId: string, port: number, extra: Partial<BubbleData> = {}): BubbleData {
  return {
    id: `special-${String(port)}`,
    label: `localhost:${String(port)}`,
    bubbleType: 'iframe',
    path: `__special__iframe__${sessionId}__${String(port)}`,
    status: 'active',
    activity: 1,
    lastActivity: Date.now(),
    url: `http://127.0.0.1:${String(port)}/`,
    iframeAlive: true,
    ...extra,
  };
}

/**
 * 격리 sweep 만 떼어 시험한다 — `checkIframesAlive` 전체는 JSONL 스캔·실 TCP probe 를 타므로,
 * 여기서는 그 앞단이 넘겨주는 것과 같은 모양(`{t:{port}, portAlive}`)을 직접 만들어 넣는다.
 */
async function sweep(graph: ProjectGraph, ports: number[]): Promise<boolean> {
  const results = ports.map((port) => ({ t: { port }, portAlive: true }));
  return await (graph as unknown as {
    evictDisownedIframeSatellites: (r: readonly { t: { port: number }; portAlive: boolean }[]) => Promise<boolean>;
  }).evictDisownedIframeSatellites(results);
}

/**
 * 이 그래프가 그리는 프로젝트를 `OURS` 로 고정하고, 다른 탭 둘이 열려 있다고 알린다.
 * 루트는 private 필드로 직접 놓는다 — `registerProject` 는 세션 탐색(`discoverAndSeed`)까지
 * 끌고 들어와 이 테스트가 보려는 것과 무관한 디스크 작업을 부른다.
 */
function graphWithNeighbors(
  lookup: (p: number) => Promise<ProcessStartInfo | null>,
  neighbors: string[] = [OURS, TRADE_APP, GAME],
): { graph: ProjectGraph; agent: BubbleData } {
  clearPortOriginCache();
  const graph = new ProjectGraph();
  (graph as unknown as { root: string | null }).root = OURS;
  graph.setKnownProjectRootsProvider(() => neighbors);
  graph.setPortOriginLookup(lookup);
  const agent = graph.createCustomAgent('Runner');
  return { graph, agent };
}

describe('§3.5 — 이미 박힌 남의 서버 위성은 생사 sweep 이 걷어낸다', () => {
  it('실측 ①: 명령줄에 남의 루트가 박힌 서버(옆 프로젝트 vite 8080)를 걷어낸다', async () => {
    const { graph, agent } = graphWithNeighbors(async () => ({ command: GAME_VITE_CMD }));
    agent.persistSatellites = [restoredSatellite(agent.path, 8080)];

    const changed = await sweep(graph, [8080]);

    expect(changed).toBe(true);
    expect(iframesOf(agent.persistSatellites)).toHaveLength(0);
  });

  it('실측 ②: 상대경로로 띄워 판정 불가인 서버(옆 프로젝트 백엔드 3456)도 걷어낸다', async () => {
    // 종전 규약은 이걸 `unknown` → 통과로 흘렸다. win32 는 프로세스 cwd 를 읽을 수 없고
    // 이 명령줄에는 절대경로가 없어, 이 한 갈래로 남의 서버가 계속 들어왔다.
    const { graph, agent } = graphWithNeighbors(async () => ({ command: TRADE_APP_CMD }));
    agent.persistSatellites = [restoredSatellite(agent.path, 3456)];

    const changed = await sweep(graph, [3456]);

    expect(changed).toBe(true);
    expect(iframesOf(agent.persistSatellites)).toHaveLength(0);
  });

  it('우리 프로젝트 안에서 도는 서버는 건드리지 않는다', async () => {
    const { graph, agent } = graphWithNeighbors(async () => ({
      command: `"node" "${OURS}/node_modules/vite/bin/vite.js"`,
    }));
    agent.persistSatellites = [restoredSatellite(agent.path, 5173)];

    const changed = await sweep(graph, [5173]);

    expect(changed).toBe(false);
    expect(iframesOf(agent.persistSatellites)).toHaveLength(1);
  });

  it('프로세스를 못 읽었으면 걷지 않는다 — 조회 실패로 멀쩡한 프리뷰가 사라지면 안 된다', async () => {
    const { graph, agent } = graphWithNeighbors(async () => null);
    agent.persistSatellites = [restoredSatellite(agent.path, 4321)];

    const changed = await sweep(graph, [4321]);

    expect(changed).toBe(false);
    expect(iframesOf(agent.persistSatellites)).toHaveLength(1);
  });

  it('고정핀을 꽂은 위성은 남의 것이라도 건드리지 않는다(§7.11 v2.4 와 같은 예외)', async () => {
    const { graph, agent } = graphWithNeighbors(async () => ({ command: GAME_VITE_CMD }));
    agent.persistSatellites = [restoredSatellite(agent.path, 8080, { preservePinned: true })];

    const changed = await sweep(graph, [8080]);

    expect(changed).toBe(false);
    expect(iframesOf(agent.persistSatellites)).toHaveLength(1);
  });

  it('다른 탭이 하나도 안 열려 있으면 조회조차 하지 않는다 — 가를 대상이 없다', async () => {
    let calls = 0;
    const { graph, agent } = graphWithNeighbors(
      async () => { calls += 1; return { command: TRADE_APP_CMD }; },
      [OURS],
    );
    agent.persistSatellites = [restoredSatellite(agent.path, 3456)];

    const changed = await sweep(graph, [3456]);

    expect(calls).toBe(0);
    expect(changed).toBe(false);
    expect(iframesOf(agent.persistSatellites)).toHaveLength(1);
  });

  it('죽은 포트는 보지 않는다 — 소속과 무관하게 grace 가 걷는 몫이다', async () => {
    const { graph, agent } = graphWithNeighbors(async () => ({ command: GAME_VITE_CMD }));
    agent.persistSatellites = [restoredSatellite(agent.path, 8080, { iframeAlive: false })];

    const changed = await (graph as unknown as {
      evictDisownedIframeSatellites: (r: readonly { t: { port: number }; portAlive: boolean }[]) => Promise<boolean>;
    }).evictDisownedIframeSatellites([{ t: { port: 8080 }, portAlive: false }]);

    expect(changed).toBe(false);
    expect(iframesOf(agent.persistSatellites)).toHaveLength(1);
  });

  it('위성을 걷으면 짝이 되는 ServerEntry 도 함께 걷는다(v2.21 strict 1:1)', async () => {
    const { graph, agent } = graphWithNeighbors(async () => ({ command: GAME_VITE_CMD }));
    agent.persistSatellites = [restoredSatellite(agent.path, 8080)];
    const running = (graph as unknown as { runningServers: Map<string, { id: string; command: string; port?: number; startedAt: number; alive: boolean }[]> }).runningServers;
    running.set(agent.path, [
      { id: 'e-8080__p8080', command: 'vite', port: 8080, startedAt: Date.now(), alive: true },
      { id: 'e-5173__p5173', command: 'vite', port: 5173, startedAt: Date.now(), alive: true },
    ]);

    await sweep(graph, [8080]);

    expect(running.get(agent.path)?.map((e) => e.port)).toEqual([5173]);
  });
});

// ─── 2026-10-01: 한 포트 두 주인 — "그 주소가 실제로 닿는 리스너"로 가른다 ───

/** 우리 서버 — 절대경로가 박힌 명령줄(ours) / 상대경로뿐인 명령줄(unknown). */
const OURS_SERVE_CMD = '"node" "C:\\work\\vibisual\\serve.js"';
const OURS_SERVE_RELATIVE = 'node  serve.js';

/**
 * 실측 모양 그대로 — 우리 서버가 `::`(netstat 에 `0.0.0.0`·`[::]` 두 줄), 옆 프로젝트 vite 가 `[::1]` 에
 * 같은 8080 으로 공존한다. `localhost` 는 vite 에, `127.0.0.1` 은 우리 서버에 닿는다.
 */
function dualBind(oursCmd = OURS_SERVE_CMD, foreignCmd = GAME_VITE_CMD): PortOwnership {
  return {
    listeners: [
      { pid: 41200, address: '0.0.0.0' },
      { pid: 41200, address: '::' },
      { pid: 19752, address: '::1' },
    ],
    starts: new Map<number, ProcessStartInfo | null>([
      [41200, { command: oursCmd }],
      [19752, { command: foreignCmd }],
    ]),
  };
}

/** 리스너 하나짜리 소유 사실. */
function only(pid: number, address: string, command: string): PortOwnership {
  return { listeners: [{ pid, address }], starts: new Map([[pid, { command }]]) };
}

function graphWithOwnership(
  lookup: PortOwnershipLookup,
  neighbors: string[] = [OURS, TRADE_APP, GAME],
): { graph: ProjectGraph; agent: BubbleData } {
  clearPortOriginCache();
  const graph = new ProjectGraph();
  (graph as unknown as { root: string | null }).root = OURS;
  graph.setKnownProjectRootsProvider(() => neighbors);
  graph.setPortOwnershipLookup(lookup);
  const agent = graph.createCustomAgent('Runner');
  return { graph, agent };
}

/** 생사 sweep 의 격리 단계 — 살아 있는 owning shell 집합(`launch` 증거의 출처)을 함께 넘긴다. */
async function sweepWithShells(graph: ProjectGraph, ports: number[], activeShellIds: string[]): Promise<boolean> {
  const results = ports.map((port) => ({ t: { port }, portAlive: true }));
  return await (graph as unknown as {
    evictDisownedIframeSatellites: (
      r: readonly { t: { port: number }; portAlive: boolean }[],
      active?: ReadonlySet<string>,
    ) => Promise<boolean>;
  }).evictDisownedIframeSatellites(results, new Set(activeShellIds));
}

interface IframeGate { evidence?: 'observed' | 'launch'; onPlaced?: (url: string) => void; onRejected?: () => void }
type CreateIframe = (
  sessionId: string, command: string, port: number, shellId?: string, logText?: string,
  fromNewBash?: boolean, displayUrl?: string, gate?: IframeGate,
) => void;

/** 위성 입구(private) — 백그라운드 셸·PreToolUse·rehydrate·watcher·감지·신고가 모두 여기를 지난다. */
function createIframe(graph: ProjectGraph): CreateIframe {
  return (graph as unknown as { createIframeSatellite: CreateIframe }).createIframeSatellite.bind(graph);
}

/** 판정은 비동기다 — 주입한 조회 → 판정 → 배치까지 마이크로태스크를 흘려보낸다. */
const settle = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });

function pendingPortsOf(graph: ProjectGraph): Map<number, number> {
  return (graph as unknown as { pendingIframePorts: Map<number, number> }).pendingIframePorts;
}

interface RunningEntry { id: string; command: string; port?: number; startedAt: number; alive: boolean; reportedOnly?: boolean }
function runningOf(graph: ProjectGraph): Map<string, RunningEntry[]> {
  return (graph as unknown as { runningServers: Map<string, RunningEntry[]> }).runningServers;
}

describe('§3.5 — 한 포트 두 주인(실측 2026-10-01): A 의 프리뷰에 B 의 화면', () => {
  it('localhost 위성이 옆 프로젝트 vite 에 닿으면 — 걷지 않고 우리 서버에 닿는 127.0.0.1 로 옮긴다', async () => {
    const { graph, agent } = graphWithOwnership(async () => dualBind());
    agent.persistSatellites = [restoredSatellite(agent.path, 8080, { url: 'http://localhost:8080/' })];

    const changed = await sweep(graph, [8080]);

    expect(changed).toBe(true);
    const sats = iframesOf(agent.persistSatellites);
    expect(sats).toHaveLength(1);
    expect(sats[0]?.url).toBe('http://127.0.0.1:8080/');
  });

  it('경로·쿼리는 살리고 호스트만 바꾼다', async () => {
    const { graph, agent } = graphWithOwnership(async () => dualBind());
    agent.persistSatellites = [restoredSatellite(agent.path, 8080, { url: 'http://localhost:8080/index.html?mode=fe' })];

    await sweep(graph, [8080]);

    expect(iframesOf(agent.persistSatellites)[0]?.url).toBe('http://127.0.0.1:8080/index.html?mode=fe');
  });

  it('우리 서버가 없고 옆 프로젝트 vite 만 [::1] 에 있으면 걷는다', async () => {
    const { graph, agent } = graphWithOwnership(async () => only(19752, '::1', GAME_VITE_CMD));
    agent.persistSatellites = [restoredSatellite(agent.path, 8080, { url: 'http://localhost:8080/' })];

    expect(await sweep(graph, [8080])).toBe(true);
    expect(iframesOf(agent.persistSatellites)).toHaveLength(0);
  });

  it('옆 프로젝트 쪽 그래프에서는 같은 localhost 위성이 제 vite 라 그대로 둔다', async () => {
    const { graph, agent } = graphWithOwnership(async () => dualBind(), [OURS, GAME]);
    (graph as unknown as { root: string | null }).root = GAME;
    agent.persistSatellites = [restoredSatellite(agent.path, 8080, { url: 'http://localhost:8080/' })];

    expect(await sweep(graph, [8080])).toBe(false);
    expect(iframesOf(agent.persistSatellites)[0]?.url).toBe('http://localhost:8080/');
  });

  it('고정핀도 주소 교정은 받는다(걷지는 않는다)', async () => {
    const { graph, agent } = graphWithOwnership(async () => dualBind());
    agent.persistSatellites = [restoredSatellite(agent.path, 8080, { url: 'http://localhost:8080/', preservePinned: true })];

    expect(await sweep(graph, [8080])).toBe(true);
    expect(iframesOf(agent.persistSatellites)[0]?.url).toBe('http://127.0.0.1:8080/');
  });

  it('상대경로로 띄운 우리 서버 — 관찰로만 들어온 위성은 옮기지 않고 걷는다(긍정 증거가 없다)', async () => {
    const { graph, agent } = graphWithOwnership(async () => dualBind(OURS_SERVE_RELATIVE));
    agent.persistSatellites = [restoredSatellite(agent.path, 8080, { url: 'http://localhost:8080/', shellId: 'sh-1' })];

    expect(await sweepWithShells(graph, [8080], [])).toBe(true);
    expect(iframesOf(agent.persistSatellites)).toHaveLength(0);
  });

  it('상대경로로 띄운 우리 서버 — owning shell 이 살아 있으면(launch) 우리 서버 쪽 별칭으로 옮긴다', async () => {
    const { graph, agent } = graphWithOwnership(async () => dualBind(OURS_SERVE_RELATIVE));
    agent.persistSatellites = [restoredSatellite(agent.path, 8080, { url: 'http://localhost:8080/', shellId: 'sh-1' })];

    expect(await sweepWithShells(graph, [8080], ['sh-1'])).toBe(true);
    expect(iframesOf(agent.persistSatellites)[0]?.url).toBe('http://127.0.0.1:8080/');
  });

  it('launch 증거는 처음 본 pid 에 묶인다 — 옆 서버가 나중에 [::1] 로 겹쳐 묶여도(둘 다 상대경로) 우리 쪽으로 옮긴다', async () => {
    let ownership: PortOwnership = only(41200, '::', OURS_SERVE_RELATIVE);
    const { graph, agent } = graphWithOwnership(async () => ownership);
    agent.persistSatellites = [restoredSatellite(agent.path, 8080, { url: 'http://localhost:8080/', shellId: 'sh-1' })];

    // ① 처음 본 리스너(41200)에 묶인다 — 그대로 둔다.
    expect(await sweepWithShells(graph, [8080], ['sh-1'])).toBe(false);
    expect(iframesOf(agent.persistSatellites)[0]?.url).toBe('http://localhost:8080/');

    // ② 옆 프로젝트가 상대경로로 띄운 서버가 [::1] 에 겹쳐 묶인다 — 명령줄로는 둘 다 unknown 이라
    //    pid 묶음만이 가른다. 묶음이 없으면 launch 가 남의 서버까지 통과시켜 localhost 에 남는다.
    ownership = dualBind(OURS_SERVE_RELATIVE, 'node  server.js');
    expect(await sweepWithShells(graph, [8080], ['sh-1'])).toBe(true);
    expect(iframesOf(agent.persistSatellites)[0]?.url).toBe('http://127.0.0.1:8080/');
  });

  it('우리 서버가 재기동해 pid 가 바뀌면(nodemon 등) 새 pid 로 다시 묶고 그대로 둔다', async () => {
    let ownership: PortOwnership = only(41200, '::', OURS_SERVE_RELATIVE);
    const { graph, agent } = graphWithOwnership(async () => ownership);
    agent.persistSatellites = [restoredSatellite(agent.path, 8080, { url: 'http://localhost:8080/', shellId: 'sh-1' })];
    await sweepWithShells(graph, [8080], ['sh-1']);

    ownership = only(50000, '::', OURS_SERVE_RELATIVE);
    expect(await sweepWithShells(graph, [8080], ['sh-1'])).toBe(false);
    expect(iframesOf(agent.persistSatellites)).toHaveLength(1);
    const bound = (graph as unknown as { iframeBoundPids: Map<string, number[]> }).iframeBoundPids;
    expect(bound.get(agent.persistSatellites?.[0]?.path ?? '')).toEqual([50000]);
  });

  it('걷힌 포트라도 같은 포트를 여는 위성이 남아 있으면 짝 ServerEntry 는 둔다', async () => {
    const { graph, agent } = graphWithOwnership(async () => dualBind(OURS_SERVE_RELATIVE));
    const other = graph.createCustomAgent('Viewer');
    // 셸이 살아 있는 쪽은 옮겨지고, 관찰로만 들어온 쪽은 걷힌다 — 같은 8080.
    agent.persistSatellites = [restoredSatellite(agent.path, 8080, { url: 'http://localhost:8080/', shellId: 'sh-1' })];
    other.persistSatellites = [restoredSatellite(other.path, 8080, { url: 'http://localhost:8080/' })];
    runningOf(graph).set(other.path, [{ id: 'e-8080__p8080', command: 'node serve.js', port: 8080, startedAt: Date.now(), alive: true }]);

    await sweepWithShells(graph, [8080], ['sh-1']);

    expect(iframesOf(other.persistSatellites)).toHaveLength(0);
    expect(iframesOf(agent.persistSatellites)[0]?.url).toBe('http://127.0.0.1:8080/');
    expect(runningOf(graph).get(other.path)?.map((e) => e.port)).toEqual([8080]);
  });
});

describe('§3.5 — 새 위성의 입구는 하나다(createIframeSatellite): 판정 뒤에 선다', () => {
  it('옆 프로젝트 서버에만 닿으면 만들지 않고, 짝 ServerEntry 자리(onPlaced)도 부르지 않는다', async () => {
    const { graph, agent } = graphWithOwnership(async () => only(19752, '::1', GAME_VITE_CMD));
    const placed: string[] = [];
    let rejected = 0;

    createIframe(graph)(agent.path, 'npm run dev', 8080, undefined, 'Port 8080 is in use', false, undefined, {
      onPlaced: (url) => { placed.push(url); },
      onRejected: () => { rejected += 1; },
    });
    expect(pendingPortsOf(graph).get(8080)).toBe(1);
    await settle();

    expect(iframesOf(agent.persistSatellites)).toHaveLength(0);
    expect(placed).toEqual([]);
    expect(rejected).toBe(1);
    expect(pendingPortsOf(graph).size).toBe(0);
  });

  it('한 포트 두 주인이면 우리 서버에 닿는 별칭으로 세우고, 그 주소로 짝 entry 를 등록하게 한다', async () => {
    const { graph, agent } = graphWithOwnership(async () => dualBind());
    const placed: string[] = [];

    createIframe(graph)(agent.path, 'node serve.js', 8080, 'sh-1', undefined, true, undefined, {
      onPlaced: (url) => { placed.push(url); },
    });
    await settle();

    expect(iframesOf(agent.persistSatellites).map((s) => s.url)).toEqual(['http://127.0.0.1:8080/']);
    expect(placed).toEqual(['http://127.0.0.1:8080/']);
  });

  it('관찰(감지·신고)로 들어온 상대경로 서버(unknown)는 세우지 않는다', async () => {
    const { graph, agent } = graphWithOwnership(async () => only(41200, '::', OURS_SERVE_RELATIVE));
    let rejected = 0;

    createIframe(graph)(agent.path, 'curl http://localhost:8080', 8080, undefined, undefined, false, 'http://localhost:8080/', {
      evidence: 'observed',
      onRejected: () => { rejected += 1; },
    });
    await settle();

    expect(iframesOf(agent.persistSatellites)).toHaveLength(0);
    expect(rejected).toBe(1);
  });

  it('우리 셸이 방금 띄운 상대경로 서버(launch)는 세우고, 셸이 붙기 전 sweep 에도 걷히지 않는다', async () => {
    const { graph, agent } = graphWithOwnership(async () => only(41200, '::', OURS_SERVE_RELATIVE));

    createIframe(graph)(agent.path, 'node serve.js', 8080, undefined, undefined, true);
    await settle();
    expect(iframesOf(agent.persistSatellites)).toHaveLength(1);

    // owning shell 을 아직 모른다(PreToolUse 직후) — "방금 띄웠다" 기록이 launch 증거다.
    expect(await sweepWithShells(graph, [8080], [])).toBe(false);
    expect(iframesOf(agent.persistSatellites)).toHaveLength(1);
  });

  it('다른 탭이 없으면 판정 없이 같은 틱에 선다(조회도 하지 않는다)', () => {
    let calls = 0;
    const { graph, agent } = graphWithOwnership(async () => { calls += 1; return dualBind(); }, [OURS]);
    const placed: string[] = [];

    createIframe(graph)(agent.path, 'npm run dev', 8080, undefined, undefined, true, undefined, {
      onPlaced: (url) => { placed.push(url); },
    });

    expect(iframesOf(agent.persistSatellites)).toHaveLength(1);
    expect(placed).toEqual(['http://localhost:8080']);
    expect(calls).toBe(0);
  });

  it('판정 중인 포트의 짝 ServerEntry 는 orphan 정리가 지우지 않는다 — 판정이 거절로 끝나면 그때 걷힌다', async () => {
    let release: (o: PortOwnership | null) => void = () => {};
    const pending8080 = new Promise<PortOwnership | null>((r) => { release = r; });
    const { graph, agent } = graphWithOwnership(async (p) => (p === 8080 ? pending8080 : null));
    // 생사 sweep 이 돌 이유가 되는 다른 위성 하나(아무도 안 쓰는 포트).
    agent.persistSatellites = [restoredSatellite(agent.path, 39873)];
    // PreToolUse 의 registerServerPort 가 먼저 세운 짝 entry.
    runningOf(graph).set(agent.path, [{ id: 'e-8080__p8080', command: 'npm run dev', port: 8080, startedAt: Date.now(), alive: true }]);

    createIframe(graph)(agent.path, 'npm run dev', 8080, undefined, undefined, true);
    await graph.checkIframesAlive();
    expect(runningOf(graph).get(agent.path)?.map((e) => e.port)).toEqual([8080]);

    release(only(19752, '::1', GAME_VITE_CMD));
    await settle();
    expect(pendingPortsOf(graph).size).toBe(0);
    await graph.checkIframesAlive();
    expect(runningOf(graph).get(agent.path)?.map((e) => e.port) ?? []).toEqual([]);
  }, 20000);
});

describe('§3.5 — Stop/Restart 는 그 주소의 리스너만, 남의 것이면 아예 안 죽인다(serverControlScope)', () => {
  function withEntry(graph: ProjectGraph, agent: BubbleData, entry: Partial<RunningEntry> = {}): void {
    runningOf(graph).set(agent.path, [
      { id: 'e-8080__p8080', command: 'npm run dev', port: 8080, startedAt: Date.now(), alive: true, ...entry },
    ]);
  }

  it('위성이 localhost(옆 프로젝트 vite 에 닿음)면 foreign — 죽이지 않는다', async () => {
    const { graph, agent } = graphWithOwnership(async () => dualBind());
    agent.persistSatellites = [restoredSatellite(agent.path, 8080, { url: 'http://localhost:8080/' })];
    withEntry(graph, agent);

    expect(await graph.serverControlScope('e-8080__p8080')).toEqual({ host: 'localhost', foreign: true });
  });

  it('위성이 127.0.0.1(우리 서버에 닿음)이면 그 호스트로만 죽이게 한다', async () => {
    const { graph, agent } = graphWithOwnership(async () => dualBind());
    agent.persistSatellites = [restoredSatellite(agent.path, 8080)];
    withEntry(graph, agent);

    expect(await graph.serverControlScope('e-8080__p8080')).toEqual({ host: '127.0.0.1', foreign: false });
  });

  it('위성이 없는 entry 는 포트 전체로 본다 — 하나라도 남의 것이면 죽이지 않는다', async () => {
    const { graph, agent } = graphWithOwnership(async () => dualBind());
    withEntry(graph, agent);

    expect(await graph.serverControlScope('e-8080__p8080')).toEqual({ foreign: true });
  });

  it('신고 전용 entry 는 신고된 주소의 호스트를 쓴다', async () => {
    const { graph, agent } = graphWithOwnership(async () => dualBind());
    withEntry(graph, agent, { command: 'http://127.0.0.1:8080/', reportedOnly: true });

    expect(await graph.serverControlScope('e-8080__p8080')).toEqual({ host: '127.0.0.1', foreign: false });
  });

  it('다른 탭이 없으면 조회 없이 통과(호스트는 그대로 넘긴다)', async () => {
    let calls = 0;
    const { graph, agent } = graphWithOwnership(async () => { calls += 1; return dualBind(); }, [OURS]);
    agent.persistSatellites = [restoredSatellite(agent.path, 8080, { url: 'http://localhost:8080/' })];
    withEntry(graph, agent);

    expect(await graph.serverControlScope('e-8080__p8080')).toEqual({ host: 'localhost', foreign: false });
    expect(calls).toBe(0);
  });

  it('이 그래프의 entry 가 아니면 null', async () => {
    const { graph } = graphWithOwnership(async () => dualBind());
    expect(await graph.serverControlScope('nope')).toBeNull();
  });
});

describe('§3.5 — 열어 둔 탭은 불러오기 전에 묻는다(checkIframeTab): B 를 보는 중에 누른 A 의 탭', () => {
  it('위성이 살아 있고 서버가 옮겼으면 그 위성 주소로 따라간다', async () => {
    const { graph, agent } = graphWithOwnership(async () => dualBind());
    agent.persistSatellites = [restoredSatellite(agent.path, 8080)];

    expect(await graph.checkIframeTab('special-8080', 'http://localhost:8080/')).toEqual({
      action: 'follow',
      url: 'http://127.0.0.1:8080/',
    });
  });

  it('위성이 걷혔고(A 의 서버가 내려감) 그 주소를 옆 프로젝트 vite 가 받으면 불러오지 않는다', async () => {
    const { graph } = graphWithOwnership(async () => only(19752, '::1', GAME_VITE_CMD));

    expect(await graph.checkIframeTab('special-8080', 'http://localhost:8080/')).toEqual({ action: 'block' });
  });

  it('위성이 없어도 같은 포트의 우리 서버가 127.0.0.1 로 닿으면 그리로 옮긴다', async () => {
    const { graph } = graphWithOwnership(async () => dualBind());

    expect(await graph.checkIframeTab(null, 'http://localhost:8080/')).toEqual({
      action: 'follow',
      url: 'http://127.0.0.1:8080/',
    });
  });

  it('위성 주소 그대로이고 우리 서버에 닿으면 그대로 보여 준다', async () => {
    const { graph, agent } = graphWithOwnership(async () => dualBind());
    agent.persistSatellites = [restoredSatellite(agent.path, 8080)];

    expect(await graph.checkIframeTab('special-8080', 'http://127.0.0.1:8080/')).toEqual({ action: 'show' });
  });

  it('다른 탭이 없으면 조회 없이 통과(위성 주소는 그래도 따른다)', async () => {
    let calls = 0;
    const { graph, agent } = graphWithOwnership(async () => { calls += 1; return dualBind(); }, [OURS]);
    agent.persistSatellites = [restoredSatellite(agent.path, 8080)];

    expect(await graph.checkIframeTab('special-8080', 'http://localhost:8080/')).toEqual({
      action: 'follow',
      url: 'http://127.0.0.1:8080/',
    });
    expect(await graph.checkIframeTab(null, 'http://localhost:8080/')).toEqual({ action: 'show' });
    expect(calls).toBe(0);
  });

  it('조회가 던지면 판정 불가 — 막지 않는다', async () => {
    const { graph } = graphWithOwnership(async () => { throw new Error('no lookup tool'); });

    expect(await graph.checkIframeTab(null, 'http://localhost:8080/')).toEqual({ action: 'show' });
  });

  it('ownsProjectPath — 이 그래프가 그리는 프로젝트 경로인가', () => {
    const { graph } = graphWithOwnership(async () => null);

    expect(graph.ownsProjectPath(OURS)).toBe(true);
    expect(graph.ownsProjectPath(GAME)).toBe(false);
  });
});
