/**
 * §7.11 감지 폴백 — 끝난 Bash 의 명령·출력에 찍힌 루프백 주소로 프리뷰를 만든다
 * (이미 떠 있던 서버라 `run_in_background` 셸이 없어도, 에이전트는 생존 확인으로 그 주소를 친다).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { ProjectGraph } from './projectGraph.js';
import { setVibisualOwnPorts } from './processChecker.js';
import type { BubbleData, HookEventPayload } from '@vibisual/shared';

const servers: Server[] = [];

beforeEach(() => { setVibisualOwnPorts([]); });
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  setVibisualOwnPorts([]);
});

async function listen(host = '127.0.0.1'): Promise<number> {
  const server = createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  return addr.port;
}

async function waitFor(cond: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timeout');
}

function bashDone(sessionId: string, command: string, stdout: string, toolUseId = 'tu-1'): HookEventPayload {
  return {
    session_id: sessionId,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { stdout, stderr: '' },
    tool_use_id: toolUseId,
    // cwd 는 일부러 뺀다 — 넣으면 ProjectGraph 가 이 테스트 폴더를 프로젝트로 등록한다.
  };
}

/** TTL probe 문을 연다 — 같은 (세션,포트)를 60초 안에 다시 찌르지 않는 가드라, 그걸 지나
 *  **그 다음 가드**(사용자가 지운 프리뷰)를 실제로 시험하려면 문을 비워야 한다. */
function clearProbeGate(graph: ProjectGraph): void {
  (graph as unknown as { loopbackSniffProbedAt: Map<string, number> }).loopbackSniffProbedAt.clear();
}

function iframesOf(sats: BubbleData[] | undefined): BubbleData[] {
  return (sats ?? []).filter((s) => s.bubbleType === 'iframe');
}

describe('§7.11 — foreground Bash 의 루프백 주소로 프리뷰 회수', () => {
  it('이미 떠 있던 서버를 확인만 한 curl 에서도 프리뷰가 선다(background 셸 없음)', async () => {
    const port = await listen();
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Runner');
    const url = `http://localhost:${String(port)}/`;

    // run_in_background 아님 — 종전 감지는 여기서 아무것도 하지 않았다.
    graph.processHookEvent(bashDone(agent.path, `curl -s ${url}`, 'ok'));
    await waitFor(() => iframesOf(agent.persistSatellites).length > 0);

    const sat = iframesOf(agent.persistSatellites)[0];
    expect(sat?.url).toBe(url);
    // 짝 ServerEntry 도 — 없으면 IframeServerCard 의 Stop 이 영구 비활성.
    expect(Object.values(graph.getSnapshot().runningServers).flat()).toHaveLength(1);
  });

  it('출력에만 찍힌 주소도 잡고, 경로를 잃지 않는다', async () => {
    const port = await listen();
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Runner');
    const banner = `  ➜  Local:   http://localhost:${String(port)}/game.html\n  ready in 300 ms`;

    graph.processHookEvent(bashDone(agent.path, 'node scripts/smoke.mjs', banner));
    await waitFor(() => iframesOf(agent.persistSatellites).length > 0);

    expect(iframesOf(agent.persistSatellites)[0]?.url).toBe(`http://localhost:${String(port)}/game.html`);
  });

  it('IPv6 에만 뜬 서버를 127.0.0.1 로 확인했어도 접속되는 주소로 프리뷰를 만든다', async () => {
    const port = await listen('::1');
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Runner');

    graph.processHookEvent(bashDone(agent.path, `curl -s http://127.0.0.1:${String(port)}/`, ''));
    await waitFor(() => iframesOf(agent.persistSatellites).length > 0);

    // 확인한 주소와 화면에 여는 주소가 갈리지 않아야 한다 — 127.0.0.1 그대로면 iframe 이 안 열린다.
    expect(iframesOf(agent.persistSatellites)[0]?.url).toMatch(/(localhost|\[::1\])/);
  });

  it('죽은 주소로는 프리뷰를 만들지 않는다', async () => {
    const port = await listen();
    await new Promise<void>((r) => { servers.pop()?.close(() => { r(); }); });
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Runner');

    graph.processHookEvent(bashDone(agent.path, `curl -s http://localhost:${String(port)}/`, ''));
    await new Promise((r) => setTimeout(r, 600));

    expect(iframesOf(agent.persistSatellites)).toHaveLength(0);
  });

  it('우리 자신의 포트(카드 엔드포인트 curl)는 프리뷰가 되지 않는다', async () => {
    const port = await listen();
    setVibisualOwnPorts([port]);
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Runner');

    graph.processHookEvent(bashDone(
      agent.path,
      `curl -s -X POST "http://127.0.0.1:${String(port)}/api/agent-report" -d @-`,
      '{"ok":true}',
    ));
    await new Promise((r) => setTimeout(r, 600));

    expect(iframesOf(agent.persistSatellites)).toHaveLength(0);
  });

  it('바깥 주소는 프리뷰가 되지 않는다', async () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Runner');

    graph.processHookEvent(bashDone(agent.path, 'curl -s https://example.com:8080/', 'hello'));
    await new Promise((r) => setTimeout(r, 400));

    expect(iframesOf(agent.persistSatellites)).toHaveLength(0);
  });

  it('사용자가 지운 프리뷰는 다음 curl 한 번에 되살아나지 않는다', async () => {
    const port = await listen();
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Runner');
    const url = `http://localhost:${String(port)}/`;

    graph.processHookEvent(bashDone(agent.path, `curl -s ${url}`, 'ok'));
    await waitFor(() => iframesOf(agent.persistSatellites).length > 0);

    const sat = iframesOf(agent.persistSatellites)[0];
    expect(sat).toBeDefined();
    graph.removeBubble(sat?.id ?? '');
    expect(iframesOf(agent.persistSatellites)).toHaveLength(0);

    // probe 문을 열고 같은 주소를 다시 확인 — 그래도 지운 뜻이 유지돼야 한다.
    clearProbeGate(graph);
    graph.processHookEvent(bashDone(agent.path, `curl -s ${url}`, 'ok', 'tu-2'));
    await new Promise((r) => setTimeout(r, 600));
    expect(iframesOf(agent.persistSatellites)).toHaveLength(0);
  });
});

/** §7.11 — 주운 주소를 그대로 열지 않는다: 상태 확인용 `curl …/api/backtest/state` 가 프리뷰 주소가 되면 화면 대신 API 로 빠진다. */
describe('§7.11 — 프리뷰는 그 서버의 화면을 연다(API 경로는 정문으로)', () => {
  /** `/` 는 페이지, `/api/…` 는 JSON — 실제 Express 앱(정적 public + res.json)의 모양. */
  async function listenApp(): Promise<number> {
    const server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>ok</html>'); return; }
      if (path === '/api/backtest/state') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"runs":[]}'); return; }
      res.writeHead(404); res.end('nope');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('no port');
    return addr.port;
  }

  it('API 를 확인한 curl 에서는 정문 주소로 프리뷰가 선다', async () => {
    const port = await listenApp();
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Runner');
    const api = `http://127.0.0.1:${String(port)}/api/backtest/state`;

    graph.processHookEvent(bashDone(agent.path, `curl -s ${api}`, '{"runs":[]}'));
    await waitFor(() => iframesOf(agent.persistSatellites).length > 0);

    expect(iframesOf(agent.persistSatellites)[0]?.url).toBe(`http://127.0.0.1:${String(port)}/`);
  });

  it('정문이 없는 서버면 확인된 그 주소를 지킨다 — 안 열리는 주소로 바꾸지 않는다', async () => {
    // `/` 는 404, `/data.json` 만 응답하는 서버.
    const server = createServer((req, res) => {
      if ((req.url ?? '/') === '/data.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
      res.writeHead(404); res.end('nope');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('no port');
    const url = `http://127.0.0.1:${String(addr.port)}/data.json`;

    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Runner');
    graph.processHookEvent(bashDone(agent.path, `curl -s ${url}`, '{}'));
    await waitFor(() => iframesOf(agent.persistSatellites).length > 0);

    expect(iframesOf(agent.persistSatellites)[0]?.url).toBe(url);
  });

  it('옛 판본이 저장해 둔 API 주소 위성은 생사 sweep 에서 정문으로 고쳐진다', async () => {
    const port = await listenApp();
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Runner');
    // 체크포인트에서 복원된 모양 그대로 — 생성 경로를 안 타고 이미 굳어 있는 위성.
    agent.persistSatellites = [{
      id: 'special-old',
      label: `localhost:${String(port)}`,
      bubbleType: 'iframe',
      path: `__special__iframe__${agent.path}__${String(port)}`,
      status: 'active',
      activity: 1,
      lastActivity: Date.now(),
      url: `http://127.0.0.1:${String(port)}/api/backtest/state`,
      iframeAlive: true,
    }];

    await graph.checkIframesAlive();

    expect(iframesOf(agent.persistSatellites)[0]?.url).toBe(`http://127.0.0.1:${String(port)}/`);
  });

  it('문서 경로는 sweep 이 건드리지 않는다 — `/game.html` 은 그대로 남는다', async () => {
    const port = await listen();
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Runner');
    const url = `http://127.0.0.1:${String(port)}/game.html`;
    agent.persistSatellites = [{
      id: 'special-keep',
      label: `localhost:${String(port)}`,
      bubbleType: 'iframe',
      path: `__special__iframe__${agent.path}__${String(port)}`,
      status: 'active',
      activity: 1,
      lastActivity: Date.now(),
      url,
      iframeAlive: true,
    }];

    await graph.checkIframesAlive();

    expect(iframesOf(agent.persistSatellites)[0]?.url).toBe(url);
  });
});
