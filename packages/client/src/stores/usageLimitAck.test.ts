import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BubbleData, SubAgent, UsageLimitStop } from '@vibisual/shared';

import { useGraphStore } from './graphStore.js';

/**
 * §2.4 (한도 정지) — **다른 루트로 눌러도 그 세션은 확인된다.**
 *
 * 주황 표식(`SubAgent.usageLimit`)은 서버가 세우고 서버가 걷는다(§3.1). 클라가 할 일은 "사용자가
 * 이 세션을 봤다"는 손짓을 그 창구로 흘리는 것 하나다. 그 배선이 **세션을 앞으로 세우는 길
 * 하나하나에 흩어져** 있으면 반드시 한둘이 빠지고, 사용자에게는 "어떤 데서 누르면 꺼지고 어떤
 * 데서 누르면 안 꺼지는" 화면이 된다. 그래서 배선을 두 자리로 모았고 — `setIDEActiveSession`
 * (탭·북마크·지휘통제실·두뇌 피드·콘티 이력이 전부 지나간다)과 `markSubAcknowledged`(본문 클릭·
 * 타이핑) — 이 시험이 그 둘을 못 박는다.
 *
 * 함께 고정하는 것 하나 더: **걷을 것이 없으면 왕복을 내지 않는다.** 세션 탭은 수시로 눌리는
 * 자리라, 검사 없이 붙이면 멀쩡한 클릭마다 POST 가 하나씩 나간다.
 */

const PROJ = 'proj';
const AGENT = 'agent-1';
const OTHER = 'agent-2';

const ORIGINAL_FETCH = globalThis.fetch;

const STOP: UsageLimitStop = {
  kind: 'session',
  at: 1_757_000_000_000,
  message: "You've hit your session limit · resets 3am (Asia/Seoul)",
  resetsLabel: '3am (Asia/Seoul)',
};

interface Call { url: string; body: Record<string, unknown> }

let calls: Call[] = [];

function agentNode(id: string): BubbleData {
  return { id, label: id, bubbleType: 'agent', path: id, status: 'idle', activity: 0 };
}

function sub(id: string, parentAgentId: string, limited: boolean): SubAgent {
  return {
    id,
    parentAgentId,
    label: id,
    status: 'idle',
    createdAt: 0,
    lastActivityAt: 0,
    ...(limited ? { usageLimit: STOP } : {}),
  } as SubAgent;
}

beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    return { ok: true, json: async () => ({ ok: true, cleared: [] }) } as unknown as Response;
  }) as unknown as typeof fetch;

  useGraphStore.setState({
    activeProject: PROJ,
    nodeMap: { [AGENT]: agentNode(AGENT), [OTHER]: agentNode(OTHER) },
    agents: [agentNode(AGENT), agentNode(OTHER)],
    agentProjects: { [AGENT]: PROJ, [OTHER]: PROJ },
    ideOverlays: {},
    idePaneSeq: 0,
    acknowledgedSubAgents: {},
    selectedSubByAgent: {},
    subAgents: {
      [AGENT]: [sub('sub-limited', AGENT, true), sub('sub-quiet', AGENT, false)],
      [OTHER]: [sub('sub-other', OTHER, true)],
    },
  });
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

/** 한도 확인 창구로 나간 왕복만 추린다(스토어의 다른 REST 호출과 섞이지 않게). */
function ackCalls(): Call[] {
  return calls.filter((c) => c.url.includes('/api/usage-limit-ack'));
}

describe('한도 정지 확인 — 클라는 손짓만 흘린다', () => {
  it('걷을 것이 없으면 왕복을 내지 않는다', () => {
    useGraphStore.getState().acknowledgeUsageLimit({ subAgentIds: ['sub-quiet'] });
    expect(ackCalls()).toHaveLength(0);

    useGraphStore.getState().acknowledgeUsageLimit({ subAgentIds: ['sub-does-not-exist'] });
    expect(ackCalls()).toHaveLength(0);
  });

  it('멈춘 세션을 짚으면 그 손짓 그대로 서버에 보낸다 — 대상 판정은 서버 몫이다', () => {
    useGraphStore.getState().acknowledgeUsageLimit({ subAgentIds: ['sub-limited'] });

    expect(ackCalls()).toHaveLength(1);
    expect(ackCalls()[0]!.body).toEqual({ subAgentIds: ['sub-limited'] });
  });

  it('버블 단위 손짓은 agentIds 로 간다 — 그 버블의 나머지 멈춘 세션까지 서버가 걷는다', () => {
    useGraphStore.getState().acknowledgeUsageLimit({ agentIds: [AGENT] });

    expect(ackCalls()).toHaveLength(1);
    expect(ackCalls()[0]!.body).toEqual({ agentIds: [AGENT] });
  });

  it('멈춘 것이 없는 버블을 짚으면 왕복이 나가지 않는다', () => {
    useGraphStore.setState({ subAgents: { [AGENT]: [sub('sub-quiet', AGENT, false)] } });
    useGraphStore.getState().acknowledgeUsageLimit({ agentIds: [AGENT] });
    expect(ackCalls()).toHaveLength(0);
  });

  it('클라가 표식을 직접 지우지 않는다 — 걷는 것은 서버고, 스냅샷이 그 결과를 싣고 온다', () => {
    useGraphStore.getState().acknowledgeUsageLimit({ subAgentIds: ['sub-limited'] });
    expect(useGraphStore.getState().subAgents[AGENT]?.[0]?.usageLimit).toEqual(STOP);
  });

  it('세션을 앞으로 세우는 길(setIDEActiveSession)이 그대로 확인 창구를 탄다', () => {
    useGraphStore.getState().openIDEOverlay(AGENT, { pane: 'new' });
    calls = [];

    useGraphStore.getState().setIDEActiveSession('sub-limited');

    expect(ackCalls()).toHaveLength(1);
    expect(ackCalls()[0]!.body).toEqual({ subAgentIds: ['sub-limited'] });
  });

  it('세션을 비우는 전환은 확인이 아니다 — null 에는 왕복이 없다', () => {
    useGraphStore.getState().openIDEOverlay(AGENT, { pane: 'new' });
    calls = [];

    useGraphStore.getState().setIDEActiveSession(null);
    expect(ackCalls()).toHaveLength(0);
  });

  it('본문 클릭·타이핑(markSubAcknowledged)도 같은 창구를 탄다', () => {
    useGraphStore.getState().markSubAcknowledged('sub-limited');

    expect(ackCalls()).toHaveLength(1);
    expect(useGraphStore.getState().acknowledgedSubAgents['sub-limited']).toBe(true);
  });

  it('이미 확인해 둔 세션이 뒤늦게 멎어도 다음 클릭에서 걷힌다 — 조기 반환에 묶이지 않는다', () => {
    // 완료를 먼저 확인해 둔 상태(초록 → 회색). 그 뒤 그 세션이 한도로 멎었다.
    useGraphStore.setState({ acknowledgedSubAgents: { 'sub-limited': true } });
    calls = [];

    useGraphStore.getState().markSubAcknowledged('sub-limited');

    expect(ackCalls()).toHaveLength(1);
  });

  it('왕복이 실패해도 화면을 막지 않는다 — 다음 확인·다음 명령이 다시 걷는다', () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(() => useGraphStore.getState().acknowledgeUsageLimit({ subAgentIds: ['sub-limited'] })).not.toThrow();
  });
});
