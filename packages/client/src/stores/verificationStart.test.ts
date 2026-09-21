import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BubbleData, VerificationRun } from '@vibisual/shared';
import { useGraphStore } from './graphStore.js';
const target = { kind: 'browser' as const, url: 'http://localhost:3000' };

const run: VerificationRun = {
  id: 'ver-start',
  agentId: 'agent-verify',
  subAgentId: 'sub-verify',
  projectName: 'demo',
  recipeSource: 'none',
  status: 'queued',
  verdict: 'unknown',
  attempts: [],
  startedAt: 100,
};

function response(): Response {
  return new Response(JSON.stringify({ ok: true, run }), { status: 200 });
}

describe('검증 시작 응답과 스냅샷 순서', () => {
  beforeEach(() => useGraphStore.setState({
    agents: [{ id: run.agentId, customCreated: true } as BubbleData],
    verificationRuns: {},
  }));
  afterEach(() => vi.unstubAllGlobals());

  it('응답이 먼저 도착하면 녹화 시작 전에 서버 실행 기록이 존재한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response()));
    const result = await useGraphStore.getState().startVerification({ agentId: run.agentId, subAgentId: run.subAgentId, target });
    expect(result).toEqual({ ok: true, runId: run.id });
    expect(useGraphStore.getState().verificationRuns[run.subAgentId]).toEqual([run]);
    // 나중에 같은 snapshot 이 도착해도 같은 실행이 두 개 생기지 않는다.
    useGraphStore.getState().applyVerificationRuns({ [run.subAgentId]: [run] });
    expect(useGraphStore.getState().verificationRuns[run.subAgentId]).toHaveLength(1);
  });

  it('응답을 기다리는 동안 완료 snapshot 이 오면 오래된 queued 응답이 덮지 않는다', async () => {
    let resolveFetch!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));
    const pending = useGraphStore.getState().startVerification({ agentId: run.agentId, subAgentId: run.subAgentId, target });
    const finished: VerificationRun = { ...run, status: 'done', verdict: 'pass', finishedAt: 200, durationMs: 100 };
    useGraphStore.getState().applyVerificationRuns({ [run.subAgentId]: [finished] });
    const latest = useGraphStore.getState().verificationRuns;
    resolveFetch(response());
    expect(await pending).toEqual({ ok: true, runId: run.id });
    expect(useGraphStore.getState().verificationRuns).toBe(latest);
    expect(useGraphStore.getState().verificationRuns[run.subAgentId]).toEqual([finished]);
  });

  it('전달한 실행 대상·기대 결과·시연을 누락하지 않는다', async () => {
    const fetcher = vi.fn(async () => response());
    vi.stubGlobal('fetch', fetcher);
    await useGraphStore.getState().startVerification({ agentId: run.agentId, subAgentId: run.subAgentId, target, expected: 'Saved', demoId: 'demo-one' });
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('/api/verification-runs');
    expect(JSON.parse(call[1].body as string)).toMatchObject({ target, expected: 'Saved', demoId: 'demo-one' });
  });
});
