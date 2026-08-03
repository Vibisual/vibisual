import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { ProjectGraph } from './projectGraph.js';
import type { ServerEntry } from '@vibisual/shared';

/**
 * §7.11 v3.85 — 에이전트가 신고한 iframe(`POST /api/agent-iframe`)에도 짝이 되는 ServerEntry 가
 * 생겨야 한다. 없으면 `IframeServerCard` 가 `serverId=null` 이라 **Stop 이 영구 disabled** 였다
 * (사용자 보고: "running 인데 왜 Stop 이 비활성이냐").
 */

const servers: Server[] = [];

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

/** 실제로 200 을 주는 로컬 서버를 띄운다 — 신고 경로는 isPortAlive + isUrlServing 게이트를 통과해야 한다. */
async function listen(): Promise<number> {
  const server = createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  return addr.port;
}

/** 신고는 비동기 probe 뒤에 위성/entry 를 만든다 — 조건이 참이 될 때까지 짧게 폴링. */
async function waitFor(cond: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timeout');
}

function entriesOf(graph: ProjectGraph): ServerEntry[] {
  return Object.values(graph.getSnapshot().runningServers).flat();
}

describe('§7.11 신고 iframe ↔ ServerEntry 짝', () => {
  it('신고로 만들어진 iframe 위성에 reportedOnly ServerEntry 가 함께 생긴다', async () => {
    const port = await listen();
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Reporter');
    const url = `http://127.0.0.1:${port}/index.html`;

    expect(graph.reportIframeFromAgent(agent.id, url)).toBe(true);
    await waitFor(() => entriesOf(graph).length > 0);

    const entries = entriesOf(graph);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.port).toBe(port);
    expect(entries[0]?.reportedOnly).toBe(true);
    // 위성과 1:1 — 둘 다 있어야 IframeServerCard 가 Stop 을 활성화한다.
    const iframes = (agent.persistSatellites ?? []).filter((s) => s.bubbleType === 'iframe');
    expect(iframes).toHaveLength(1);
    expect(iframes[0]?.url).toBe(url);
  });

  it('같은 서버를 다시 신고해도 entry 가 늘지 않는다', async () => {
    const port = await listen();
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Reporter');
    const url = `http://127.0.0.1:${port}/`;

    graph.reportIframeFromAgent(agent.id, url);
    await waitFor(() => entriesOf(graph).length > 0);
    graph.reportIframeFromAgent(agent.id, url);
    await new Promise((r) => setTimeout(r, 300));

    expect(entriesOf(graph)).toHaveLength(1);
  });

  it('watcher 가 진짜 명령을 잡으면 신고 entry 가 승격되고 포트당 1행이 유지된다', async () => {
    const port = await listen();
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Reporter');
    graph.reportIframeFromAgent(agent.id, `http://127.0.0.1:${port}/`);
    await waitFor(() => entriesOf(graph).length > 0);

    // 감지 경로(watcher → ensureServerEntryForShell)가 나중에 같은 포트를 등록하는 상황.
    const internals = graph as unknown as {
      registerServerPort(
        sessionId: string, command: string, port: number,
        shellId: string | undefined, outputFile: string | undefined, toolUseId: string | undefined,
      ): boolean;
    };
    internals.registerServerPort(agent.path, 'pnpm dev', port, 'shell-1', '/tmp/out.log', undefined);

    const entries = entriesOf(graph);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.command).toBe('pnpm dev');
    expect(entries[0]?.shellId).toBe('shell-1');
    expect(entries[0]?.reportedOnly).toBeUndefined();
  });
});
