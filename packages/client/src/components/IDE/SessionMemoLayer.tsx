import { memo as reactMemo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SESSION_MEMO, type SessionMemo, type SessionMemoLinkTarget } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { buildTextFieldMenuItems } from '../../hooks/textFieldContextMenu.js';
import { createTextFieldActions, hasSelectionFrom } from '../../hooks/textFieldActions.js';
import { isComposingKeyEvent } from '../../utils/inputComposition.js';
import { shortcutLabel } from '../../utils/platform.js';
import { IDEContextMenu, type ContextMenuItem } from './IDEContextMenu.js';
import { resolveAnchorIdFromSelection } from './bookmarkScroll.js';
import { SessionMemoCard, type MemoSaveWhen, type MemoTextMenuRequest } from './SessionMemoCard.js';
import { SessionMemoHistory } from './SessionMemoHistory.js';
import { MEMO_LINK_POPUP_Z } from './MemoLinkBubble.js';
import { MemoLinkFileEditor, MemoLinkUrlEditor } from './MemoLinkEditors.js';
import { MemoLinkIcon } from './memoLinkIcons.js';
import { buildMemoLinkKindItems, buildMemoLinkMenuItems, type MemoLinkKindHandlers } from './memoLinkMenu.js';
import {
  canAddMemoLink,
  linkForMenu,
  newMemoLinkId,
  rangeOverlapsLinks,
  removeMemoLink,
  retargetMemoLink,
  sessionLinkTarget,
  shiftTextRange,
  streamHeadText,
  streamLinkTarget,
  trimLinkRange,
  urlLikeSelection,
  withMemoLink,
  type TextEditHint,
  type TextRange,
} from './memoLinks.js';
import type { MemoLinkHost } from './useMemoLinkHost.js';
import {
  activateMemoTab,
  canAddMemo,
  clampMemos,
  closeMemo,
  closedSessionMemos,
  detachMemo,
  memoCards,
  mergeMemos,
  openSessionMemos,
  patchMemo,
  raiseMemo,
  raiseNextUnder,
  restoreMemo,
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
 *
 * **링크(⑫)도 이 층이 맡는다.** 본문 칸 우클릭 메뉴(글자 항목 + [링크 ▸])·웹 주소/파일 창·대화에서
 * 고르기 모드가 여기 산다 — 무엇을 가리킬 수 있는지(내 입력·다른 세션·파일)는 본문이 내려 준 묶음
 * (`MemoLinkHost`)에 묻고, 결과는 다른 편집과 **같은 낙관·저장 길**(`apply`)로 올린다. 고르기 모드는
 * 대화의 누름을 가로채므로(경로 열기·접기가 같이 돌면 안 된다) **한 번에 하나**이고, Esc·[취소]·탭 이동에 풀린다.
 */

/** 타자·드래그가 잠잠해지면 올린다. 매 글자마다 왕복하지 않기 위한 창(ms). */
const PUSH_DEBOUNCE_MS = 400;

const EMPTY_MEMOS: SessionMemo[] = [];

/** 고르기 모드에서 "여기에는 글이 없다"를 띠에 적어 두는 시간(ms) — 그 뒤엔 안내로 돌아온다. */
const PICK_MISS_MS = 1800;

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
  /**
   * ⑫ 링크가 이 화면에 묻는 것·따라가는 길(본문이 내려 준다). 없으면 본문 칸 메뉴는 글자 항목만 선다.
   */
  linkHost?: MemoLinkHost | null;
}

/** 우클릭 메뉴 — 본문 칸 위(글자 항목 + 링크 항목) 또는 링크 상자의 [다시 고르기](종류 목록만). */
type LinkMenuState =
  | ({ kind: 'text'; memoId: string } & MemoTextMenuRequest)
  | { kind: 'repick'; memoId: string; linkId: string; x: number; y: number };

/** 더 묻는 창(웹 주소·파일). `text` 는 연 순간의 본문 — 그사이 본문이 바뀌면 범위를 그만큼 옮긴다. */
interface LinkEditorState {
  kind: 'url' | 'file';
  memoId: string;
  range: TextRange;
  /** 다시 고르기면 그 링크(범위는 두고 가리키는 곳만 바꾼다). */
  linkId?: string;
  text: string;
  initial: string;
  x: number;
  y: number;
}

/** 대화에서 고르는 중. `text` 는 지금 범위가 기준 삼는 본문 — 본문이 바뀌면 범위를 따라 옮긴다. */
interface PickState {
  memoId: string;
  range: TextRange;
  linkId?: string;
  text: string;
}

/** 이 요소가 메모 카드·고르기 띠 안인가 — 고르기 모드의 누름 판정에서 뺀다. */
function insideMemoChrome(node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement ?? null;
  return !!el?.closest('[data-session-memo], [data-memo-pick-bar]');
}

/** 누름을 그대로 둘 조작 손잡이인가(버튼·입력칸·링크) — 고르기 모드라도 "글이 없다"고 나무라지 않는다. */
function isControl(el: Element): boolean {
  return !!el.closest('button, a, input, textarea, select, [role="button"]');
}

function SessionMemoLayerImpl({
  agentId, sessionId, containerRef, spawnAt, onSpawnConsumed, spreadRequest, onSpreadConsumed, linkHost = null,
}: SessionMemoLayerProps): React.JSX.Element {
  const { t } = useTranslation();
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

  // ⑫ 링크 — 메뉴·창·고르기 모드.
  const [linkMenu, setLinkMenu] = useState<LinkMenuState | null>(null);
  const [linkEditor, setLinkEditor] = useState<LinkEditorState | null>(null);
  const [pick, setPick] = useState<PickState | null>(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  /** 고르기 모드에서 글이 없는 곳을 눌렀나 — 띠의 안내가 잠시 그 사실로 바뀐다. */
  const [pickMiss, setPickMiss] = useState(false);
  // 묶음·세션은 핸들러가 의존성 없이 읽는다(카드 `memo()` 를 살리는 같은 규약).
  const hostRef = useRef(linkHost);
  hostRef.current = linkHost;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const memos = draft ?? serverMemos ?? EMPTY_MEMOS;
  const memosRef = useRef(memos);
  memosRef.current = memos;
  const closedMemosRef = useRef(EMPTY_MEMOS);
  const closedMemos = useMemo(() => {
    const next = closedSessionMemos(memos);
    const prev = closedMemosRef.current;
    if (next.length === prev.length && next.every((m, i) => m === prev[i])) return prev;
    closedMemosRef.current = next;
    return next;
  }, [memos]);
  const serverJson = useMemo(() => JSON.stringify(serverMemos ?? []), [serverMemos]);

  // 서버가 우리가 올린 그 값이 되면 낙관 표시를 놓아준다(= 다른 창의 변경도 그때부터 따라간다).
  useEffect(() => {
    if (draft === null || pushedRef.current === null) return;
    if (serverJson === pushedRef.current) setDraft(null);
  }, [serverJson, draft]);

  // 탭을 갈아타면 남은 낙관 표시는 다른 세션 것이다 — 들고 가지 않는다(링크 메뉴·창·고르기 모드도 함께 접는다).
  useEffect(() => {
    setDraft(null);
    pushedRef.current = null;
    setAutoFocusId(null);
    setLinkMenu(null);
    setLinkEditor(null);
    setPick(null);
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
  const commit = useCallback((next: SessionMemo[], immediate = false) => {
    memosRef.current = next;
    setDraft(next);
    // 새 편집이 들어왔으므로 직전 확인 표식은 무효 — 한 박자 전 값과 같아진 순간 되감기는 것을 막는다.
    pushedRef.current = null;
    push(next, immediate);
  }, [push]);

  // 화면 편집은 열린 장만 넘긴다. 보관 중인 장은 모든 저장에 함께 실어 지워지지 않게 한다.
  const apply = useCallback((next: SessionMemo[], immediate = false) => {
    commit([...next, ...memosRef.current.filter((m) => m.closedAt !== undefined)], immediate);
  }, [commit]);

  const shown = useMemo(() => clampMemos(openSessionMemos(memos), bounds), [memos, bounds]);
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

  const handlePatch = useCallback((id: string, patch: MemoPatch, when: MemoSaveWhen, editHint?: TextEditHint) => {
    const pending = pickRef.current;
    if (pending?.memoId === id && typeof patch.text === 'string') {
      const moved = shiftTextRange(pending.range, pending.text, patch.text, editHint);
      const next = moved ? { ...pending, range: moved, text: patch.text } : null;
      pickRef.current = next;
      setPick(next);
    }
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
    const cur = memosRef.current;
    const next = closeMemo(cur, id);
    if (next === cur) return;
    if (pickRef.current?.memoId === id) {
      pickRef.current = null;
      setPick(null);
    }
    setLinkMenu(null);
    setLinkEditor(null);
    commit(next, true);
  }, [commit]);

  const handleRestore = useCallback((id: string) => {
    const el = containerRef.current;
    if (!el) return;
    const cur = memosRef.current;
    const next = restoreMemo(cur, id, { w: el.clientWidth, h: el.clientHeight });
    if (next === cur) return;
    setAutoFocusId(id);
    commit(next, true);
  }, [commit, containerRef]);

  // ─── ⑫ 링크 ───

  /** 방금 건 링크로 캐럿을 돌려보낸다 — 링크 끝에 캐럿이 서면 그 자리에 링크 상자가 뜬다. */
  const focusMemoRange = useCallback((memoId: string, range: TextRange) => {
    requestAnimationFrame(() => {
      const ta = containerRef.current?.querySelector<HTMLTextAreaElement>(`[data-session-memo="${CSS.escape(memoId)}"] textarea`);
      if (!ta) return;
      ta.focus({ preventScroll: true });
      try { ta.setSelectionRange(range.end, range.end); } catch { /* 선택 API 가 없는 칸 — 캐럿은 브라우저에 맡긴다 */ }
    });
  }, [containerRef]);

  /**
   * 링크 걸기·다시 고르기의 **한 문**. `text` 는 범위를 잡은 순간의 본문이다 — 그사이 본문이 바뀌었으면
   * 범위를 그 편집만큼 옮겨서 건다(링크가 글을 따라 움직이는 것과 같은 규칙). 글자가 지워졌으면 걸지 않는다.
   */
  const applyLink = useCallback((memoId: string, range: TextRange, target: SessionMemoLinkTarget, linkId: string | undefined, text: string) => {
    const cur = shownRef.current;
    const memo = cur.find((m) => m.id === memoId);
    if (!memo) return;
    let links: SessionMemo['links'] | null;
    let at: TextRange;
    if (linkId) {
      const existing = memo.links?.find((l) => l.id === linkId);
      if (!existing) return;
      links = retargetMemoLink(memo.links, linkId, target);
      at = existing;
    } else {
      const moved = memo.text === text ? range : shiftTextRange(range, text, memo.text);
      if (!moved) return;
      links = withMemoLink(memo.links, moved, target, newMemoLinkId());
      at = moved;
    }
    if (!links) return;
    apply(patchMemo(cur, memoId, { links }), true);
    focusMemoRange(memoId, at);
  }, [apply, focusMemoRange]);

  const handleTextMenu = useCallback((id: string, req: MemoTextMenuRequest) => {
    setLinkEditor(null);
    setLinkMenu({ kind: 'text', memoId: id, ...req });
  }, []);

  const handleLinkRepick = useCallback((id: string, linkId: string, at: { x: number; y: number }) => {
    setLinkEditor(null);
    setLinkMenu({ kind: 'repick', memoId: id, linkId, x: at.x, y: at.y });
  }, []);

  const handleLinkRemove = useCallback((id: string, linkId: string) => {
    const cur = shownRef.current;
    const memo = cur.find((m) => m.id === id);
    if (!memo?.links?.some((l) => l.id === linkId)) return;
    apply(patchMemo(cur, id, { links: removeMemoLink(memo.links, linkId) }), true);
  }, [apply]);

  /**
   * 링크를 따라간다 — 갈 길은 본문이 안다(`MemoLinkHost.open`). 가고 나면 메모 칸의 초점을 놓는다:
   * 대화로 갔으면 그 자리의 글이 골라져 있는데 캐럿이 메모에 남아 있으면 이어 친 글자가 메모로 간다.
   */
  const handleLinkFollow = useCallback(async (id: string, linkId: string): Promise<boolean> => {
    const host = hostRef.current;
    const link = shownRef.current.find((m) => m.id === id)?.links?.find((l) => l.id === linkId);
    if (!host || !link) return false;
    let ok = false;
    try {
      ok = await host.open(link.target);
    } catch {
      // 이동 실패도 상자의 기존 실패 표시로 돌린다(네트워크 오류가 미처리 거절로 새지 않게).
      return false;
    }
    if (ok) {
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement && active.closest('[data-session-memo]')) active.blur();
    }
    return ok;
  }, []);

  const closeLinkMenu = useCallback(() => setLinkMenu(null), []);
  const closeLinkEditor = useCallback(() => setLinkEditor(null), []);
  const cancelPick = useCallback(() => setPick(null), []);

  /** 종류 목록에서 고른 것 — 새로 걸기·다시 고르기가 같은 손잡이를 쓴다(다른 것은 `linkId` 뿐이다). */
  const kindHandlers = useCallback((memo: SessionMemo, range: TextRange, linkId: string | undefined, at: { x: number; y: number }): MemoLinkKindHandlers => {
    const existing = linkId ? memo.links?.find((l) => l.id === linkId)?.target : undefined;
    return {
      pick: () => {
        setPickMiss(false);
        setPick({ memoId: memo.id, range, ...(linkId ? { linkId } : {}), text: memo.text });
      },
      prompt: (entry) => {
        const target = streamLinkTarget(sessionIdRef.current, entry.id, streamHeadText(entry.text));
        if (target) applyLink(memo.id, range, target, linkId, memo.text);
      },
      session: (option) => {
        const target = sessionLinkTarget(option.id, option.label);
        if (target) applyLink(memo.id, range, target, linkId, memo.text);
      },
      file: () => setLinkEditor({
        kind: 'file', memoId: memo.id, range, ...(linkId ? { linkId } : {}), text: memo.text, x: at.x, y: at.y,
        initial: existing?.kind === 'file' ? existing.path : '',
      }),
      url: () => setLinkEditor({
        kind: 'url', memoId: memo.id, range, ...(linkId ? { linkId } : {}), text: memo.text, x: at.x, y: at.y,
        // 다시 고르는 웹 링크면 지금 주소, 아니면 고른 글자가 주소처럼 생겼을 때 그 글자.
        initial: existing?.kind === 'url' ? existing.url : urlLikeSelection(memo.text.slice(range.start, range.end)),
      }),
    };
  }, [applyLink]);

  /** 우클릭 메뉴의 줄들 — 연 순간 한 번 짓는다(내 입력·세션 목록도 그때 한 번 읽는다). */
  const linkMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!linkMenu) return [];
    const memo = shownRef.current.find((m) => m.id === linkMenu.memoId);
    if (!memo) return [];
    const host = hostRef.current;
    const at = { x: linkMenu.x, y: linkMenu.y };
    const kindItems = (range: TextRange, linkId?: string): ContextMenuItem[] => (host
      ? buildMemoLinkKindItems(
        { prompts: host.prompts(), sessions: host.sessions(), formatTime: host.formatTime },
        kindHandlers(memo, range, linkId, at),
        t,
      )
      : []);

    if (linkMenu.kind === 'repick') {
      const link = memo.links?.find((l) => l.id === linkMenu.linkId);
      return link ? kindItems({ start: link.start, end: link.end }, link.id) : [];
    }

    const { el, sel } = linkMenu;
    const textItems = buildTextFieldMenuItems(
      { hasSelection: hasSelectionFrom(sel), readOnly: el.readOnly },
      createTextFieldActions(el, sel),
      t,
    );
    if (!host) return textItems;
    const start = sel.start ?? 0;
    const end = sel.end ?? start;
    const link = linkForMenu(memo.links, memo.text, start, end) ?? null;
    const range = link || start === end ? null : trimLinkRange(memo.text, start, end);
    const linkItems = buildMemoLinkMenuItems(
      {
        link,
        range,
        replaces: range ? rangeOverlapsLinks(memo.links, range) : false,
        atLimit: range ? !canAddMemoLink(memo.links, range) : false,
      },
      {
        follow: () => { if (link) void handleLinkFollow(memo.id, link.id); },
        remove: () => { if (link) handleLinkRemove(memo.id, link.id); },
        kinds: link ? kindItems({ start: link.start, end: link.end }, link.id) : range ? kindItems(range) : [],
        followHint: t('ide.memo.link.followHint', { shortcut: shortcutLabel('Ctrl') }),
      },
      t,
    );
    return [...textItems, ...linkItems];
  }, [linkMenu, t, kindHandlers, handleLinkFollow, handleLinkRemove]);

  // 고르기 모드 중에 그 장의 본문이 바뀌면(옆에서 쳤다) 걸릴 범위도 따라 옮긴다 — 점선이 엉뚱한 글자에 남지 않게.
  //   장이 사라졌거나 그 글자가 지워졌으면 모드를 접는다.
  useEffect(() => {
    const p = pickRef.current;
    if (!p) return;
    const memo = shown.find((m) => m.id === p.memoId);
    if (!memo) { setPick(null); return; }
    if (memo.text === p.text) return;
    const moved = shiftTextRange(p.range, p.text, memo.text);
    setPick(moved ? { ...p, range: moved, text: memo.text } : null);
  }, [shown]);

  /**
   * 고르기 모드 — 대화의 누름을 **가로챈다**. 끝은 셋: 대화에서 글을 누르거나 끌어 고른다(걸린다) ·
   * Esc / [취소] · 탭을 옮긴다(위 탭 효과가 접는다).
   *
   *  - `mouseup`(캡처): 손을 뗀 **다음 틀**에 선택을 읽는다 — 끌어 고른 글자가 있으면 그 글, 없으면 누른
   *    항목의 첫머리. 둘 다 북마크(#17-7)와 같은 두 값(항목 id · 그 자리의 글)으로 남는다.
   *  - `click`(캡처): 대화 항목 위의 누름은 고르기다 — 경로 열기·접기·완료 확인 같은 본래 동작이 같이
   *    돌면 안 되므로 여기서 끊는다. 버튼·링크가 아닌 빈 자리·다른 손잡이는 건드리지 않는다.
   *  - `mousemove`: 지금 누르면 걸릴 항목에 옅은 점선을 둘러 보여 준다(한 프레임에 한 번).
   *
   * 클릭은 손을 뗀 그 틀 안에서 도착하고 선택 읽기는 다음 틀이라, 클릭을 끊는 동안 모드는 아직 살아 있다.
   */
  const pickActive = pick !== null;
  useEffect(() => {
    if (!pickActive) return;
    const container = containerRef.current;
    if (!container) return;
    let missTimer: ReturnType<typeof setTimeout> | undefined;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let hoverEl: HTMLElement | null = null;
    let raf = 0;

    const itemOf = (node: Element | null): HTMLElement | null => {
      const item = node?.closest('[data-stream-item-id]');
      return item instanceof HTMLElement && container.contains(item) && !insideMemoChrome(item) ? item : null;
    };
    const setHover = (el: HTMLElement | null): void => {
      if (el === hoverEl) return;
      if (hoverEl) { hoverEl.style.outline = ''; hoverEl.style.outlineOffset = ''; }
      hoverEl = el;
      if (el) { el.style.outline = '1px dashed rgba(56, 189, 248, 0.7)'; el.style.outlineOffset = '2px'; }
    };
    const miss = (): void => {
      setPickMiss(true);
      if (missTimer) clearTimeout(missTimer);
      missTimer = setTimeout(() => setPickMiss(false), PICK_MISS_MS);
    };

    const finish = (clicked: Element, request: PickState): void => {
      if (disposed || pickRef.current !== request) return;
      const sid = sessionIdRef.current;
      const sel = window.getSelection();
      const selected = sel && !sel.isCollapsed ? sel.toString() : '';
      let target: SessionMemoLinkTarget | null = null;
      if (selected.trim() && sel?.anchorNode && container.contains(sel.anchorNode) && !insideMemoChrome(sel.anchorNode)) {
        // 선택의 시작만 이 판에 있다고 다른 판·메모의 글까지 대상에 넣으면 안 된다.
        if (!sel.focusNode || !container.contains(sel.focusNode) || insideMemoChrome(sel.focusNode)) {
          miss();
          return;
        }
        target = streamLinkTarget(sid, resolveAnchorIdFromSelection(), selected);
      } else {
        const item = itemOf(clicked);
        if (item) target = streamLinkTarget(sid, item.getAttribute('data-stream-item-id') ?? undefined, streamHeadText(item.textContent ?? ''));
      }
      if (!target) {
        if (!isControl(clicked)) miss();
        return;
      }
      sel?.removeAllRanges();
      pickRef.current = null;
      setPick(null);
      applyLink(request.memoId, request.range, target, request.linkId, request.text);
    };

    const onMouseUp = (e: MouseEvent): void => {
      if (e.button !== 0) return;
      const el = e.target instanceof Element ? e.target : null;
      if (!el || !container.contains(el) || insideMemoChrome(el)) return;
      const request = pickRef.current;
      if (!request) return;
      if (finishTimer) clearTimeout(finishTimer);
      finishTimer = setTimeout(() => finish(el, request), 0);
    };
    const onClick = (e: MouseEvent): void => {
      if (!pickRef.current) return;
      const el = e.target instanceof Element ? e.target : null;
      if (!el || !container.contains(el) || insideMemoChrome(el) || !itemOf(el)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || isComposingKeyEvent(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setPick(null);
    };
    const onMove = (e: MouseEvent): void => {
      if (raf) return;
      const el = e.target instanceof Element ? e.target : null;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setHover(itemOf(el));
      });
    };

    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    container.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      disposed = true;
      document.removeEventListener('mouseup', onMouseUp, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey, true);
      container.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
      if (missTimer) clearTimeout(missTimer);
      if (finishTimer) clearTimeout(finishTimer);
      setHover(null);
    };
  }, [pickActive, containerRef, applyLink]);

  const pickMemoId = pick?.memoId ?? null;
  const pickRange = pick?.range ?? null;

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
          closedMemos={closedMemos}
          onRestore={handleRestore}
          restoreDisabled={!canAddMemo(shown)}
          onActivateTab={handleActivateTab}
          onMerge={handleMerge}
          onDetach={handleDetach}
          linkHost={linkHost}
          pickRange={card.active.id === pickMemoId ? pickRange : null}
          onTextMenu={handleTextMenu}
          onLinkFollow={handleLinkFollow}
          onLinkRepick={handleLinkRepick}
          onLinkRemove={handleLinkRemove}
        />
      ))}

      {cards.length === 0 && closedMemos.length > 0 && (
        <div className="pointer-events-auto absolute right-2 top-2 rounded-md border border-gray-600/60 bg-gray-900/95 px-2 py-1 text-gray-200 shadow-lg" data-memo-history="">
          <SessionMemoHistory closedMemos={closedMemos} onRestore={handleRestore} showLabel />
        </div>
      )}

      {/* ⑫ 고르기 모드 — 판 테두리와 위쪽 안내 띠. 띠만 누름을 받는다(대화는 그대로 스크롤·선택된다). */}
      {pick && (
        <>
          <div className="pointer-events-none absolute inset-1 rounded-md border border-dashed border-sky-400/60" />
          <div
            data-memo-pick-bar=""
            role="status"
            className="pointer-events-auto absolute left-1/2 top-2 flex max-w-[calc(100%-16px)] -translate-x-1/2 items-center gap-2 rounded-full border border-sky-400/40 bg-gray-900/95 py-1 pl-3 pr-1 text-[12px] text-sky-100 shadow-lg shadow-black/40 backdrop-blur-sm"
            // 메모 카드(손이 올라가면 PEEK_Z)보다 위 — 안내가 메모에 덮이면 모드를 빠져나갈 손잡이가 사라진다.
            style={{ zIndex: SESSION_MEMO.PEEK_Z + 1 }}
          >
            <MemoLinkIcon name="pick" />
            <span className={`min-w-0 truncate ${pickMiss ? 'text-amber-200' : ''}`}>
              {pickMiss ? t('ide.memo.link.pickMiss') : t('ide.memo.link.pickHint')}
            </span>
            <kbd className="flex-shrink-0 rounded border border-gray-600 px-1 text-[12px] leading-4 text-gray-400">Esc</kbd>
            <button
              type="button"
              onClick={cancelPick}
              className="flex-shrink-0 rounded-full px-2 py-0.5 text-gray-300 transition-colors hover:bg-white/10"
            >
              {t('common.cancel')}
            </button>
          </div>
        </>
      )}

      {/* ⑫ 본문 칸 우클릭 메뉴 · [다시 고르기] 목록. 포털이라도 리액트 이벤트는 조상(대화 본문)으로 오른다 —
          본문의 글자 메뉴·완료 확인이 같이 돌지 않게 감싼 자리에서 끊는다. */}
      {linkMenu && linkMenuItems.length > 0 && (
        <span
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <IDEContextMenu
            x={linkMenu.x}
            y={linkMenu.y}
            items={linkMenuItems}
            zIndex={MEMO_LINK_POPUP_Z}
            onClose={closeLinkMenu}
          />
        </span>
      )}

      {linkEditor?.kind === 'url' && (
        <MemoLinkUrlEditor
          x={linkEditor.x}
          y={linkEditor.y}
          initial={linkEditor.initial}
          onApply={(target) => {
            setLinkEditor(null);
            applyLink(linkEditor.memoId, linkEditor.range, target, linkEditor.linkId, linkEditor.text);
          }}
          onClose={closeLinkEditor}
        />
      )}
      {linkEditor?.kind === 'file' && (
        <MemoLinkFileEditor
          x={linkEditor.x}
          y={linkEditor.y}
          rootPath={linkHost?.rootPath() ?? null}
          initial={linkEditor.initial}
          onApply={(target) => {
            setLinkEditor(null);
            applyLink(linkEditor.memoId, linkEditor.range, target, linkEditor.linkId, linkEditor.text);
          }}
          onClose={closeLinkEditor}
        />
      )}
    </div>
  );
}

/**
 * IDE 본문은 스트리밍 중 초당 수십 번 다시 그려진다 — 그때마다 이 판까지 따라 그릴 이유가 없다
 * (props 는 탭이 바뀌거나 새 메모를 찍을 때만 바뀐다).
 */
export const SessionMemoLayer = reactMemo(SessionMemoLayerImpl);
