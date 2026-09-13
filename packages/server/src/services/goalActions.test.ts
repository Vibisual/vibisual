/**
 * §5.5 #17-17 ⑫(f) — **팔레트 집계 회귀.**
 *
 * 이 산식이 조용히 망가지면 팔레트는 **빈 서랍**이 되는데, 화면에서 그것은 "아직 안 배웠다"와
 * 똑같이 생겼다 — 사용자는 기능이 죽은 줄도 모른 채 종전처럼 단계를 손으로 친다. 그래서 세 원천
 * 각각에 대해 "문턱 이상이면 선다 · 미만이면 안 선다 · 고정은 문턱 아래여도 선다"를 못박는다.
 */
import { describe, expect, it } from 'vitest';
import {
  buildGoalActions,
  GOAL_ACTION_MAX,
  GOAL_ACTION_MIN_REPEAT,
  type BashEntry,
  type SessionGoal,
  type VisualKindCard,
} from '@vibisual/shared';

function bash(command: string, times: number, from = 1_000): Record<string, BashEntry[]> {
  const entries: BashEntry[] = [];
  for (let i = 0; i < times; i += 1) {
    entries.push({ id: `${command}-${i}`, command, timestamp: from + i });
  }
  return { 'agent-1': entries };
}

function goalWithUserSteps(texts: string[]): Record<string, SessionGoal> {
  return {
    'sub-1': {
      agentId: 'agent-1',
      subAgentId: 'sub-1',
      text: '목표',
      percent: 0,
      status: 'active',
      steps: texts.map((text, i) => ({
        id: `s${i}`,
        text,
        status: 'pending',
        updatedAt: 2_000 + i,
        authoredBy: 'user',
      })),
      history: [],
      revision: 1,
      createdAt: 0,
      updatedAt: 0,
    } as unknown as SessionGoal,
  };
}

const KINDS: Record<string, VisualKindCard> = {
  git: { key: 'git', label: 'Git', refCount: 0, status: 'active', createdAt: 0, updatedAt: 0 },
  build: { key: 'build', label: 'Build', refCount: 0, status: 'active', createdAt: 0, updatedAt: 0 },
};

describe('⑫(a) 스킬 — 이름 자체가 하는 일이라 한 번만 불려도 선다', () => {
  it('1회 사용한 스킬이 카드가 된다', () => {
    const cards = buildGoalActions({ skillUsage: { 'vibisual-qa': 1 } });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: 'skill:vibisual-qa', source: 'skill', payload: '/vibisual-qa', useCount: 1 });
  });

  it('0회는 서지 않는다 — 목록에 이름만 있는 스킬은 배운 것이 아니다', () => {
    expect(buildGoalActions({ skillUsage: { 'never-used': 0 } })).toHaveLength(0);
  });
});

describe('⑫(a) 명령 — 되풀이 문턱을 넘어야 선다', () => {
  it(`같은 명령 ${GOAL_ACTION_MIN_REPEAT}회면 카드가 된다`, () => {
    const cards = buildGoalActions({ bashHistory: bash('pnpm build', GOAL_ACTION_MIN_REPEAT) });
    expect(cards.map((c) => c.id)).toEqual(['cmd:pnpm build']);
    expect(cards[0]?.useCount).toBe(GOAL_ACTION_MIN_REPEAT);
  });

  it(`${GOAL_ACTION_MIN_REPEAT - 1}회는 서지 않는다 — 그것은 습관이 아니라 최근 목록이다`, () => {
    expect(buildGoalActions({ bashHistory: bash('ls', GOAL_ACTION_MIN_REPEAT - 1) })).toHaveLength(0);
  });

  it('공백만 다른 명령은 같은 칸으로 모인다', () => {
    const history: Record<string, BashEntry[]> = {
      a: [
        { id: '1', command: 'git  status', timestamp: 1 },
        { id: '2', command: 'git status', timestamp: 2 },
        { id: '3', command: ' git status ', timestamp: 3 },
      ],
    };
    const cards = buildGoalActions({ bashHistory: history });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.useCount).toBe(3);
  });

  it('인자가 다르면 다른 칸이다 — 뭉치면 사용자가 시킨 적 없는 줄을 끌게 된다', () => {
    const history: Record<string, BashEntry[]> = {
      a: [
        ...bash('git status', 3)['agent-1']!,
        ...bash('git status -s', 3)['agent-1']!.map((e) => ({ ...e, id: `x${e.id}` })),
      ],
    };
    const cards = buildGoalActions({ bashHistory: history });
    expect(cards.map((c) => c.payload).sort()).toEqual(['git status', 'git status -s']);
  });

  it('그림은 표에 있는 종류만 가리킨다 — 없는 카드를 가리키면 그 칸만 무채색으로 선다', () => {
    const withTable = buildGoalActions({ bashHistory: bash('git push', 3), visualKinds: KINDS });
    expect(withTable[0]?.kind).toBe('git');
    const withoutTable = buildGoalActions({ bashHistory: bash('git push', 3) });
    expect(withoutTable[0]?.kind).toBeUndefined();
  });
});

describe('⑫(a) 단계 — 사용자가 되풀이해 꽂은 것만 센다', () => {
  it('사용자 단계 3회면 카드가 된다', () => {
    const goals = goalWithUserSteps(['릴리스 노트 갱신', '릴리스 노트 갱신', '릴리스 노트 갱신']);
    const cards = buildGoalActions({ sessionGoals: goals });
    expect(cards.map((c) => c.source)).toEqual(['step']);
    expect(cards[0]?.payload).toBe('릴리스 노트 갱신');
  });

  it('세션이 쓴 단계는 세지 않는다 — 그것은 사용자의 습관이 아니다', () => {
    const goals = goalWithUserSteps(['x', 'x', 'x']);
    for (const g of Object.values(goals)) {
      for (const s of g.steps ?? []) (s as { authoredBy?: string }).authoredBy = 'session';
    }
    expect(buildGoalActions({ sessionGoals: goals })).toHaveLength(0);
  });
});

describe('⑫(b) 고정 — 사용자가 고른 것을 우리 산식이 지우지 않는다', () => {
  it('문턱 아래여도 고정된 칸은 남고 맨 앞에 선다', () => {
    const cards = buildGoalActions({
      bashHistory: { a: [{ id: '1', command: 'rare-command', timestamp: 1 }, ...bash('pnpm build', 5)['agent-1']!] },
      pinned: ['cmd:rare-command'],
    });
    expect(cards[0]).toMatchObject({ id: 'cmd:rare-command', pinned: true, useCount: 1 });
    expect(cards[1]?.id).toBe('cmd:pnpm build');
  });

  it('고정이 아니면 횟수 많은 것이 앞이다', () => {
    const cards = buildGoalActions({
      bashHistory: {
        a: [...bash('a-cmd', 3)['agent-1']!, ...bash('b-cmd', 9)['agent-1']!.map((e) => ({ ...e, id: `b${e.id}` }))],
      },
    });
    expect(cards.map((c) => c.payload)).toEqual(['b-cmd', 'a-cmd']);
  });
});

describe('⑫(a) 상한 — 넘어가면 그것은 팔레트가 아니라 목록이다', () => {
  it(`${GOAL_ACTION_MAX}칸에서 자른다`, () => {
    const skillUsage: Record<string, number> = {};
    for (let i = 0; i < GOAL_ACTION_MAX + 10; i += 1) skillUsage[`skill-${i}`] = i + 1;
    expect(buildGoalActions({ skillUsage })).toHaveLength(GOAL_ACTION_MAX);
  });

  it('같은 입력이면 항상 같은 답이다 — 팔레트가 프레임마다 흔들리면 끌 수 없다', () => {
    const input = { skillUsage: { a: 2, b: 2, c: 2 } };
    expect(buildGoalActions(input).map((c) => c.id)).toEqual(buildGoalActions(input).map((c) => c.id));
  });
});
