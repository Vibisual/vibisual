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
 */
import { describe, it, expect } from 'vitest';
import { ProjectGraph } from './projectGraph.js';
import { clearPortOriginCache, type ProcessStartInfo } from './serverOrigin.js';
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
