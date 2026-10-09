/**
 * mainCardSender.test.ts — §5.5 #17-18 ⑦-7 (메인 탭 판본)
 *
 * 메인 탭은 Sub 탭과 자료형이 다르다(도구가 `TerminalGroup` 묶음으로 들어오고, 전체 보기는 여러 세션이 한
 * 타임라인에 섞인다). 같은 판정 함수(`cardPlacementTs`)를 쓰되 ① 같은 세션의 도구만 보고 ② 카드는 도구가 든
 * **묶음 아래**로 가며 ③ 간결(묶음을 감춤)에서는 신고 시각 그대로인지를 고정한다.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AgentReview, QueuedCommand, SubAgent, SubAgentStreamEvent } from '@vibisual/shared';
// 순수 조립 함수만 쓴다 — 터미널 창을 띄우지 않는다(mainTransportRecovery.test.ts 와 같은 이유).
vi.mock('./IDETerminalPanes.js', () => ({ IDETerminalPanes: () => null }));
import { applyMainDensity, buildEntries, collectMainCardSenderCalls, groupEntries, mainCardPlacementTs } from './IDEMainArea.js';

const formatError = (error: { detail?: string }): string => `Failure: ${error.detail ?? ''}`;
const REVIEW_PWSH = '"C:\\\\WINDOWS\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command \'Invoke-RestMethod -Method Post -Uri "$B/api/agent-review"\'';

function sub(id: string): SubAgent {
  return { id, sessionId: id, label: id, parentAgentId: 'P', status: 'active', createdAt: 0, lastActivityAt: 0 };
}
function command(subAgentId: string): QueuedCommand {
  return { id: `cmd-${subAgentId}`, text: 'Work', timestamp: 1, startedAt: 1, subAgentId, status: 'executing' };
}
function event(id: string, subAgentId: string, eventType: SubAgentStreamEvent['eventType'], content: string, timestamp: number, toolName?: string): SubAgentStreamEvent {
  return { id, subAgentId, parentAgentId: 'P', turnId: `cmd-${subAgentId}`, eventType, content, timestamp, ...(toolName ? { toolName } : {}) };
}
function review(id: string, createdAt: number, subAgentId?: string): AgentReview {
  return { id, agentId: 'P', ...(subAgentId ? { subAgentId } : {}), changes: ['고쳤다'], checkpoints: [], createdAt };
}

/** 사용자 화면의 그 턴 — 결론 → (카드 신고) → 명령 시작 줄이 늦게 → 결과 → 닫는 문장. 실측 시각 그대로. */
function codexTurn(subId: string): SubAgentStreamEvent[] {
  return [
    event('t0', subId, 'text', '요청하신 구조로 정리했습니다.', 961_940),
    event('x1', subId, 'tool_use', REVIEW_PWSH, 990_213, 'Bash'),
    event('x1r', subId, 'tool_result', 'exit 0\n{"ok": true, "id": "rv1"}', 990_339, 'Bash'),
    event('t1', subId, 'text', '카드를 확인해 주세요.', 992_113),
  ];
}

function timelineFor(streams: Record<string, SubAgentStreamEvent[]>, density: 'compact' | 'standard' | 'raw') {
  const subs = Object.keys(streams).map(sub);
  const entries = buildEntries(subs.map((s) => command(s.id)), subs, streams, null, [], formatError);
  return applyMainDensity(groupEntries(entries), density);
}

describe('메인 탭 — 카드는 자기를 보낸 도구 묶음 아래에 선다', () => {
  it('코덱스: 명령 시작 줄이 카드보다 늦어도 카드는 그 묶음 바로 아래다(표준·원문)', () => {
    for (const density of ['standard', 'raw'] as const) {
      const items = timelineFor({ S: codexTurn('S') }, density);
      const group = items.find((it) => it.kind === 'group' && it.groupType === 'tool');
      expect(group?.timestamp, density).toBe(990_213);
      const ts = mainCardPlacementTs('review', review('rv1', 990_089, 'S'), collectMainCardSenderCalls(items));
      expect(ts, density).toBe(990_213.5);
      // 정렬하면 결론 → 명령 묶음 → 카드 → 닫는 문장(이 줄은 뒤에서 따로 걷힌다).
      const order = [...items.map((it) => ({ id: it.id, ts: it.timestamp })), { id: 'card', ts }]
        .sort((a, b) => a.ts - b.ts).map((x) => x.id);
      expect(order, density).toEqual(['cmd-cmd-S', 't0', 'grp-x1', 'card', 't1']);
    }
  });

  it('간결은 묶음을 감추므로 카드는 신고 시각 그대로다', () => {
    const items = timelineFor({ S: codexTurn('S') }, 'compact');
    expect(items.some((it) => it.kind === 'group')).toBe(false);
    expect(mainCardPlacementTs('review', review('rv1', 990_089, 'S'), collectMainCardSenderCalls(items))).toBe(990_089);
  });

  it('전체 보기 — 다른 세션의 같은 창구 호출은 이 카드를 끌고 가지 않는다', () => {
    const items = timelineFor({ S: [event('s0', 'S', 'text', '결론', 961_940)], T: codexTurn('T') }, 'standard');
    const calls = collectMainCardSenderCalls(items);
    expect([...calls.keys()]).toEqual(['T']);
    expect(mainCardPlacementTs('review', review('rvS', 990_089, 'S'), calls)).toBe(990_089);
    expect(mainCardPlacementTs('review', review('rvT', 990_089, 'T'), calls)).toBe(990_213.5);
  });

  it('세션을 모르는 카드는 신고 시각 그대로다', () => {
    const items = timelineFor({ S: codexTurn('S') }, 'standard');
    expect(mainCardPlacementTs('review', review('rv1', 990_089), collectMainCardSenderCalls(items))).toBe(990_089);
  });

  it('연속 도구 묶음 안에 든 발신 호출 — 카드는 묶음 아래다(묶음 가운데에 끼지 않는다)', () => {
    const items = timelineFor({
      S: [
        event('t0', 'S', 'text', '결론', 961_940),
        event('y1', 'S', 'tool_use', 'pnpm test', 980_000, 'Bash'),
        event('y1r', 'S', 'tool_result', 'exit 0', 985_000, 'Bash'),
        event('x1', 'S', 'tool_use', REVIEW_PWSH, 990_213, 'Bash'),
        event('x1r', 'S', 'tool_result', 'exit 0\n{"ok": true, "id": "rv1"}', 990_339, 'Bash'),
      ],
    }, 'standard');
    const groups = items.filter((it) => it.kind === 'group');
    expect(groups).toHaveLength(1);
    const calls = collectMainCardSenderCalls(items);
    // 결과 줄은 그 호출에 짝지어진다(앞 호출의 결과가 섞이지 않는다).
    expect(calls.get('S')?.map((c) => c.output)).toEqual(['exit 0\n{"ok": true, "id": "rv1"}']);
    const ts = mainCardPlacementTs('review', review('rv1', 990_089, 'S'), calls);
    // 묶음의 자리(첫 도구)는 카드보다 앞이라 신고 시각 그대로 — 정렬하면 묶음 전체 뒤에 선다.
    expect(ts).toBe(990_089);
    expect(groups[0]!.timestamp).toBeLessThan(ts);
  });

  it('클로드: 도구 시작 줄이 이미 카드 앞이면 그대로다', () => {
    const items = timelineFor({
      S: [
        event('x1', 'S', 'tool_use', '{"command":"curl -s -X POST \\"$VIBISUAL_BASE/api/agent-review\\""}', 989_700, 'Bash'),
        event('x1r', 'S', 'tool_result', '{"ok":true,"id":"rv1"}', 990_200, 'Bash'),
      ],
    }, 'standard');
    expect(mainCardPlacementTs('review', review('rv1', 990_089, 'S'), collectMainCardSenderCalls(items))).toBe(990_089);
  });
});
