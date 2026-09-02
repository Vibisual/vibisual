import { describe, it, expect } from 'vitest';
import {
  sortTabOrder, tabSortRank, latestCardAt, normalizeTabSortAnchor,
  DEFAULT_TAB_SORT_ANCHOR, TAB_SORT_KEYS, type TabSortFacts,
} from './tabSort.js';

/**
 * §5.5 #17-41 — 세션 탭 정렬 판정 회귀.
 *
 * 고정하는 약속 셋:
 *  ① 기준(`right`/`left`)은 **순위만** 뒤집는다 — 동률 탭의 좌우는 지금 순서 그대로다.
 *  ② 그 일이 한 번도 없던 탭(카드 없음)은 항상 반대쪽 끝으로 간다.
 *  ③ 실행 상태는 실행중 → 오류 → 완료(미확인) → 완료(확인) 순이다.
 */

const facts = (over: Partial<TabSortFacts> & { id: string }): TabSortFacts => ({
  runState: 'done',
  lastActivityAt: 0,
  lastQuestionAt: null,
  lastReviewAt: null,
  lastUserActionAt: null,
  pinned: false,
  ...over,
});

describe('sortTabOrder — 실행 상태', () => {
  const list: TabSortFacts[] = [
    facts({ id: 'done', runState: 'done' }),
    facts({ id: 'unseen', runState: 'doneUnseen' }),
    facts({ id: 'run', runState: 'running' }),
    facts({ id: 'err', runState: 'error' }),
  ];

  it('왼쪽 기준 — 실행중이 맨 앞', () => {
    expect(sortTabOrder(list, 'running', 'left')).toEqual(['run', 'err', 'unseen', 'done']);
  });

  it('오른쪽 기준 — 실행중이 맨 뒤(오른쪽 끝)', () => {
    expect(sortTabOrder(list, 'running', 'right')).toEqual(['done', 'unseen', 'err', 'run']);
  });
});

describe('sortTabOrder — 최신순(마지막 활동)', () => {
  const list: TabSortFacts[] = [
    facts({ id: 'old', lastActivityAt: 100 }),
    facts({ id: 'newest', lastActivityAt: 900 }),
    facts({ id: 'mid', lastActivityAt: 500 }),
  ];

  it('왼쪽 기준 — 마지막 활동이 가장 최근인 탭이 맨 앞', () => {
    expect(sortTabOrder(list, 'recent', 'left')).toEqual(['newest', 'mid', 'old']);
  });

  it('오른쪽 기준 — 가장 최근인 탭이 맨 뒤(오른쪽 끝)', () => {
    expect(sortTabOrder(list, 'recent', 'right')).toEqual(['old', 'mid', 'newest']);
  });

  it('활동 시각이 같으면 지금 순서를 지킨다', () => {
    const tie = [facts({ id: 'a', lastActivityAt: 7 }), facts({ id: 'b', lastActivityAt: 7 })];
    expect(sortTabOrder(tie, 'recent', 'right')).toEqual(['a', 'b']);
    expect(sortTabOrder(tie, 'recent', 'left')).toEqual(['a', 'b']);
  });

  it('최신순은 카드와 무관하다 — 카드가 없어도 줄이 선다', () => {
    expect(sortTabOrder(list, 'recent', 'left')[0]).toBe('newest');
  });
});

describe('sortTabOrder — 카드 최신순', () => {
  const list: TabSortFacts[] = [
    facts({ id: 'old', lastQuestionAt: 100 }),
    facts({ id: 'none' }),
    facts({ id: 'new', lastQuestionAt: 300 }),
  ];

  it('왼쪽 기준 — 마지막에 뜬 질문 카드가 맨 앞, 없는 탭은 맨 뒤', () => {
    expect(sortTabOrder(list, 'questions', 'left')).toEqual(['new', 'old', 'none']);
  });

  it('오른쪽 기준 — 마지막에 뜬 것이 맨 뒤, 없는 탭은 맨 앞', () => {
    expect(sortTabOrder(list, 'questions', 'right')).toEqual(['none', 'old', 'new']);
  });

  it('검수·내가 할 일도 같은 규칙을 쓴다', () => {
    const cards: TabSortFacts[] = [
      facts({ id: 'a', lastReviewAt: 10, lastUserActionAt: 900 }),
      facts({ id: 'b', lastReviewAt: 20, lastUserActionAt: 800 }),
    ];
    expect(sortTabOrder(cards, 'reviews', 'left')).toEqual(['b', 'a']);
    expect(sortTabOrder(cards, 'userActions', 'left')).toEqual(['a', 'b']);
  });
});

describe('sortTabOrder — 고정', () => {
  it('고정된 탭이 기준 쪽에 모인다', () => {
    const list = [facts({ id: 'a' }), facts({ id: 'p', pinned: true }), facts({ id: 'b' })];
    expect(sortTabOrder(list, 'pinned', 'left')).toEqual(['p', 'a', 'b']);
    expect(sortTabOrder(list, 'pinned', 'right')).toEqual(['a', 'b', 'p']);
  });
});

describe('sortTabOrder — 동률', () => {
  it('순위가 같으면 지금 순서를 그대로 지킨다 (양쪽 기준 공통)', () => {
    const list = [facts({ id: 'a' }), facts({ id: 'b' }), facts({ id: 'c' })];
    expect(sortTabOrder(list, 'running', 'left')).toEqual(['a', 'b', 'c']);
    expect(sortTabOrder(list, 'running', 'right')).toEqual(['a', 'b', 'c']);
  });

  it('카드가 하나도 없어도(전부 무한대) 순서가 무너지지 않는다', () => {
    const list = [facts({ id: 'a' }), facts({ id: 'b' })];
    for (const key of TAB_SORT_KEYS) {
      expect(sortTabOrder(list, key, 'right')).toEqual(['a', 'b']);
      expect(sortTabOrder(list, key, 'left')).toEqual(['a', 'b']);
    }
  });

  it('동률 무리 안의 좌우는 정렬 뒤에도 바뀌지 않는다', () => {
    const list = [
      facts({ id: 'x' }),
      facts({ id: 'y' }),
      facts({ id: 'run', runState: 'running' }),
      facts({ id: 'z' }),
    ];
    // 오른쪽 기준: 실행중만 끝으로 가고 나머지 셋의 좌우는 그대로.
    expect(sortTabOrder(list, 'running', 'right')).toEqual(['x', 'y', 'z', 'run']);
  });

  it('빈 목록은 빈 결과', () => {
    expect(sortTabOrder([], 'running', 'right')).toEqual([]);
  });
});

describe('tabSortRank', () => {
  it('실행중이 완료보다 앞선다', () => {
    expect(tabSortRank(facts({ id: 'a', runState: 'running' }), 'running'))
      .toBeLessThan(tabSortRank(facts({ id: 'b', runState: 'done' }), 'running'));
  });

  it('카드가 없으면 무한대', () => {
    expect(tabSortRank(facts({ id: 'a' }), 'questions')).toBe(Number.POSITIVE_INFINITY);
  });

  it('최신순은 항상 값이 있다 — 무한대가 되지 않는다', () => {
    expect(tabSortRank(facts({ id: 'a', lastActivityAt: 5 }), 'recent')).toBe(-5);
  });
});

describe('latestCardAt', () => {
  const cards = [
    { subAgentId: 'a', createdAt: 100, userActions: ['x'] },
    { subAgentId: 'b', createdAt: 200, userActions: [] },
    { subAgentId: 'a', createdAt: 300, userActions: [] },
    { subAgentId: undefined, createdAt: 999, userActions: ['y'] },
  ];

  it('그 탭 것 중 마지막 시각을 고른다', () => {
    expect(latestCardAt(cards, 'a')).toBe(300);
    expect(latestCardAt(cards, 'b')).toBe(200);
  });

  it('그 탭 카드가 없으면 null', () => {
    expect(latestCardAt(cards, 'c')).toBeNull();
    expect(latestCardAt(undefined, 'a')).toBeNull();
    expect(latestCardAt([], 'a')).toBeNull();
  });

  it('세션에 안 붙은 카드(메인 탭 것)는 세지 않는다', () => {
    expect(latestCardAt(cards, 'a')).not.toBe(999);
  });

  it('거르개를 주면 통과한 카드만 센다 — "내가 할 일"이 실린 신고만', () => {
    expect(latestCardAt(cards, 'a', (c) => c.userActions.length > 0)).toBe(100);
    expect(latestCardAt(cards, 'b', (c) => c.userActions.length > 0)).toBeNull();
  });
});

describe('normalizeTabSortAnchor', () => {
  it('아는 값은 그대로', () => {
    expect(normalizeTabSortAnchor('left')).toBe('left');
    expect(normalizeTabSortAnchor('right')).toBe('right');
  });

  it('모르는 값·빈 값은 기본(오른쪽)으로', () => {
    expect(normalizeTabSortAnchor('middle')).toBe(DEFAULT_TAB_SORT_ANCHOR);
    expect(normalizeTabSortAnchor(null)).toBe('right');
    expect(normalizeTabSortAnchor(undefined)).toBe('right');
    expect(normalizeTabSortAnchor(7)).toBe('right');
  });
});
