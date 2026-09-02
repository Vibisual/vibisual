/**
 * §5.5 #17-41 — 세션 탭 정렬.
 *
 * 탭 순서는 원래 **손으로만** 바꿀 수 있었다(§5.4 #14 드래그 밀어내기). 세션이 늘면 그 손이
 * 감당하지 못한다 — "지금 도는 게 어디 있더라", "질문 카드가 뜬 탭이 어느 것이더라"를 탭을
 * 하나씩 눌러 확인하게 된다. 그래서 **누르면 한 번에 줄을 세우는** 버튼을 둔다.
 *
 * 이 파일은 그 줄 세우기의 **판정만** 갖는다(#17-9 ④(b) `hiddenRunningTabs.ts` 선례).
 * 정렬 결과는 드래그와 **같은 문**(`PATCH /api/subagents/:agentId/order`)으로 커밋되므로
 * 서버에는 새 축이 생기지 않는다 — 서버가 받는 것은 종전과 똑같이 "정해진 순서" 하나다.
 */

import type { SessionRunState } from '@vibisual/shared';

/** 무엇으로 줄을 세우는가 — 팝업의 버튼 하나가 하나씩 대응한다. */
export type TabSortKey = 'running' | 'recent' | 'questions' | 'reviews' | 'userActions' | 'pinned';

/**
 * 우선순위가 **어느 쪽에 모이는가**.
 * - `right`(기본) — 중요한 탭이 오른쪽 끝(새 세션 버튼 쪽)에 모인다.
 * - `left` — 왼쪽 끝에 모인다.
 */
export type TabSortAnchor = 'right' | 'left';

/** 팝업이 그리는 순서 그대로 — 화면과 목록이 어긋나지 않게 여기 한 곳에서 정한다. */
export const TAB_SORT_KEYS: readonly TabSortKey[] = ['running', 'recent', 'questions', 'reviews', 'userActions', 'pinned'] as const;

/** 기준 선택지 — 위가 기본(`right`), 아래가 `left`. */
export const TAB_SORT_ANCHORS: readonly TabSortAnchor[] = ['right', 'left'] as const;

/** 기본 기준 = 오른쪽. */
export const DEFAULT_TAB_SORT_ANCHOR: TabSortAnchor = 'right';

/** localStorage 에서 읽은 값을 믿지 않는다 — 모르는 값이면 기본으로 되돌린다. */
export function normalizeTabSortAnchor(value: unknown): TabSortAnchor {
  return value === 'left' || value === 'right' ? value : DEFAULT_TAB_SORT_ANCHOR;
}

/**
 * 실행 상태 우선순위 — 작을수록 기준 쪽(앞)에 선다.
 *
 * 사용자가 부른 순서는 "실행중 → 완료 → 비활성화" 셋이다. 우리 상태 축은 넷이라
 * (`running`/`error`/`doneUnseen`/`done`) 다음과 같이 대응시킨다.
 *  · `running`    = 실행중
 *  · `error`      = 사용자를 불러야 하는 끝남 — 실행중 바로 다음에 둔다(사용자가 부른 셋에는
 *                   없지만, 조용한 완료들 사이에 묻히면 그게 제일 놓치기 쉬운 탭이 된다).
 *  · `doneUnseen` = 완료(아직 안 본 결과 — 초록 도트)
 *  · `done`       = 비활성화(확인까지 끝나 배경으로 물러난 회색 도트)
 */
const RUN_STATE_RANK: Record<SessionRunState, number> = {
  running: 0,
  error: 1,
  doneUnseen: 2,
  done: 3,
};

/** 탭 하나를 줄 세우는 데 필요한 사실 전부 — DOM·store 를 모르는 값만 받는다. */
export interface TabSortFacts {
  id: string;
  /** 도트가 말하는 그 상태(`sessionRunStateOf` 결과 — 사본 ❌). */
  runState: SessionRunState;
  /**
   * 이 세션에 **마지막으로 무슨 일이 있었던** 시각(`SubAgent.lastActivityAt`).
   * 카드 세 종류와 달리 이 값은 **항상 있다** — 세션이 태어난 순간이 곧 첫 활동이다.
   */
  lastActivityAt: number;
  /** 이 탭에 **마지막으로** 뜬 질문 카드 시각. 한 번도 없으면 `null`. */
  lastQuestionAt: number | null;
  /** 마지막 검수 카드 시각. */
  lastReviewAt: number | null;
  /** 마지막으로 "내가 할 일"이 실린 작업 신고 시각. */
  lastUserActionAt: number | null;
  /** 탭 고정(`tabPins`) 여부. */
  pinned: boolean;
}

/**
 * 시각 하나를 순위로 — **최신이 앞**이다. 그 일이 한 번도 없던 탭은 맨 뒤(무한대).
 * 부호를 뒤집는 이유는 "큰 시각(=최신)이 작은 순위"가 되어야 하기 때문이다.
 */
function recencyRank(at: number | null): number {
  return at === null ? Number.POSITIVE_INFINITY : -at;
}

/** 탭 하나의 순위 — 작을수록 기준 쪽. */
export function tabSortRank(facts: TabSortFacts, key: TabSortKey): number {
  switch (key) {
    case 'running': return RUN_STATE_RANK[facts.runState];
    case 'recent': return recencyRank(facts.lastActivityAt);
    case 'questions': return recencyRank(facts.lastQuestionAt);
    case 'reviews': return recencyRank(facts.lastReviewAt);
    case 'userActions': return recencyRank(facts.lastUserActionAt);
    case 'pinned': return facts.pinned ? 0 : 1;
  }
}

/**
 * 줄을 세워 **탭 id 순서**를 돌려준다(왼쪽 → 오른쪽).
 *
 * · `left` 기준 — 순위가 작은(중요한) 탭이 앞(왼쪽)에 온다.
 * · `right` 기준 — 순위가 작은 탭이 **뒤(오른쪽)** 에 온다. 뒤집는 것은 순위뿐이고,
 *   **동률은 지금 보이는 순서를 그대로 지킨다** — 통째로 뒤집으면 아무 상관 없는 탭들까지
 *   좌우가 바뀌어, 사용자가 방금 손으로 맞춰 둔 배치가 정렬 한 번에 흐트러진다.
 *
 * 순위 비교에 뺄셈을 쓰지 않는 이유: 카드가 한 번도 없던 탭끼리는 둘 다 무한대라
 * `Infinity - Infinity = NaN` 이 되어 비교가 무너진다.
 */
export function sortTabOrder(
  facts: readonly TabSortFacts[],
  key: TabSortKey,
  anchor: TabSortAnchor,
): string[] {
  const ranked = facts.map((f, index) => ({ id: f.id, rank: tabSortRank(f, key), index }));
  ranked.sort((a, b) => {
    if (a.rank !== b.rank) {
      const ascending = a.rank < b.rank ? -1 : 1;
      return anchor === 'left' ? ascending : -ascending;
    }
    return a.index - b.index;
  });
  return ranked.map((r) => r.id);
}

/** 카드 한 종류에서 이 탭 것만 골라 **마지막 시각**을 찾는다. 없으면 `null`. */
export function latestCardAt<T extends { subAgentId?: string; createdAt: number }>(
  cards: readonly T[] | undefined,
  subId: string,
  accept?: (card: T) => boolean,
): number | null {
  if (!cards || cards.length === 0) return null;
  let latest: number | null = null;
  for (const card of cards) {
    // `subAgentId` 가 없는 카드는 메인 탭(에이전트 전체) 것이다 — 세션 탭 줄 세우기에 끼지 않는다.
    if (card.subAgentId !== subId) continue;
    if (accept && !accept(card)) continue;
    if (latest === null || card.createdAt > latest) latest = card.createdAt;
  }
  return latest;
}
