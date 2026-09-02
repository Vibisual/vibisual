import { memo as reactMemo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionMemo } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { SessionMemoCard, type MemoSaveWhen } from './SessionMemoCard.js';
import {
  activateMemoTab,
  canAddMemo,
  clampMemos,
  detachMemo,
  memoCards,
  mergeMemos,
  patchMemo,
  raiseMemo,
  raiseNextUnder,
  removeMemo,
  spawnMemo,
  spreadOverlappingMemos,
  stackedUnderCounts,
  type MemoBounds,
  type MemoPatch,
} from './sessionMemo.js';

/**
 * SessionMemoLayer.tsx — §5.5 #17-36 스티키 메모 **판**.
 *
 * 이 층이 하는 일 셋: (a) 서버가 든 메모 목록을 읽고, (b) 사용자가 방금 만진 결과를 **낙관 표시**로
 * 먼저 보여 주고, (c) 잠잠해지면 목록 전량을 서버에 올린다(`PUT /api/session-memos`).
 * 자리는 세션이 정한다 — 세션 탭이면 `subAgents[].memos`(그 세션의 소지품이라 세션이 사라질 때
 * 함께 사라진다), 메인 탭이면 `agentMemos[agentId]`.
 *
 * ⚠ 낙관 표시를 **서버 값이 바뀌면 놓아주는** 방식으로 만들면 안 된다(`IDETerminalPanes` 의 방식).
 * 스냅샷은 16~250ms 마다 통째로 오고 참조가 매번 새것이라, 글자를 치는 도중에 놓아주면 방금 친
 * 글자가 되돌아간다. 그래서 **"서버가 우리가 올린 그 값이 되었을 때"만** 놓아준다(`pushedRef`).
 * 새로 편집하면 그 표식을 즉시 지운다 — 안 그러면 한 박자 전 값과 같아진 순간 새 편집이 날아간다.
 *
 * **겹침은 막지 않는다** — 이동에 충돌 회피를 넣지 않는 것이 의도다(포스트잇은 원래 겹쳐 붙인다).
 * 대신 겹친 뒤에 잃는 것을 돌려준다: 각 장이 자기 밑에 깔아 놓은 장수를 여기서 한 번에 세어
 * (`stackedUnderCounts`) 카드가 배지를 달게 하고, 배지를 누르면 바로 밑장을 위로 올리며
 * (`raiseNextUnder`), 우클릭 메뉴의 [펼치기]는 판 크기를 아는 이 층이 수행한다
 * (`spreadOverlappingMemos`) — 카드도 메뉴도 판 크기를 모른다.
 *
 * ⚠ **카드에 넘기는 핸들러는 전부 정체성이 고정돼야 한다.** 카드마다 `(patch) => f(memo.id, patch)`
 * 같은 새 클로저를 주면 `SessionMemoCard` 의 `memo()` 가 영영 헛돌아, 글자 하나에 24장이 통째로
 * 다시 그려진다. 그래서 핸들러는 id 를 인자로 받고 현재 목록은 ref 로 읽는다(의존성 0개).
 */

/** 타자·드래그가 잠잠해지면 올린다. 매 글자마다 왕복하지 않기 위한 창(ms). */
const PUSH_DEBOUNCE_MS = 400;

const EMPTY_MEMOS: SessionMemo[] = [];

interface SessionMemoLayerProps {
  agentId: string;
  /** 세션 탭이면 그 sub id, 메인 탭이면 null. */
  sessionId: string | null;
  /** 메모가 놓이는 판 — 좌표는 이 요소의 좌상단 기준이다. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 우클릭 메뉴가 넘긴 생성 지점(화면 좌표). 소비하면 `onSpawnConsumed` 로 알린다. */
  spawnAt: { x: number; y: number } | null;
  onSpawnConsumed: () => void;
  /**
   * 우클릭 메뉴의 [겹친 메모 펼치기] 요청 — 값이 바뀔 때 1회 수행하는 **신호**라 내용은 아무 숫자나
   * 상관없다(`spawnAt` 과 같은 규약). 판 크기를 아는 것이 이 층뿐이라 메뉴가 직접 못 한다.
   */
  spreadRequest: number | null;
  onSpreadConsumed: () => void;
}

function SessionMemoLayerImpl({
  agentId, sessionId, containerRef, spawnAt, onSpawnConsumed, spreadRequest, onSpreadConsumed,
}: SessionMemoLayerProps): React.JSX.Element {
  const serverMemos = useGraphStore((s) => (
    sessionId
      ? s.subAgents[agentId]?.find((x) => x.id === sessionId)?.memos
      : s.agentMemos[agentId]
  ));

  /** 낙관 표시 — null 이면 서버 값을 그대로 본다. */
  const [draft, setDraft] = useState<SessionMemo[] | null>(null);
  /** 마지막으로 서버가 확인해 준 목록의 직렬화본. 이 값과 같아지면 낙관 표시를 놓아준다. */
  const pushedRef = useRef<string | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [bounds, setBounds] = useState<MemoBounds>({ w: 0, h: 0 });
  const [autoFocusId, setAutoFocusId] = useState<string | null>(null);

  const memos = draft ?? serverMemos ?? EMPTY_MEMOS;
  const serverJson = useMemo(() => JSON.stringify(serverMemos ?? []), [serverMemos]);

  // 서버가 우리가 올린 그 값이 되면 낙관 표시를 놓아준다(= 다른 창의 변경도 그때부터 따라간다).
  useEffect(() => {
    if (draft === null || pushedRef.current === null) return;
    if (serverJson === pushedRef.current) setDraft(null);
  }, [serverJson, draft]);

  // 탭을 갈아타면 남은 낙관 표시는 다른 세션 것이다 — 들고 가지 않는다.
  useEffect(() => {
    setDraft(null);
    pushedRef.current = null;
    setAutoFocusId(null);
  }, [agentId, sessionId]);

  // 판 크기 추적 — 창을 좁히면 메모를 판 안으로 되돌려 그린다.
  //   ⚠ 값이 같으면 **상태를 갈지 않는다**. contentRect 는 소수라 리사이즈 중 같은 픽셀에서도
  //   새 객체가 나오고, 그때마다 판 전체가 다시 그려진다.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const put = (w: number, h: number): void => {
      const rw = Math.round(w);
      const rh = Math.round(h);
      setBounds((prev) => (prev.w === rw && prev.h === rh ? prev : { w: rw, h: rh }));
    };
    put(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) put(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  useEffect(() => () => { if (pushTimer.current) clearTimeout(pushTimer.current); }, []);

  const push = useCallback((next: SessionMemo[], immediate: boolean) => {
    if (pushTimer.current) clearTimeout(pushTimer.current);
    const send = (): void => {
      void fetch('/api/session-memos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, subAgentId: sessionId, memos: next }),
      })
        .then((r) => r.json() as Promise<{ ok?: boolean; memos?: SessionMemo[] }>)
        // 서버가 정화한 판본을 기준으로 삼는다 — 우리가 보낸 원본과 한 글자라도 다르면
        //   비교가 영영 안 맞아 낙관 표시를 놓아주지 못한다.
        .then((data) => { if (data?.memos) pushedRef.current = JSON.stringify(data.memos); })
        .catch(() => { pushedRef.current = null; /* 실패 — 낙관 표시를 계속 들고 있는다 */ });
    };
    if (immediate) send();
    else pushTimer.current = setTimeout(send, PUSH_DEBOUNCE_MS);
  }, [agentId, sessionId]);

  /** 화면을 먼저 바꾸고(낙관) 저장을 예약한다. `immediate` 면 지금 올린다. */
  const apply = useCallback((next: SessionMemo[], immediate = false) => {
    setDraft(next);
    // 새 편집이 들어왔으므로 직전 확인 표식은 무효 — 한 박자 전 값과 같아진 순간 되감기는 것을 막는다.
    pushedRef.current = null;
    push(next, immediate);
  }, [push]);

  const shown = useMemo(() => clampMemos(memos, bounds), [memos, bounds]);
  // 핸들러가 의존성 없이 현재 목록을 읽는 창구 — 이것이 카드 `memo()` 를 살린다(위 ⚠ 참고).
  const shownRef = useRef(shown);
  shownRef.current = shown;

  // 우클릭 메뉴가 찍은 지점에 새 메모 한 장.
  useEffect(() => {
    if (!spawnAt) return;
    onSpawnConsumed();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const board = { w: el.clientWidth, h: el.clientHeight };
    const cur = shownRef.current;
    if (!canAddMemo(cur)) return;
    const memo = spawnMemo({ x: spawnAt.x - rect.left, y: spawnAt.y - rect.top }, cur, board);
    setAutoFocusId(memo.id);
    apply([...cur, memo], true);
    // 목록을 의존성에 넣으면 스냅샷마다 재실행되어 같은 지점에 여러 장이 생긴다.
    //   생성은 spawnAt 이 바뀌는 순간 1회다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spawnAt]);

  const handlePatch = useCallback((id: string, patch: MemoPatch, when: MemoSaveWhen) => {
    apply(patchMemo(shownRef.current, id, patch), when === 'now');
  }, [apply]);

  const handleRaise = useCallback((id: string) => {
    const cur = shownRef.current;
    const next = raiseMemo(cur, id);
    if (next !== cur) apply(next, true);
  }, [apply]);

  /** 겹침 배지 — 이 장이 덮고 있는 것 중 바로 밑장을 위로. 자리는 그대로, 순서만 바뀐다. */
  const handleRaiseUnder = useCallback((id: string) => {
    const cur = shownRef.current;
    const next = raiseNextUnder(cur, id);
    if (next !== cur) apply(next, true);
  }, [apply]);

  // [겹친 메모 펼치기] — 판 크기를 아는 곳이 여기뿐이라 이 층이 수행한다.
  //   목록을 의존성에 넣지 않는 이유는 생성(spawnAt)과 같다 — 스냅샷마다 재실행되면 안 된다.
  useEffect(() => {
    if (spreadRequest === null) return;
    onSpreadConsumed();
    const el = containerRef.current;
    if (!el) return;
    const cur = shownRef.current;
    const next = spreadOverlappingMemos(cur, { w: el.clientWidth, h: el.clientHeight });
    if (next !== cur) apply(next, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreadRequest]);

  /**
   * 각 장이 자기 밑에 깔아 놓은 장수 — 카드가 배지를 그릴 때 쓴다. **여기서 한 번에** 계산하는
   * 것이 요점이다(카드마다 목록 전체를 훑으면 24장이 24번씩 훑는다).
   */
  const underCounts = useMemo(() => stackedUnderCounts(shown), [shown]);

  /** 합쳐진 것끼리 묶어 **카드 목록**으로 — 화면은 장이 아니라 카드를 그린다. */
  const cards = useMemo(() => memoCards(shown), [shown]);

  const handleActivateTab = useCallback((id: string) => {
    const cur = shownRef.current;
    const next = activateMemoTab(cur, id);
    if (next !== cur) apply(next, true);
  }, [apply]);

  /** 합치기 — 자리는 받는 쪽이 정하므로 판 크기가 필요 없다. */
  const handleMerge = useCallback((dragId: string, targetId: string, wholeCard: boolean) => {
    const cur = shownRef.current;
    const next = mergeMemos(cur, dragId, targetId, wholeCard);
    if (next !== cur) apply(next, true);
  }, [apply]);

  /** 떼어내기 — 놓은 자리를 판 안으로 접어야 하므로 판 크기를 아는 이 층이 한다. */
  const handleDetach = useCallback((id: string, at: { x: number; y: number }) => {
    const el = containerRef.current;
    if (!el) return; // 판을 모르면 어디에 놓을지도 모른다 — 엉뚱한 자리로 떨어뜨리지 않는다.
    const cur = shownRef.current;
    const next = detachMemo(cur, id, at, { w: el.clientWidth, h: el.clientHeight });
    if (next !== cur) apply(next, true);
  }, [apply, containerRef]);

  const handleDelete = useCallback((id: string) => {
    apply(removeMemo(shownRef.current, id), true);
  }, [apply]);

  return (
    // 판 자체는 클릭을 먹지 않는다 — 대화 본문의 스크롤·선택·우클릭이 그대로 통과해야 한다.
    //   층은 대화(기본)와 창 크롬(검색바·줌 배지 z-20, 드롭 덮개 z-30) 사이다 — 메모가 도구를 가리지 않는다.
    <div className="pointer-events-none absolute inset-0 z-[15]" data-session-memo-layer={sessionId ?? 'main'}>
      {cards.map((card) => (
        <SessionMemoCard
          key={card.key}
          memo={card.active}
          tabs={card.members}
          bounds={bounds}
          zIndex={card.zIndex}
          stackedUnder={underCounts.get(card.active.id) ?? 0}
          autoFocus={card.active.id === autoFocusId}
          onPatch={handlePatch}
          onRaise={handleRaise}
          onRaiseUnder={handleRaiseUnder}
          onDelete={handleDelete}
          onActivateTab={handleActivateTab}
          onMerge={handleMerge}
          onDetach={handleDetach}
        />
      ))}
    </div>
  );
}

/**
 * IDE 본문은 스트리밍 중 초당 수십 번 다시 그려진다 — 그때마다 이 판까지 따라 그릴 이유가 없다
 * (props 는 탭이 바뀌거나 새 메모를 찍을 때만 바뀐다).
 */
export const SessionMemoLayer = reactMemo(SessionMemoLayerImpl);
