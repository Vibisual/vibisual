import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubAgent } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { sessionRunStateOf, serializeBusySubIds, parseBusySubIds } from '../../utils/sessionStatus.js';
import {
  sortTabOrder, latestCardAt, TAB_SORT_KEYS, TAB_SORT_ANCHORS,
  type TabSortFacts, type TabSortKey, type TabSortAnchor,
} from './tabSort.js';

/**
 * §5.5 #17-41 — 세션 탭 정렬 손잡이(탭바 오른쪽 `+` 바로 왼쪽).
 *
 * 팝업은 두 칸이다. 위는 **기준**(우선순위가 어느 쪽에 모이는가 — 오른쪽이 기본), 아래는 **무엇으로
 * 세울지**를 고르는 버튼들. 버튼을 누르면 그 자리에서 줄이 서고 팝업은 닫힌다.
 *
 * 이 컴포넌트는 **아무것도 구독하지 않는다**(기준 하나 제외) — 카드·실행 상태·고정은 누르는 그
 * 순간에 `getState()` 로 읽는다. 탭바가 카드 3종을 구독하면 카드 하나 뜰 때마다 탭 줄 전체가 다시
 * 그려지는데, 그 값들이 필요한 시점은 사용자가 정렬을 누른 한순간뿐이다.
 */

/** 정렬 버튼 라벨 i18n 키 — 순서는 `TAB_SORT_KEYS` 가 정한다(표시와 목록이 어긋나지 않게). */
const TAB_SORT_LABEL_KEY: Record<TabSortKey, string> = {
  running: 'ide.tabbar.sortByRunning',
  recent: 'ide.tabbar.sortByRecent',
  questions: 'ide.tabbar.sortByQuestions',
  reviews: 'ide.tabbar.sortByReviews',
  userActions: 'ide.tabbar.sortByUserActions',
  pinned: 'ide.tabbar.sortByPinned',
};

/** 기준 라벨 i18n 키. */
const TAB_SORT_ANCHOR_LABEL_KEY: Record<TabSortAnchor, string> = {
  right: 'ide.tabbar.sortAnchorRight',
  left: 'ide.tabbar.sortAnchorLeft',
};

/** 기준 글리프 — 우선순위가 모이는 방향을 화살표로 말한다(lucide 톤 stroke, 이모지 ❌). */
const TAB_SORT_ANCHOR_GLYPH: Record<TabSortAnchor, readonly string[]> = {
  right: ['M5 12h14', 'M13 6l6 6-6 6'],
  left: ['M19 12H5', 'M11 18l-6-6 6-6'],
};

/** 정렬 항목 글리프 — 실행(맥박)·최신(시계)·질문(말풍선)·검수(체크 보드)·할 일(목록)·고정(핀). */
const TAB_SORT_GLYPH: Record<TabSortKey, readonly string[]> = {
  running: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  recent: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20', 'M12 7v5l3 2'],
  questions: [
    'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    'M9.5 9a2.5 2.5 0 1 1 3 2.45V13',
    'M12 16h.01',
  ],
  reviews: [
    'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2',
    'M9 3h6v4H9z',
    'M9 14l2 2 4-4',
  ],
  userActions: ['M13 6h8', 'M13 12h8', 'M13 18h8', 'M3 5h4v4H3z', 'M3 15h4v4H3z'],
  pinned: [
    'M12 17v5',
    'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
  ],
};

function MenuGlyph({ paths }: { paths: readonly string[] }): React.JSX.Element {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

interface IDETabSortMenuProps {
  /** 지금 탭 줄에 **보이는 순서** 그대로의 세션들 — 동률은 이 순서를 지킨다. */
  subs: readonly SubAgent[];
  /** 이 탭 줄의 주인. 없으면 정렬할 대상도 없다. */
  agentId: string | null;
  /** 줄 세운 결과(id 순서)를 커밋하는 창구 — 드래그 재정렬과 **같은 문**을 쓴다. */
  onSort: (order: string[]) => void;
}

export function IDETabSortMenu({ subs, agentId, onSort }: IDETabSortMenuProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const anchor = useGraphStore((s) => s.ideTabSortAnchor);
  const setAnchor = useGraphStore((s) => s.setIdeTabSortAnchor);

  useOutsidePressDismiss({ onDismiss: () => setOpen(false), enabled: open, refs: [menuRef] });

  const runSort = useCallback((key: TabSortKey) => {
    setOpen(false);
    if (!agentId) return;
    // 누르는 순간의 사실만 읽는다 — 구독하지 않는 이유는 파일 머리 주석 참고.
    const store = useGraphStore.getState();
    const busy = parseBusySubIds(serializeBusySubIds(store.runningSubagentTasks[agentId]));
    const questions = store.agentQuestions[agentId];
    const reviews = store.agentReviews[agentId];
    const reports = store.agentReports[agentId];
    const facts: TabSortFacts[] = subs.map((sub) => ({
      id: sub.id,
      // 도트를 그리는 그 함수 그대로 — 표시와 정렬이 다른 규칙을 쓰면 "초록인데 왜 뒤에 있나"가 된다.
      runState: sessionRunStateOf(sub, !!store.acknowledgedSubAgents[sub.id], busy.has(sub.id)),
      // 최신순의 원천 — 서버가 관리하는 그 세션의 마지막 활동 시각(클라에서 다시 재지 않는다).
      lastActivityAt: sub.lastActivityAt,
      lastQuestionAt: latestCardAt(questions, sub.id),
      lastReviewAt: latestCardAt(reviews, sub.id),
      // "내가 할 일"은 신고 카드 중 **사용자 몫이 실린 것**만 센다(빈 신고는 부르지 않는다).
      lastUserActionAt: latestCardAt(reports, sub.id, (r) => r.userActions.length > 0),
      pinned: !!store.tabPins[`subagent:${sub.id}`],
    }));
    onSort(sortTabOrder(facts, key, store.ideTabSortAnchor));
  }, [agentId, subs, onSort]);

  // 탭이 하나뿐이면 세울 줄이 없다 — 손잡이를 두지 않는다(훅 리스트 뒤에서 판정).
  if (!agentId || subs.length < 2) return null;

  return (
    <div className="relative flex-shrink-0" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex h-8 w-8 items-center justify-center transition-colors ${
          open ? 'bg-gray-800 text-gray-200' : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
        }`}
        title={t('ide.tabbar.sortTabs')}
        aria-label={t('ide.tabbar.sortTabs')}
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 16l4 4 4-4" />
          <path d="M7 20V4" />
          <path d="M21 8l-4-4-4 4" />
          <path d="M17 4v16" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-50 w-44 rounded-md border border-gray-700 bg-gray-900 p-1 shadow-xl shadow-black/50"
        >
          <p className="px-2 pb-0.5 pt-1 text-xs font-semibold text-gray-500">{t('ide.tabbar.sortAnchorTitle')}</p>
          {TAB_SORT_ANCHORS.map((a) => (
            <button
              key={a}
              type="button"
              role="menuitemradio"
              aria-checked={anchor === a}
              onClick={() => setAnchor(a)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                anchor === a ? 'bg-blue-500/15 text-blue-300' : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              <MenuGlyph paths={TAB_SORT_ANCHOR_GLYPH[a]} />
              {t(TAB_SORT_ANCHOR_LABEL_KEY[a])}
            </button>
          ))}

          <div className="my-1 border-t border-gray-800" />

          {TAB_SORT_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              onClick={() => runSort(key)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-gray-300 transition-colors hover:bg-gray-800 hover:text-gray-100"
            >
              <MenuGlyph paths={TAB_SORT_GLYPH[key]} />
              {t(TAB_SORT_LABEL_KEY[key])}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
