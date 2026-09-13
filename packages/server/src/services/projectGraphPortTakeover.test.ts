import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ServerEntry } from '@vibisual/shared';

/**
 * §7.11 포트 인계 — **에이전트가 켠 서버를 우리가 넘겨받는다.**
 *
 * v3.85 까지는 신고로만 알게 된 서버(`reportedOnly`)의 Restart/Start 가 영구 disabled 였다
 * (사용자 보고: "이건 iframe 버블인데 왜 재시작 불가야 — 에이전트가 켰더라도 내가 껐다 켰다
 * 할 수 있어야지"). 이제는 그 프로세스가 살아 있는 동안 OS 프로세스 테이블에서 기동 명령을
 * 읽어 승격시킨다. 여기서는 OS 조회 자체는 흉내 내고 **승격 규약**만 고정한다.
 */
const takeoverPortCommand = vi.hoisted(() => vi.fn());
vi.mock('./portTakeover.js', () => ({ takeoverPortCommand }));

const { ProjectGraph } = await import('./projectGraph.js');

interface Internals {
  ensureReportedServerEntry(sessionId: string, url: string, port: number): void;
  registerServerPort(
    sessionId: string, command: string, port: number,
    shellId: string | undefined, outputFile: string | undefined, toolUseId: string | undefined,
  ): boolean;
}

function entriesOf(graph: InstanceType<typeof ProjectGraph>): ServerEntry[] {
  return Object.values(graph.getSnapshot().runningServers).flat();
}

/** 신고 시점 인계는 비동기다 — 조건이 참이 될 때까지 짧게 폴링. */
async function waitFor(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timeout');
}

describe('§7.11 포트 인계 — 신고 서버를 우리 것으로 승격', () => {
  beforeEach(() => { takeoverPortCommand.mockReset(); });

  it('신고 즉시 기동 명령을 읽어 오면 reportedOnly 가 풀려 Restart/Start 가 열린다', async () => {
    takeoverPortCommand.mockResolvedValue({ command: 'pnpm dev', cwd: '/proj/web', pid: 4242, via: 'ps' });
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Reporter');
    (graph as unknown as Internals).ensureReportedServerEntry(agent.path, 'http://127.0.0.1:5199/', 5199);

    await waitFor(() => entriesOf(graph)[0]?.reportedOnly === undefined);
    const entry = entriesOf(graph)[0];
    expect(entry?.command).toBe('pnpm dev');
    // cwd 를 함께 실어야 하위 폴더에서 띄운 서버가 세션 cwd 로 되살아나 파일을 못 찾는 일이 없다.
    expect(entry?.cwd).toBe('/proj/web');
    expect(entry?.pid).toBe(4242);
    expect(entry?.takeoverFailed).toBeUndefined();
  });

  it('명령을 못 읽으면 아무것도 죽이지 않고 takeoverFailed 만 세운다', async () => {
    takeoverPortCommand.mockResolvedValue(null);
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Reporter');
    (graph as unknown as Internals).ensureReportedServerEntry(agent.path, 'http://127.0.0.1:5198/', 5198);

    await waitFor(() => entriesOf(graph)[0]?.takeoverFailed === true);
    const entry = entriesOf(graph)[0];
    expect(entry?.reportedOnly).toBe(true);
    // 신고 URL 이 표시용 command 로 남아 있어야 목록이 빈 줄로 보이지 않는다.
    expect(entry?.command).toBe('http://127.0.0.1:5198/');
  });

  it('나중에 다시 시도해 성공하면 실패 표식이 지워진다 (한 번 실패가 영구 잠금이 되지 않는다)', async () => {
    takeoverPortCommand.mockResolvedValue(null);
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Reporter');
    (graph as unknown as Internals).ensureReportedServerEntry(agent.path, 'http://127.0.0.1:5197/', 5197);
    await waitFor(() => entriesOf(graph)[0]?.takeoverFailed === true);

    takeoverPortCommand.mockResolvedValue({ command: 'node server.js', pid: 7, via: '/proc/cmdline' });
    const id = entriesOf(graph)[0]?.id ?? '';
    expect(await graph.takeoverServerEntry(id)).toBe(true);

    const entry = entriesOf(graph)[0];
    expect(entry?.reportedOnly).toBeUndefined();
    expect(entry?.takeoverFailed).toBeUndefined();
    expect(entry?.command).toBe('node server.js');
  });

  it('이미 진짜 명령을 가진 entry 는 인계 대상이 아니다 (OS 조회를 부르지 않는다)', async () => {
    takeoverPortCommand.mockResolvedValue({ command: 'should not be used', pid: 1, via: 'ps' });
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Reporter');
    (graph as unknown as Internals).registerServerPort(agent.path, 'pnpm dev', 5196, 'shell-1', undefined, undefined);
    takeoverPortCommand.mockClear();

    const id = entriesOf(graph)[0]?.id ?? '';
    expect(await graph.takeoverServerEntry(id)).toBe(false);
    expect(takeoverPortCommand).not.toHaveBeenCalled();
    expect(entriesOf(graph)[0]?.command).toBe('pnpm dev');
  });

  it('watcher 승격은 인계 실패 표식까지 함께 지운다 (열린 버튼 위에 틀린 툴팁이 남지 않게)', async () => {
    takeoverPortCommand.mockResolvedValue(null);
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Reporter');
    (graph as unknown as Internals).ensureReportedServerEntry(agent.path, 'http://127.0.0.1:5195/', 5195);
    await waitFor(() => entriesOf(graph)[0]?.takeoverFailed === true);

    (graph as unknown as Internals).registerServerPort(agent.path, 'pnpm dev', 5195, 'shell-9', undefined, undefined);

    const entries = entriesOf(graph);
    expect(entries).toHaveLength(1); // 포트당 1행 유지
    expect(entries[0]?.command).toBe('pnpm dev');
    expect(entries[0]?.reportedOnly).toBeUndefined();
    expect(entries[0]?.takeoverFailed).toBeUndefined();
  });
});
