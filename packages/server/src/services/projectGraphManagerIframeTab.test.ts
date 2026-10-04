/**
 * §7.11 / §3.5 — 열어 둔 프리뷰 탭의 판정은 **그 탭을 연 프로젝트**가 답한다(`ProjectGraphManager.checkIframeTab`).
 *
 * 사용자 신고(2026-10-01) "A 에서 테스트하던 프리뷰에 B 프로젝트 것이 열린다"의 남은 길: 탭 목록은 프로젝트
 * 탭과 상관없이 하나로 공유되고, 스냅샷은 창이 구독한 프로젝트만 싣는다. B 를 보는 중에 A 에서 연 탭을 누르면
 * 클라는 A 의 위성을 볼 수 없어 서버에 묻는다 — 그때 **B 가 아니라 A 기준으로** 판정해야 같은 주소를 받는 B 의
 * vite 가 "남의 것"으로 갈린다. 같은 주소라도 묻는 프로젝트에 따라 답이 반대여야 한다는 것이 이 파일의 핵심이다.
 */
import { describe, expect, it, vi } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import { ProjectGraphManager } from './projectGraphManager.js';
import { ProjectGraph } from './projectGraph.js';
import { clearPortOriginCache, type PortOwnership, type PortOwnershipLookup, type ProcessStartInfo } from './serverOrigin.js';
import { pathKey } from './pathKey.js';

// ⚠ 이 파일은 `registerProject` 를 부르지 않지만, 매니저가 열린 프로젝트를 홈의 app-state.json 에 쓰는 길은
//   미리 막아 둔다(테스트가 실제 상태를 오염시킨 전례).
vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

const A = 'C:/work/app-a';
const B = 'C:/work/game-b';
const B_VITE_CMD = '"node" "C:\\work\\game-b\\node_modules\\.bin\\\\..\\vite\\bin\\vite.js"';

/** A 의 서버는 내려갔고 B 의 vite 만 `[::1]:8080` 에 남았다. */
function onlyBOnLoopbackV6(): PortOwnership {
  return {
    listeners: [{ pid: 19752, address: '::1' }],
    starts: new Map<number, ProcessStartInfo | null>([[19752, { command: B_VITE_CMD }]]),
  };
}

function graphFor(root: string, lookup: PortOwnershipLookup): ProjectGraph {
  const graph = new ProjectGraph();
  (graph as unknown as { root: string | null }).root = root;
  graph.setKnownProjectRootsProvider(() => [A, B]);
  graph.setPortOwnershipLookup(lookup);
  return graph;
}

function managerWith(graphs: ReadonlyArray<readonly [string, ProjectGraph]>): ProjectGraphManager {
  clearPortOriginCache();
  const manager = new ProjectGraphManager();
  const instances = (manager as unknown as { instances: Map<string, ProjectGraph> }).instances;
  instances.clear();
  for (const [root, graph] of graphs) instances.set(pathKey(root), graph);
  return manager;
}

function iframeSatellite(sessionPath: string, url: string): BubbleData {
  return {
    id: 'special-8080',
    label: 'localhost:8080',
    bubbleType: 'iframe',
    path: `__special__iframe__${sessionPath}__8080`,
    status: 'active',
    activity: 1,
    lastActivity: Date.now(),
    url,
    iframeAlive: true,
  };
}

describe('ProjectGraphManager.checkIframeTab — 같은 주소라도 묻는 프로젝트에 따라 답이 갈린다', () => {
  it('A 에서 연 탭은 A 기준으로 막고, B 에서 연 탭은 B 의 서버라 그대로 보여 준다', async () => {
    const lookup: PortOwnershipLookup = async () => onlyBOnLoopbackV6();
    const manager = managerWith([[A, graphFor(A, lookup)], [B, graphFor(B, lookup)]]);

    expect(await manager.checkIframeTab(A, 'special-8080', 'http://localhost:8080/')).toEqual({ action: 'block' });
    expect(await manager.checkIframeTab(B, null, 'http://localhost:8080/')).toEqual({ action: 'show' });
  });

  it('경로 대소문자·구분자가 달라도 같은 프로젝트로 찾는다(이 기기의 경로 규칙)', async () => {
    const lookup: PortOwnershipLookup = async () => onlyBOnLoopbackV6();
    const manager = managerWith([[A, graphFor(A, lookup)], [B, graphFor(B, lookup)]]);

    expect(await manager.checkIframeTab(pathKey(A), null, 'http://localhost:8080/')).toEqual({ action: 'block' });
  });

  it('프로젝트를 모르는 탭(옛 닫은 탭 항목)은 그 위성을 가진 인스턴스가 답한다', async () => {
    const lookup: PortOwnershipLookup = async () => onlyBOnLoopbackV6();
    const a = graphFor(A, lookup);
    const agent = a.createCustomAgent('Runner');
    agent.persistSatellites = [iframeSatellite(agent.path, 'http://127.0.0.1:8080/')];
    const manager = managerWith([[A, a], [B, graphFor(B, lookup)]]);

    // 위성은 이미 127.0.0.1 로 옮겨져 있다 — B 의 vite([::1])는 거기 닿지 않으니 탭은 위성 주소로 따라간다.
    expect(await manager.checkIframeTab(null, 'special-8080', 'http://localhost:8080/')).toEqual({
      action: 'follow',
      url: 'http://127.0.0.1:8080/',
    });
  });

  it('어느 인스턴스에서도 못 찾으면 판정 불가 — 막지 않는다', async () => {
    const manager = managerWith([]);

    expect(await manager.checkIframeTab('C:/nowhere', 'special-1', 'http://localhost:8080/')).toEqual({ action: 'show' });
  });
});
