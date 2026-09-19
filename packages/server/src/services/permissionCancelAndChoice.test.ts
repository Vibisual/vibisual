/**
 * §5.3 #12-1-B · §5.22 — **권한 카드 취소**와 **답 넷**의 회귀.
 *
 * 이 기능이 조용히 깨질 자리는 넷이다.
 *  ① **죽은 호출이 허용으로 풀림** — 에이전트를 멈췄는데 카드가 남아 60초 뒤 기본 허용으로 풀리면,
 *     일어나지도 않을 호출이 원장에 "시간 초과 · 허용"으로 적힌다.
 *  ② **창구가 취소를 꾸밈** — 취소 표식은 서버만 싣는다. 요청 본문이 그 칸을 들고 오면 버린다.
 *  ③ **세션 기억이 새거나 남음** — 다른 세션으로 번지거나, 세션을 지워도 남거나, 끝없이 쌓인다.
 *  ④ **취소가 거부로 세어짐** — 멈춘 에이전트가 "거부가 늘었다"로 읽힌다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionDecision, WSMessage } from '@vibisual/shared';
import {
  PERMISSION_CHOICES,
  applyToolListAlways,
  foldPermissionChoice,
  isToolDisallowed,
  permissionDecisionSource,
} from '@vibisual/shared';
import { setBroadcastSink } from '../broadcastBus.js';
import { PERMISSION_CANCELLED_REASON, PermissionBroker } from './permissionBroker.js';
import { PermissionSessionGrants } from './permissionSessionGrants.js';
import { AuditLogService, countsAsDenied } from './auditLog.js';

function baseInput(overrides: { agentId?: string; subAgentId?: string; toolName?: string } = {}) {
  return {
    agentId: overrides.agentId ?? 'agent-a',
    ...(overrides.subAgentId === undefined ? { subAgentId: 'sub-a' } : overrides.subAgentId ? { subAgentId: overrides.subAgentId } : {}),
    agentLabel: 'A',
    agentColor: '#6b7280',
    projectName: 'proj',
    toolName: overrides.toolName ?? 'Bash',
    toolInput: { command: 'ls' },
  };
}

describe('공유 순수 함수 — 답 넷과 목록 두 칸', () => {
  it('답 넷은 훅이 알아듣는 두 낱말로만 접힌다', () => {
    expect(PERMISSION_CHOICES).toEqual(['allow_once', 'allow_always', 'reject_once', 'reject_always']);
    expect(foldPermissionChoice('allow_once')).toBe('allow');
    expect(foldPermissionChoice('allow_always')).toBe('allow');
    expect(foldPermissionChoice('reject_once')).toBe('deny');
    expect(foldPermissionChoice('reject_always')).toBe('deny');
  });

  it('금지 목록은 정확한 이름으로만 맞춘다(비었거나 없으면 아무것도 막지 않는다)', () => {
    expect(isToolDisallowed(['Bash'], 'Bash')).toBe(true);
    expect(isToolDisallowed(['Bash'], 'bash')).toBe(false);
    expect(isToolDisallowed(['Bash'], 'BashOutput')).toBe(false);
    expect(isToolDisallowed([], 'Bash')).toBe(false);
    expect(isToolDisallowed(undefined, 'Bash')).toBe(false);
    expect(isToolDisallowed(['Bash'], '')).toBe(false);
  });

  it('항상 허용은 확인 목록에서만 빼고 금지 목록은 건드리지 않는다', () => {
    const ask = ['Bash', 'Write'];
    const dis = ['WebFetch'];
    const next = applyToolListAlways({ askTools: ask, disallowedTools: dis }, 'Bash', 'allow_always');
    expect(next).toEqual({ askTools: ['Write'], disallowedTools: ['WebFetch'] });
    // 원본은 그대로다(호출부가 저장 전 비교에 쓴다).
    expect(ask).toEqual(['Bash', 'Write']);
    expect(dis).toEqual(['WebFetch']);
  });

  it('항상 거절은 금지 목록에 한 번만 넣고 확인 목록에서 뺀다', () => {
    expect(applyToolListAlways({ askTools: ['Bash'], disallowedTools: undefined }, 'Bash', 'reject_always'))
      .toEqual({ askTools: [], disallowedTools: ['Bash'] });
    expect(applyToolListAlways({ askTools: undefined, disallowedTools: ['Bash'] }, 'Bash', 'reject_always'))
      .toEqual({ askTools: undefined, disallowedTools: ['Bash'] });
  });

  it('없던 칸에 빈 배열을 만들지 않는다', () => {
    expect(applyToolListAlways({ askTools: undefined, disallowedTools: undefined }, 'Bash', 'allow_always'))
      .toEqual({ askTools: undefined, disallowedTools: undefined });
  });

  it('원장 출처는 서버만 싣는 취소 표식으로 가른다 — reason 낱말로는 취소가 되지 않는다', () => {
    expect(permissionDecisionSource({ reason: 'cancelled', cancelled: 'agent-stopped' })).toBe('cancelled');
    expect(permissionDecisionSource({ reason: 'cancelled' })).toBe('user');
    expect(permissionDecisionSource({ reason: 'timeout' })).toBe('timeout');
    expect(permissionDecisionSource({})).toBe('user');
  });
});

describe('PermissionBroker — 답할 곳이 사라진 카드는 취소로 닫힌다', () => {
  let sent: WSMessage[];
  let broker: PermissionBroker;
  let resolvedHook: PermissionDecision[];

  beforeEach(() => {
    sent = [];
    resolvedHook = [];
    setBroadcastSink((m) => { sent.push(m); });
    broker = new PermissionBroker();
    broker.onResolved = (_req, decision) => { resolvedHook.push(decision); };
  });

  afterEach(() => {
    setBroadcastSink(null);
    vi.useRealTimers();
  });

  it('cancel 은 deny + cancelled 로 풀고, 풀림 방송과 후크가 한 번씩 나간다', async () => {
    const pending = broker.request(baseInput());
    const [req] = broker.listPending();
    expect(req).toBeDefined();
    expect(broker.get(req!.requestId)?.toolName).toBe('Bash');

    expect(broker.cancel(req!.requestId, 'agent-stopped')).toBe(true);
    const decision = await pending;
    expect(decision).toEqual({
      requestId: req!.requestId,
      decision: 'deny',
      reason: PERMISSION_CANCELLED_REASON,
      cancelled: 'agent-stopped',
    });
    expect(broker.listPending()).toHaveLength(0);
    expect(broker.get(req!.requestId)).toBeUndefined();
    expect(sent.filter((m) => m.type === 'permission_resolved')).toHaveLength(1);
    expect(resolvedHook).toHaveLength(1);
    // 이미 풀린 카드는 다시 닫히지 않는다.
    expect(broker.cancel(req!.requestId, 'agent-stopped')).toBe(false);
  });

  it('취소된 카드는 60초가 지나도 기본 허용으로 다시 풀리지 않는다', async () => {
    vi.useFakeTimers();
    const pending = broker.request(baseInput(), 'allow');
    const [req] = broker.listPending();
    broker.cancel(req!.requestId, 'agent-stopped');
    vi.advanceTimersByTime(120_000);
    expect((await pending).decision).toBe('deny');
    expect(resolvedHook).toHaveLength(1);
  });

  it('요청 연결이 끊기면 caller-gone 으로 닫힌다', async () => {
    const ac = new AbortController();
    const pending = broker.request(baseInput(), 'allow', { signal: ac.signal });
    expect(broker.listPending()).toHaveLength(1);
    ac.abort();
    const decision = await pending;
    expect(decision.cancelled).toBe('caller-gone');
    expect(decision.decision).toBe('deny');
    expect(broker.listPending()).toHaveLength(0);
  });

  it('이미 끊긴 연결이면 카드를 띄우지 않는다(떴다 사라지는 깜빡임 ❌)', async () => {
    const ac = new AbortController();
    ac.abort();
    const decision = await broker.request(baseInput(), 'allow', { signal: ac.signal });
    expect(decision.cancelled).toBe('caller-gone');
    expect(sent.filter((m) => m.type === 'permission_request')).toHaveLength(0);
    expect(broker.listPending()).toHaveLength(0);
  });

  it('사람이 답한 뒤에 연결이 끊겨도 결정은 바뀌지 않는다(abort 구독이 풀려 있다)', async () => {
    const ac = new AbortController();
    const pending = broker.request(baseInput(), 'allow', { signal: ac.signal });
    const [req] = broker.listPending();
    broker.resolve({ requestId: req!.requestId, decision: 'allow' });
    ac.abort();
    const decision = await pending;
    expect(decision.decision).toBe('allow');
    expect(decision.cancelled).toBeUndefined();
    expect(resolvedHook).toHaveLength(1);
  });

  it('창구가 보낸 취소 표식은 버린다 — "아무도 안 눌렀다"를 꾸미지 못한다', async () => {
    const pending = broker.request(baseInput());
    const [req] = broker.listPending();
    broker.resolve({ requestId: req!.requestId, decision: 'deny', reason: 'cancelled', cancelled: 'agent-stopped' });
    const decision = await pending;
    expect(decision.cancelled).toBeUndefined();
    expect(permissionDecisionSource(decision)).toBe('user');
  });

  it('세션 중지는 그 세션 카드만, 에이전트 전체 중지는 그 에이전트 카드 전부를 닫는다', async () => {
    const a1 = broker.request(baseInput({ agentId: 'agent-a', subAgentId: 'sub-1' }));
    const a2 = broker.request(baseInput({ agentId: 'agent-a', subAgentId: 'sub-2' }));
    const legacy = broker.request(baseInput({ agentId: 'agent-a', subAgentId: '' }));
    const b1 = broker.request(baseInput({ agentId: 'agent-b', subAgentId: 'sub-9' }));
    expect(broker.listPending()).toHaveLength(4);

    expect(broker.cancelForSubAgent('sub-1', 'agent-stopped')).toBe(1);
    expect((await a1).cancelled).toBe('agent-stopped');
    expect(broker.listPending()).toHaveLength(3);

    // 세션 id 없이 도착한 카드(레거시 훅 env)도 에이전트 전체 중지에서 함께 닫힌다.
    expect(broker.cancelForAgent('agent-a', 'agent-stopped')).toBe(2);
    expect((await a2).cancelled).toBe('agent-stopped');
    expect((await legacy).cancelled).toBe('agent-stopped');

    const [left] = broker.listPending();
    expect(left?.agentId).toBe('agent-b');
    broker.resolve({ requestId: left!.requestId, decision: 'allow' });
    expect((await b1).decision).toBe('allow');
  });

  it('없는 세션·에이전트를 닫으면 0 — 아무 카드도 건드리지 않는다', () => {
    void broker.request(baseInput());
    expect(broker.cancelForSubAgent('sub-nope', 'agent-stopped')).toBe(0);
    expect(broker.cancelForAgent('agent-nope', 'agent-stopped')).toBe(0);
    expect(broker.listPending()).toHaveLength(1);
  });
});

describe('PermissionSessionGrants — 이 세션에선 허용', () => {
  it('같은 에이전트·세션·도구에만 선다', () => {
    const g = new PermissionSessionGrants();
    g.grant('agent-a', 'sub-1', 'Bash');
    expect(g.has('agent-a', 'sub-1', 'Bash')).toBe(true);
    expect(g.has('agent-a', 'sub-2', 'Bash')).toBe(false);
    expect(g.has('agent-b', 'sub-1', 'Bash')).toBe(false);
    expect(g.has('agent-a', 'sub-1', 'Write')).toBe(false);
  });

  it('세션 id 가 없으면 기억을 주지도 읽지도 않는다(누구의 세션인지 모른다)', () => {
    const g = new PermissionSessionGrants();
    g.grant('agent-a', '', 'Bash');
    expect(g.size()).toBe(0);
    expect(g.has('agent-a', undefined, 'Bash')).toBe(false);
  });

  it('세션을 지우면 그 세션의 기억만 사라진다', () => {
    const g = new PermissionSessionGrants();
    g.grant('agent-a', 'sub-1', 'Bash');
    g.grant('agent-a', 'sub-1', 'Write');
    g.grant('agent-a', 'sub-10', 'Bash');
    expect(g.forgetSubAgent('sub-1')).toBe(2);
    expect(g.has('agent-a', 'sub-1', 'Bash')).toBe(false);
    // 이름이 앞부분만 겹치는 세션은 남는다.
    expect(g.has('agent-a', 'sub-10', 'Bash')).toBe(true);
  });

  it('상한을 넘으면 가장 오래된 기억부터 잊는다 — 다시 누른 기억은 새것이 된다', () => {
    const g = new PermissionSessionGrants(2);
    g.grant('agent-a', 'sub-1', 'A');
    g.grant('agent-a', 'sub-1', 'B');
    g.grant('agent-a', 'sub-1', 'A'); // A 를 새로 누름 → B 가 가장 오래된 것
    g.grant('agent-a', 'sub-1', 'C');
    expect(g.size()).toBe(2);
    expect(g.has('agent-a', 'sub-1', 'A')).toBe(true);
    expect(g.has('agent-a', 'sub-1', 'B')).toBe(false);
    expect(g.has('agent-a', 'sub-1', 'C')).toBe(true);
  });
});

describe('§5.22 원장 — 취소는 거부 수에 들지 않는다', () => {
  function record(svc: AuditLogService, n: string) {
    return svc.record({ projectName: 'proj', sessionId: 's', toolName: 'Bash', toolInput: { command: `echo ${n}` } });
  }

  it('countsAsDenied 는 취소를 뺀 deny 만 센다', () => {
    expect(countsAsDenied({ decision: 'deny', decisionSource: 'user' })).toBe(true);
    expect(countsAsDenied({ decision: 'deny', decisionSource: 'policy' })).toBe(true);
    expect(countsAsDenied({ decision: 'deny', decisionSource: 'timeout' })).toBe(true);
    expect(countsAsDenied({ decision: 'deny', decisionSource: 'cancelled' })).toBe(false);
    expect(countsAsDenied({ decision: 'allow', decisionSource: 'user' })).toBe(false);
    expect(countsAsDenied({})).toBe(false);
  });

  it('집계와 잘린 몫(retired) 모두에서 취소는 거부로 세지 않는다', () => {
    const svc = new AuditLogService(() => 2);
    const cancelled = record(svc, 'cancelled');
    svc.recordDecision('proj', cancelled.id, 'deny', 'cancelled', 'cancelled');
    const denied = record(svc, 'denied');
    svc.recordDecision('proj', denied.id, 'deny', 'user');

    let log = svc.getSnapshot().find((l) => l.projectName === 'proj')!;
    expect(log.counts.denied).toBe(1);
    expect(log.entries.find((e) => e.id === cancelled.id)?.decisionSource).toBe('cancelled');

    // 상한 2 — 둘을 더 적으면 앞의 두 줄이 잘려 retired 로 접힌다.
    record(svc, 'x');
    record(svc, 'y');
    log = svc.getSnapshot().find((l) => l.projectName === 'proj')!;
    expect(log.entries).toHaveLength(2);
    expect(log.retired?.denied).toBe(1);
    expect(log.counts.denied).toBe(1);
  });
});
