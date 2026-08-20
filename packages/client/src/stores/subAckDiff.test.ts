import { describe, it, expect } from 'vitest';
import type { SubAgent } from '@vibisual/shared';
import { diffSubAcknowledgements, ACK_MAX_ENTRIES } from './subAckDiff.js';

function sub(id: string, parentAgentId: string, status: SubAgent['status']): SubAgent {
  return {
    id,
    sessionId: `sess-${id}`,
    label: id,
    parentAgentId,
    status,
    createdAt: 0,
    lastActivityAt: 0,
  };
}

describe('diffSubAcknowledgements', () => {
  it('active → idle 는 새 완료라 ack 를 푼다(다시 녹색)', () => {
    const next = diffSubAcknowledgements({
      prevSubAgents: { 'agent-1': [sub('s1', 'agent-1', 'active')] },
      nextSubAgents: { 'agent-1': [sub('s1', 'agent-1', 'idle')] },
      presentAgentIds: ['agent-1'],
      acknowledged: { s1: true },
    });
    expect(next).toEqual({});
  });

  it('상태가 그대로면 아무것도 바꾸지 않는다(null = 리렌더·저장 없음)', () => {
    const next = diffSubAcknowledgements({
      prevSubAgents: { 'agent-1': [sub('s1', 'agent-1', 'idle')] },
      nextSubAgents: { 'agent-1': [sub('s1', 'agent-1', 'idle')] },
      presentAgentIds: ['agent-1'],
      acknowledged: { s1: true },
    });
    expect(next).toBeNull();
  });

  it('completed → idle 같은 다른 전이는 ack 를 유지한다', () => {
    const next = diffSubAcknowledgements({
      prevSubAgents: { 'agent-1': [sub('s1', 'agent-1', 'completed')] },
      nextSubAgents: { 'agent-1': [sub('s1', 'agent-1', 'idle')] },
      presentAgentIds: ['agent-1'],
      acknowledged: { s1: true },
    });
    expect(next).toBeNull();
  });

  it('세션이 닫히면(소유 에이전트는 그대로) 그 ack 를 정리한다', () => {
    const next = diffSubAcknowledgements({
      prevSubAgents: { 'agent-1': [sub('s1', 'agent-1', 'idle'), sub('s2', 'agent-1', 'idle')] },
      nextSubAgents: { 'agent-1': [sub('s2', 'agent-1', 'idle')] },
      presentAgentIds: ['agent-1'],
      acknowledged: { s1: true, s2: true },
    });
    expect(next).toEqual({ s2: true });
  });

  it('마지막 세션을 닫아 에이전트 키가 통째로 빠져도, 그 버블이 스냅샷에 있으면 정리한다', () => {
    const next = diffSubAcknowledgements({
      prevSubAgents: { 'agent-1': [sub('s1', 'agent-1', 'idle')] },
      nextSubAgents: {},
      presentAgentIds: ['agent-1'],
      acknowledged: { s1: true },
    });
    expect(next).toEqual({});
  });

  // ── 회귀: "확인해서 회색이 됐는데 어느 순간 다시 녹색" ────────────────────────────
  it('스코프드 스냅샷에서 배경 프로젝트가 통째로 빠져도 ack 를 지우지 않는다', () => {
    const prev = {
      'agent-A': [sub('a1', 'agent-A', 'idle')],
      'agent-B': [sub('b1', 'agent-B', 'idle')],
    };
    // 프로젝트 탭을 옮겨 A 만 범위 안 — B 는 세션도 버블도 안 실려 온다.
    const next = diffSubAcknowledgements({
      prevSubAgents: prev,
      nextSubAgents: { 'agent-A': [sub('a1', 'agent-A', 'idle')] },
      presentAgentIds: ['agent-A'],
      acknowledged: { a1: true, b1: true },
    });
    expect(next).toBeNull();
  });

  it('부팅 직후처럼 스냅샷이 비어 있으면 localStorage 로만 아는 ack 를 건드리지 않는다', () => {
    const next = diffSubAcknowledgements({
      prevSubAgents: {},
      nextSubAgents: {},
      presentAgentIds: [],
      acknowledged: { s1: true, s2: true },
    });
    expect(next).toBeNull();
  });

  it('범위가 다시 넓어져 세션이 돌아와도 확인 상태가 남아 있다', () => {
    const acknowledged: Record<string, true> = { a1: true, b1: true };
    const away = diffSubAcknowledgements({
      prevSubAgents: {
        'agent-A': [sub('a1', 'agent-A', 'idle')],
        'agent-B': [sub('b1', 'agent-B', 'idle')],
      },
      nextSubAgents: { 'agent-A': [sub('a1', 'agent-A', 'idle')] },
      presentAgentIds: ['agent-A'],
      acknowledged,
    });
    const back = diffSubAcknowledgements({
      prevSubAgents: { 'agent-A': [sub('a1', 'agent-A', 'idle')] },
      nextSubAgents: { 'agent-B': [sub('b1', 'agent-B', 'idle')] },
      presentAgentIds: ['agent-B'],
      acknowledged: away ?? acknowledged,
    });
    expect(back).toBeNull();
    expect(away ?? acknowledged).toEqual({ a1: true, b1: true });
  });

  it('상한을 넘으면 오래된 것부터 자르되 지금 보이는 세션은 남긴다', () => {
    const acknowledged: Record<string, true> = {};
    for (let i = 0; i < ACK_MAX_ENTRIES + 5; i++) acknowledged[`old-${i}`] = true;
    // 가장 오래된 축에 속하지만 지금 화면에 있는 세션 하나.
    const live = 'old-0';
    const next = diffSubAcknowledgements({
      prevSubAgents: { 'agent-1': [sub(live, 'agent-1', 'idle')] },
      nextSubAgents: { 'agent-1': [sub(live, 'agent-1', 'idle')] },
      presentAgentIds: ['agent-1'],
      acknowledged,
    });
    expect(next).not.toBeNull();
    expect(Object.keys(next as Record<string, true>).length).toBe(ACK_MAX_ENTRIES);
    expect((next as Record<string, true>)[live]).toBe(true);
    expect((next as Record<string, true>)['old-1']).toBeUndefined();
  });
});
