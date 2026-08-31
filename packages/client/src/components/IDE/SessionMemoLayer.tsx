import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionMemo } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { SessionMemoCard } from './SessionMemoCard.js';
import {
  canAddMemo,
  clampMemos,
  patchMemo,
  raiseMemo,
  removeMemo,
  spawnMemo,
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
}

export function SessionMemoLayer({
  agentId, sessionId, containerRef, spawnAt, onSpawnConsumed,
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
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setBounds({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBounds({ w: r.width, h: r.height });
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

  // 우클릭 메뉴가 찍은 지점에 새 메모 한 장.
  useEffect(() => {
    if (!spawnAt) return;
    onSpawnConsumed();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const board = { w: el.clientWidth, h: el.clientHeight };
    const cur = draft ?? serverMemos ?? EMPTY_MEMOS;
    if (!canAddMemo(cur)) return;
    const memo = spawnMemo({ x: spawnAt.x - rect.left, y: spawnAt.y - rect.top }, cur, board);
    setAutoFocusId(memo.id);
    apply([...cur, memo], true);
    // draft/serverMemos 를 의존성에 넣으면 스냅샷마다 재실행되어 같은 지점에 여러 장이 생긴다.
    //   생성은 spawnAt 이 바뀌는 순간 1회다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spawnAt]);

  const shown = useMemo(() => clampMemos(memos, bounds), [memos, bounds]);

  const handleChange = useCallback((id: string, patch: MemoPatch) => {
    apply(patchMemo(shown, id, patch));
  }, [apply, shown]);

  const handleCommit = useCallback(() => {
    push(shown, true);
  }, [push, shown]);

  const handleRaise = useCallback((id: string) => {
    const next = raiseMemo(shown, id);
    if (next !== shown) apply(next, true);
  }, [apply, shown]);

  const handleDelete = useCallback((id: string) => {
    apply(removeMemo(shown, id), true);
  }, [apply, shown]);

  return (
    // 판 자체는 클릭을 먹지 않는다 — 대화 본문의 스크롤·선택·우클릭이 그대로 통과해야 한다.
    //   층은 대화(기본)와 창 크롬(검색바·줌 배지 z-20, 드롭 덮개 z-30) 사이다 — 메모가 도구를 가리지 않는다.
    <div className="pointer-events-none absolute inset-0 z-[15]" data-session-memo-layer={sessionId ?? 'main'}>
      {shown.map((memo, i) => (
        <SessionMemoCard
          key={memo.id}
          memo={memo}
          bounds={bounds}
          zIndex={i + 1}
          autoFocus={memo.id === autoFocusId}
          onChange={(patch) => handleChange(memo.id, patch)}
          onCommit={handleCommit}
          onRaise={() => handleRaise(memo.id)}
          onDelete={() => handleDelete(memo.id)}
        />
      ))}
    </div>
  );
}
