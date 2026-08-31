import { describe, expect, it } from 'vitest';
import {
  CHAT_LOG_AGENT_MAX, CHAT_PAIR_ATTEMPT_MAX, CHAT_PENDING_ACTION_MAX, CHAT_UNPAIRED_NOTICE_MS,
} from '@vibisual/shared';
import type { SessionGoal } from '@vibisual/shared';
import {
  canPair, canSend, goalSignature, peerKey, takeNoticeSlot,
  trimExpiring, trimLogBuffers, trimOldest, trimPairAttempts,
} from './policy';

// §4 메신저 브리지 — 판정 회귀. 여기 있는 것은 전부 **실제로 한 번 틀렸던 자리**다.

describe('canSend — 카드가 나가는 유일한 문', () => {
  it('채널이 꺼져 있으면 어떤 카드도 나가지 않는다', () => {
    // 드라이버 stop() 은 수신만 끊고 sendCard 는 REST 라, 이 판정이 없으면 끈 뒤에도 나갔다.
    for (const kind of ['permission', 'question', 'report', 'review', 'goal', 'text', 'stream'] as const) {
      expect(canSend({ kind, verbosity: 'full', channelEnabled: false })).toBe(false);
    }
  });

  it('켜져 있으면 기본(cards)에서 스트림만 막힌다', () => {
    expect(canSend({ kind: 'stream', verbosity: 'cards', channelEnabled: true })).toBe(false);
    expect(canSend({ kind: 'stream', verbosity: 'full', channelEnabled: true })).toBe(true);
    for (const kind of ['permission', 'question', 'report', 'review', 'goal', 'text'] as const) {
      expect(canSend({ kind, verbosity: 'cards', channelEnabled: true })).toBe(true);
    }
  });

  it('`/log` 응답(text)은 전송량 정책을 지나지 않는다 — 사용자가 명시 요청한 통로', () => {
    expect(canSend({ kind: 'text', verbosity: 'cards', channelEnabled: true })).toBe(true);
  });
});

describe('canPair — 1:1 DM 에서만', () => {
  it('DM 이면 받고, 길드 채널·그룹이면 받지 않는다', () => {
    expect(canPair(true)).toBe(true);
    expect(canPair(false)).toBe(false);
  });
});

describe('takeNoticeSlot — 미페어링 안내의 상한', () => {
  it('같은 발신자에게는 쿨다운 안에 한 번만 나간다', () => {
    const seen = new Map<string, number>();
    const key = peerKey('telegram', '42');
    expect(takeNoticeSlot(seen, key, 1_000)).toBe(true);
    expect(takeNoticeSlot(seen, key, 1_001)).toBe(false);
    expect(takeNoticeSlot(seen, key, 1_000 + CHAT_UNPAIRED_NOTICE_MS - 1)).toBe(false);
    expect(takeNoticeSlot(seen, key, 1_000 + CHAT_UNPAIRED_NOTICE_MS)).toBe(true);
  });

  it('발신자가 다르면 서로의 슬롯을 막지 않는다(소유자 lockout 방지)', () => {
    const seen = new Map<string, number>();
    expect(takeNoticeSlot(seen, peerKey('telegram', 'a'), 0)).toBe(true);
    expect(takeNoticeSlot(seen, peerKey('telegram', 'b'), 0)).toBe(true);
    expect(takeNoticeSlot(seen, peerKey('discord', 'a'), 0)).toBe(true);
  });

  it('쿨다운이 지난 키는 스스로 흘러나간다(맵이 무한히 자라지 않게)', () => {
    const seen = new Map<string, number>();
    for (let i = 0; i < 50; i += 1) takeNoticeSlot(seen, `telegram:${String(i)}`, 0);
    expect(seen.size).toBe(50);
    takeNoticeSlot(seen, 'telegram:new', CHAT_UNPAIRED_NOTICE_MS + 1);
    expect(seen.size).toBe(1);
    expect(seen.has('telegram:new')).toBe(true);
  });
});

describe('trimExpiring — 대기 버튼 맵의 키 개수 상한', () => {
  it('만료된 항목을 먼저 거둔다', () => {
    const map = new Map<string, { expiresAt: number }>([
      ['live', { expiresAt: 2_000 }],
      ['dead', { expiresAt: 500 }],
    ]);
    trimExpiring(map, 1_000);
    expect([...map.keys()]).toEqual(['live']);
  });

  it('만료가 없어도 상한을 넘으면 가장 이른 것부터 밀어낸다', () => {
    const map = new Map<string, { expiresAt: number }>();
    for (let i = 0; i < 5; i += 1) map.set(`k${String(i)}`, { expiresAt: 10_000 + i });
    trimExpiring(map, 0, 3);
    expect(map.size).toBe(3);
    expect([...map.keys()]).toEqual(['k2', 'k3', 'k4']);
  });

  it('기본 상한은 shared 상수를 따른다', () => {
    const map = new Map<string, { expiresAt: number }>();
    for (let i = 0; i < CHAT_PENDING_ACTION_MAX + 10; i += 1) map.set(`k${String(i)}`, { expiresAt: 10_000 + i });
    trimExpiring(map, 0);
    expect(map.size).toBe(CHAT_PENDING_ACTION_MAX);
  });

  it('상한 이하이면 아무것도 지우지 않는다', () => {
    const map = new Map<string, { expiresAt: number }>([['a', { expiresAt: 10_000 }]]);
    trimExpiring(map, 0);
    expect(map.size).toBe(1);
  });
});

describe('trimOldest / trimLogBuffers — 값이 아니라 키 개수의 상한', () => {
  it('삽입 순서가 오래된 것부터 지운다', () => {
    const map = new Map<string, number>([['a', 1], ['b', 2], ['c', 3]]);
    trimOldest(map, 2);
    expect([...map.keys()]).toEqual(['b', 'c']);
  });

  it('`/log` 버퍼는 에이전트 수 상한을 넘지 않는다', () => {
    const map = new Map<string, string[]>();
    for (let i = 0; i < CHAT_LOG_AGENT_MAX + 5; i += 1) map.set(`agent-${String(i)}`, ['line']);
    trimLogBuffers(map);
    expect(map.size).toBe(CHAT_LOG_AGENT_MAX);
    // 남는 것은 가장 최근에 말한 에이전트들이다.
    expect(map.has(`agent-${String(CHAT_LOG_AGENT_MAX + 4)}`)).toBe(true);
    expect(map.has('agent-0')).toBe(false);
  });
});

describe('trimPairAttempts', () => {
  it('밴이 풀린 항목은 흘려보낸다', () => {
    const map = new Map([
      ['telegram:a', { count: 0, bannedUntil: 500 }],
      ['telegram:b', { count: 3, bannedUntil: 5_000 }],
      ['telegram:c', { count: 1, bannedUntil: 0 }],
    ]);
    trimPairAttempts(map, 1_000);
    expect([...map.keys()].sort()).toEqual(['telegram:b', 'telegram:c']);
  });

  it('밴이 안 풀렸어도 키 개수 상한은 지킨다', () => {
    const map = new Map<string, { count: number; bannedUntil: number }>();
    for (let i = 0; i < CHAT_PAIR_ATTEMPT_MAX + 7; i += 1) {
      map.set(`telegram:${String(i)}`, { count: 1, bannedUntil: 0 });
    }
    trimPairAttempts(map, 0);
    expect(map.size).toBe(CHAT_PAIR_ATTEMPT_MAX);
  });
});

describe('goalSignature — 목표 카드가 스팸이 되지 않게', () => {
  const base: SessionGoal = {
    agentId: 'agent-1',
    subAgentId: 'sub-1',
    text: '목표 한 문장',
    percent: 40,
    status: 'active',
    steps: [
      { id: 's1', text: '하나', status: 'done', updatedAt: 1 },
      { id: 's2', text: '둘', status: 'in_progress', updatedAt: 1 },
    ],
  } as unknown as SessionGoal;

  it('같은 상태면 지문이 같다 — 스냅샷마다 다시 보내지 않는다', () => {
    const again = { ...base, steps: [...(base.steps ?? [])] } as SessionGoal;
    expect(goalSignature(again)).toBe(goalSignature(base));
  });

  it('완료 단계 수·퍼센트·문장·상태가 바뀌면 지문이 바뀐다', () => {
    const stepDone = {
      ...base,
      steps: [
        { id: 's1', text: '하나', status: 'done', updatedAt: 1 },
        { id: 's2', text: '둘', status: 'done', updatedAt: 2 },
      ],
    } as unknown as SessionGoal;
    expect(goalSignature(stepDone)).not.toBe(goalSignature(base));
    expect(goalSignature({ ...base, percent: 41 } as SessionGoal)).not.toBe(goalSignature(base));
    expect(goalSignature({ ...base, text: '다른 문장' } as SessionGoal)).not.toBe(goalSignature(base));
    expect(goalSignature({ ...base, status: 'done' } as unknown as SessionGoal)).not.toBe(goalSignature(base));
  });

  it('단계 본문만 바뀌고 완료 수가 그대로면 지문은 그대로다(진행률 스팸 방지)', () => {
    const renamed = {
      ...base,
      steps: [
        { id: 's1', text: '하나(수정)', status: 'done', updatedAt: 9 },
        { id: 's2', text: '둘(수정)', status: 'in_progress', updatedAt: 9 },
      ],
    } as unknown as SessionGoal;
    expect(goalSignature(renamed)).toBe(goalSignature(base));
  });

  it('단계가 없어도 터지지 않는다', () => {
    const noSteps = { ...base, steps: undefined } as unknown as SessionGoal;
    expect(goalSignature(noSteps)).toContain('0/0');
  });
});

describe('peerKey', () => {
  it('채널이 다르면 같은 chatId 라도 다른 키다', () => {
    expect(peerKey('telegram', '1')).not.toBe(peerKey('discord', '1'));
  });
});
