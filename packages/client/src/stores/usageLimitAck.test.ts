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

/**
 * §5.5 #17-47 (G) — **창 목록은 경고하는 자리가 아니라 고르는 자리다.**
 *
 * (E) 는 목록 머리에 "한도로 멈춘 세션 N개" 띠를, (F) 는 그 안에 [확인] 버튼을 두었다. 그런데
 * 같은 화면이 이미 세 번 같은 말을 한다 — 배지의 주황 도트("손대야 다시 간다")·맨 위로 올라온
 * 줄("여기 있다")·줄 오른쪽 리셋 칩("언제 풀린다"). 그 위에 글자 띠를 한 겹 더 얹으니 메뉴를
 * 여는 손짓이 고르기 대신 읽기가 됐다(사용자 지시 2026-09-23 — "그냥 주황색에 세션 들어갈 수
 * 있게 선택만 하면 되는데 경고를 왜 보네 여기서").
 *
 * 이 시험이 못 박는 것은 **걷어 낸 뒤에도 잃지 않은 것**이다: 색(주황)·자리(맨 위)·칩은 그대로고,
 * 확인은 줄을 누르는 그 손짓이 버블 단위로 계속한다. 띠만 다시 자라지 못하게 막는다.
 * (창을 띄우지 않는다 — 클라 테스트에는 DOM 이 없다. 소스와 번들을 그대로 읽는다.)
 */
const menuSources = import.meta.glob('../components/Layout/IDEWindowsMenu.tsx', {
  eager: true, query: '?raw', import: 'default',
}) as Record<string, string>;
const localeBundles = import.meta.glob('../i18n/locales/*.json', {
  eager: true, import: 'default',
}) as Record<string, { header?: { ideWindows?: Record<string, unknown> } }>;

describe('§5.5 #17-47 (G) 한도 띠는 걷혔다 — 남은 것은 색과 자리뿐', () => {
  const menu = Object.values(menuSources)[0] ?? '';

  it('훑을 판이 비지 않았다 — 비면 아래가 전부 헛통과한다', () => {
    expect(menu.length).toBeGreaterThan(2000);
    expect(Object.keys(localeBundles)).toHaveLength(12);
  });

  it('목록 머리에 경고 띠도 [확인] 버튼도 그리지 않는다', () => {
    expect(menu).not.toContain('limitedBanner');
    expect(menu).not.toContain('limitedAck');
    expect(menu).not.toContain('badgeLimited');
  });

  it('주황은 그대로 남는다 — 배지 도트·줄 도트·리셋 칩이 같은 말을 한다', () => {
    expect(menu).toContain("limited: 'bg-orange-400 animate-pulse'");
    expect(menu).toContain("run.state === 'limited'");
    expect(menu).toContain('header.ideWindows.limitedUntil');
  });

  it('멈춘 줄은 여전히 맨 위다 — 띠가 가리키던 자리를 목록 자체가 말한다', () => {
    expect(menu).toContain("const byLimited = (b.run.state === 'limited' ? 1 : 0) - (a.run.state === 'limited' ? 1 : 0);");
  });

  it('확인은 줄을 누르는 그 손짓이 한다 — 버블 단위로 함께 걷힌다', () => {
    expect(menu).toContain('acknowledgeUsageLimit({ agentIds: [agentId] })');
  });

  it('12 로케일 어디에도 걷어 낸 문자열이 남지 않았다 — 한 곳만 걷으면 키가 갈린다', () => {
    for (const [path, bundle] of Object.entries(localeBundles)) {
      const keys = Object.keys(bundle.header?.ideWindows ?? {}).filter((k) => k.startsWith('limited'));
      expect({ path, keys }).toEqual({ path, keys: ['limited', 'limitedUntil'] });
    }
  });
});
