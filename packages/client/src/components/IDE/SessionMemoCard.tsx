import { memo as reactMemo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { SESSION_MEMO, SESSION_MEMO_PALETTE, normalizeMemoName, type SessionMemo } from '@vibisual/shared';
import { CommentBoxColorPopover } from '../Panel/CommentBoxColorPopover.js';
import { hasMemoName, memoAlpha, memoSurface, memoTitle, moveMemo, resizeMemo, type MemoBounds, type MemoPatch } from './sessionMemo.js';
import { useAppThemeTokenHex } from '../../theme/useAppTheme.js';
import { pickReadableTextColor } from '../../utils/commentBoxStyle.js';
import { readFieldSelection, type FieldSelection } from '../../hooks/textFieldActions.js';
import { MemoLinkMirror } from './MemoLinkMirror.js';
import { MemoLinkBubble } from './MemoLinkBubble.js';
import { linkAtRange, linkHoldingRange, memoLinkInk, memoLinkSegments, shiftMemoLinks, type MemoLinkSegment, type TextEditHint, type TextRange } from './memoLinks.js';
import type { MemoLinkHost } from './useMemoLinkHost.js';
import { visibleMemoLinkAnchor, type MemoLinkAnchor } from './memoLinkGeometry.js';
import { isComposingKeyEvent } from '../../utils/inputComposition.js';
import { SessionMemoHistory } from './SessionMemoHistory.js';

/**
 * §5.5 #17-36 — 스티키 메모 한 장(어두운 유리판, 색 × `alpha` + `backdrop-filter`; 글자색은 알파를 섞은 실제 색 — `memoSurface`).
 * ⚠ 끄는 동안 React 를 거치지 않는다 — `transform`·`width·height` 만 직접 쓰고 손을 뗄 때 한 번 올린다(스트리밍 중 커서가 카드를 앞지르지 않게). 이동·리사이즈는 pointer capture, 색 선택기는 body 로 포털(overflow·transform 에 안 갇히게).
 * 겹침은 막지 않는다 — 손이 올라간 장은 잠시 맨 앞(`PEEK_Z`), 덮인 장은 덮은 쪽 "밑에 N장" 배지로 꺼낸다.
 * 제목줄 위에 놓으면 합치고(탭 줄), 탭을 끌어내면 뗀다. 합쳐도 본문·이름·색은 탭마다, 자리·크기·접힘만 공유. 대상은 `elementFromPoint`(자신은 잠깐 `pointer-events:none`).
 * 이름은 제자리 편집 — F2·더블클릭·우클릭이 `startRename` 하나로 모인다. 긴 제목은 CSS `truncate`(폭이 달라 글자수로 자르지 않는다).
 */

/** 저장은 언제 — `'defer'` 는 잠잠해지면, `'now'` 는 지금. */
export type MemoSaveWhen = 'defer' | 'now';

/** 메모 입력칸 우클릭 — 판이 글자 항목(잘라내기·붙여넣기…)과 링크 항목을 함께 연다. */
export interface MemoTextMenuRequest {
  x: number;
  y: number;
  el: HTMLTextAreaElement;
  /** 우클릭 **순간**의 선택 — 메뉴를 누를 때는 초점이 옮겨가 있을 수 있다. */
  sel: FieldSelection;
}

/** 링크 층이 없는 장의 토막(빈 배열) — 매 렌더 새 배열을 만들지 않는다. */
const NO_SEGMENTS: MemoLinkSegment[] = [];

/** 밝은 판 판정의 기준 종이(흰색) — 이 종이와 글자색이 같으면 밝은 판이다(`memoSurface` 와 같은 판정). */
const LIGHT_PROBE = '#FFFFFF';

interface SessionMemoCardProps {
  /** 지금 보이는 장(= 활성 탭). 자리·크기·색은 이 장의 것이다. */
  memo: SessionMemo;
  /** 이 카드의 탭들(순서 = 탭 순서). 혼자면 `[memo]` 한 장이라 탭 줄을 그리지 않는다. */
  tabs: SessionMemo[];
  /** 메모가 놓인 판의 크기 — 이동·리사이즈 한계. */
  bounds: MemoBounds;
  /** 배열 순서에서 온 겹침 순서. */
  zIndex: number;
  /**
   * 이 장이 **자기 밑에 깔아 놓은**(= 이름이 안 보이게 만든) 장수. 0 이면 배지가 없다.
   * 계산은 층이 한 번에 한다 — 카드마다 목록 전체를 훑으면 24장이 24번씩 훑는다.
   */
  stackedUnder: number;
  /** 방금 만든 메모 — 마운트 직후 본문에 커서를 둔다. */
  autoFocus: boolean;
  /**
   * 값 갱신. **id 를 함께 넘긴다** — 카드마다 새 클로저를 만들면 `memo()` 가 무력해져
   * 한 장을 건드릴 때마다 모든 카드가 다시 그려진다.
   */
  onPatch: (id: string, patch: MemoPatch, when: MemoSaveWhen, editHint?: TextEditHint) => void;
  /** 이 장을 맨 앞으로. */
  onRaise: (id: string) => void;
  /** 이 장이 덮고 있는 것 중 **바로 밑장**을 맨 앞으로(한 겹씩 벗겨 보기). */
  onRaiseUnder: (id: string) => void;
  onDelete: (id: string) => void;
  /** This session's closed memos, newest first. */
  closedMemos?: SessionMemo[];
  onRestore?: (id: string) => void;
  restoreDisabled?: boolean;
  /** 탭 전환 — 그 장을 보이게 한다. */
  onActivateTab: (id: string) => void;
  /**
   * 합치기. `wholeCard` 면 이 카드 통째로(제목줄을 끌어 다른 카드에 떨어뜨렸다),
   * 아니면 `dragId` 탭 한 장만 옮긴다(탭을 뽑아 다른 카드에 떨어뜨렸다).
   */
  onMerge: (dragId: string, targetId: string, wholeCard: boolean) => void;
  /** 떼어내기 — 탭을 판의 그 자리에 혼자 서는 카드로 내려놓는다(좌표는 판 기준). */
  onDetach: (id: string, at: { x: number; y: number }) => void;
  /**
   * ⑫ 링크가 이 화면에 묻는 것·따라가는 길(본문이 내려 준다). 없으면 링크 상자를 띄우지 않는다.
   * 정체가 고정된 묶음이라 `memo()` 를 깨지 않는다.
   */
  linkHost: MemoLinkHost | null;
  /** ⑫ 이 장의 글자를 지금 고르는 중이면 그 범위(점선으로 보인다), 아니면 null. */
  pickRange: TextRange | null;
  /** ⑫ 입력칸 우클릭 — 판이 글자 항목 + 링크 항목을 연다. */
  onTextMenu: (id: string, req: MemoTextMenuRequest) => void;
  /** ⑫ 링크를 따라간다 — 못 가면 false. */
  onLinkFollow: (id: string, linkId: string) => Promise<boolean>;
  /** ⑫ 링크 다시 고르기 — 종류 목록을 그 자리(화면 좌표)에 연다. */
  onLinkRepick: (id: string, linkId: string, at: { x: number; y: number }) => void;
  /** ⑫ 링크 해제 — 글자는 두고 링크만 걷는다. */
  onLinkRemove: (id: string, linkId: string) => void;
}

/** 방금 닫힌 팝오버를 같은 클릭이 다시 여는 것을 막는 창(ms). */
const PICKER_REOPEN_GUARD_MS = 200;

/** 불투명도를 눈으로 보여 주는 체커보드 — 색 칩 뒤에 깔린다. */
const CHECKERBOARD = 'repeating-conic-gradient(rgba(148,163,184,0.55) 0% 25%, rgba(226,232,240,0.55) 0% 50%) 50% / 6px 6px';

/** 탭을 눌렀는지 끌었는지 가르는 거리(px). 이보다 덜 움직였으면 "눌렀다"로 읽는다. */
const TAB_DRAG_THRESHOLD = 5;

/** 합치기 대상으로 지목된 제목줄에 두르는 테두리 — 어디에 떨어질지 눈으로 알려 준다. */
const DROP_OUTLINE = '2px solid #38BDF8';

/** 합칠 자리를 다시 찾기까지 필요한 이동(px) — 강제 레이아웃을 프레임마다 돌리지 않기 위한 문턱. */
const DROP_HIT_STEP = 4;

function SessionMemoCardImpl({
  memo, tabs, bounds, zIndex, stackedUnder, autoFocus,
  onPatch, onRaise, onRaiseUnder, onDelete, onActivateTab, onMerge, onDetach,
  closedMemos, onRestore, restoreDisabled,
  linkHost, pickRange, onTextMenu, onLinkFollow, onLinkRepick, onLinkRemove,
}: SessionMemoCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | null>(null);
  /** 이름 편집 중이면 그때의 입력값, 아니면 null(= 보기 모드). */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  /** 같은 값의 ref — 확정 핸들러가 매 글자마다 새로 만들어지지 않게 하고, 재진입도 여기서 막는다. */
  const nameDraftRef = useRef<string | null>(null);
  /** F2 준비 — hover 또는 카드 안 초점(마우스를 못 쓰면 hover 가 오지 않는다). */
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);

  // 핸들러가 매 렌더 새로 만들어지지 않도록 최신 값을 ref 로 넘긴다(제스처 중 낡은 값 참조 ❌).
  const memoRef = useRef(memo);
  memoRef.current = memo;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  /** 편집 직전 선택. 반복된 글자는 전후 본문만으로 실제로 지운 위치를 구별할 수 없다. */
  const textEditRef = useRef<{ text: string; hint: TextEditHint } | null>(null);
  const captureTextEdit = useCallback((inputType?: string) => {
    const ta = textRef.current;
    if (!ta) return;
    textEditRef.current = {
      text: ta.value,
      hint: { start: ta.selectionStart, end: ta.selectionEnd, ...(inputType ? { inputType } : {}) },
    };
  }, []);

  /** 끌고 있는 제스처 — null 이면 안 끌고 있다. */
  const gestureRef = useRef<{
    /** `tab` = 탭 하나를 뽑는 중(떼어내기 또는 다른 카드로 옮기기). */
    kind: 'move' | 'resize' | 'tab';
    px: number;
    py: number;
    start: { x: number; y: number; w: number; h: number };
    /** `tab` 일 때 끌고 있는 장. */
    tabId?: string;
    /** 미리보기 윤곽에 적을 이름. */
    tabLabel?: string;
    /** 임계를 넘겨 "끌었다"가 됐나 — 안 넘겼으면 그냥 누른 것(탭 전환). */
    moved?: boolean;
    /** 지금 테두리를 둘러 둔 상대 카드 — 지울 때 필요하다. */
    dropEl?: HTMLElement | null;
    /** body 에 띄운 미리보기 윤곽. */
    ghost?: HTMLElement | null;
    /** 마지막으로 합칠 자리를 찾아본 지점 — 히트테스트를 프레임마다 돌리지 않기 위한 기준. */
    hitX?: number;
    hitY?: number;
  } | null>(null);

  useEffect(() => {
    if (autoFocus) textRef.current?.focus();
  }, [autoFocus]);

  const alpha = memoAlpha(memo);
  // §4 앱 테마 — 반투명 종이가 놓이는 바닥은 고른 테마의 창 바탕이다. 라이트에서 어두운 바닥으로 섞으면
  //   글자색 판정이 거꾸로 나와(밝은 판에 흰 글씨) 아무것도 안 읽힌다.
  const memoBase = useAppThemeTokenHex('window.background');
  const surface = memoSurface(memo.color, alpha, memoBase);
  const collapsed = memo.collapsed === true;
  const title = memoTitle(memo, t('ide.memo.title'));
  const renaming = nameDraft !== null;
  /** 여럿이 합쳐진 카드인가 — 그러면 제목줄이 탭 줄이 된다. */
  const merged = tabs.length > 1;
  // 손이 올라가 있거나 이름을 고치는 중이면 앞으로 — 편집 중에 다른 장이 덮어 오면 글을 잃는다.
  const peeking = hovered || renaming;

  // 탭 줄이 넘치면 **가려진 쪽 끝에 페이드** — 스크롤바를 숨긴 줄이라 "옆에 장이 더 있다"를 말하는 것이 이것뿐이다
  //   (좁은 카드·폰 폭에서 합친 장이 셋만 넘어도 끝 탭이 안 보였다). 세션 탭 줄과 같은 페이드(`.scroll-fade-left/right`)를
  //   쓰고, 표시는 클래스만 바꾼다(스크롤마다 다시 그리지 않는다). 탭 하나하나의 크기도 지켜본다 — 이름을 고치면 줄 폭이 바뀐다.
  const tabRowRef = useRef<HTMLDivElement>(null);
  const tabFadeLeftRef = useRef<HTMLDivElement>(null);
  const tabFadeRightRef = useRef<HTMLDivElement>(null);
  const tabRowShown = merged && !renaming;
  useEffect(() => {
    const row = tabRowRef.current;
    if (!tabRowShown || !row) return;
    const sync = (): void => {
      const overflow = row.scrollWidth - row.clientWidth;
      tabFadeLeftRef.current?.classList.toggle('scroll-fade-shown', row.scrollLeft > 4);
      tabFadeRightRef.current?.classList.toggle('scroll-fade-shown', overflow - row.scrollLeft > 4);
    };
    sync();
    row.addEventListener('scroll', sync, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(sync);
    ro?.observe(row);
    for (const tab of Array.from(row.children)) ro?.observe(tab);
    return () => { row.removeEventListener('scroll', sync); ro?.disconnect(); };
  }, [tabRowShown, tabs.length]);

  useEffect(() => {
    const ta = textRef.current;
    if (!ta) return;
    // React의 beforeinput 합성 이벤트가 아닌 원래 inputType과 편집 전 선택을 함께 받는다.
    const onBeforeInput = (event: Event): void => captureTextEdit((event as InputEvent).inputType);
    ta.addEventListener('beforeinput', onBeforeInput);
    return () => ta.removeEventListener('beforeinput', onBeforeInput);
  }, [collapsed, captureTextEdit]);

  const onTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const m = memoRef.current;
    const text = e.target.value;
    const pending = textEditRef.current;
    textEditRef.current = null;
    // beforeinput 없이 input만 온 경우도 원래 종류(특히 실행 취소·IME)를 잃지 않는다.
    const inputType = (e.nativeEvent as InputEvent | undefined)?.inputType;
    const hint = pending?.text === m.text ? { ...pending.hint, ...(inputType ? { inputType } : {}) } : undefined;
    // 같은 패치에 링크를 싣는다. 판의 일반 본문 패치가 다시 추정하여 옮기지 않게 한다.
    const links = m.links ? shiftMemoLinks(m.links, m.text, text, hint) : undefined;
    onPatch(m.id, { text, ...(links ? { links: [...links] } : {}) }, 'defer', hint);
  }, [onPatch]);

  // ─── ⑫ 링크: 거울 층 · 캐럿 · 링크 상자 ───

  const mirrorRef = useRef<HTMLDivElement>(null);
  const links = memo.links;
  const hasLinkLayer = (links?.length ?? 0) > 0 || pickRange !== null;
  // 링크 잉크는 글자색과 **같은 판정**으로 고른다 — 이 종이의 글자색이 흰 종이의 글자색과 같으면 밝은 판이다.
  const ink = useMemo(() => memoLinkInk(surface.text === pickReadableTextColor(LIGHT_PROBE)), [surface.text]);
  const segments = useMemo(
    () => (hasLinkLayer ? memoLinkSegments(memo.text, links, pickRange) : NO_SEGMENTS),
    [hasLinkLayer, memo.text, links, pickRange],
  );

  /**
   * 거울 층을 입력칸에 맞춘다 — 폭(스크롤 막대를 뺀 `clientWidth`)과 스크롤. 직접 쓰기라 React 를 거치지 않는다.
   * 폭이 어긋나면 줄바꿈 자리가 달라져 밑줄이 엉뚱한 글자 밑에 그어진다.
   */
  const syncMirror = useCallback(() => {
    const ta = textRef.current;
    const inner = mirrorRef.current;
    if (!ta || !inner) return;
    inner.style.width = `${ta.clientWidth}px`;
    inner.style.transform = `translate3d(0, ${-ta.scrollTop}px, 0)`;
  }, []);
  // 렌더마다(본문·링크가 바뀌면 줄이 바뀐다) 먼저 거울을 맞추고, 아래에서 링크 자리를 잰다.
  useLayoutEffect(syncMirror);

  /** 본문 칸에 초점이 있나 — 링크 상자는 글을 고치는 동안에만 뜬다. */
  const [textFocused, setTextFocused] = useState(false);
  /** 본문 칸의 캐럿·선택(onSelect 가 따라 적는다). */
  const [caret, setCaret] = useState<TextRange | null>(null);
  const readCaret = useCallback(() => {
    const ta = textRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    // execCommand가 막혀 직접 값을 바꾸는 글자 메뉴도 마지막 선택으로 추적한다.
    captureTextEdit();
    setCaret((prev) => (prev && prev.start === start && prev.end === end ? prev : { start, end }));
  }, [captureTextEdit]);
  // 접으면 본문 칸이 사라진다 — 사라지는 칸은 blur 를 안 보내므로 여기서 내려 둔다(펴는 순간 상자가 튀지 않게).
  useEffect(() => { if (collapsed) setTextFocused(false); }, [collapsed]);
  /** 끄는 중 — 카드가 `transform` 으로 움직이는 동안 상자는 옛 자리에 남으므로 접어 둔다. */
  const [gesturing, setGesturing] = useState(false);

  const activeLink = linkHost && textFocused && caret && !gesturing && !renaming && !collapsed
    ? (linkHoldingRange(links, caret.start, caret.end) ?? null)
    : null;
  const activeLinkId = activeLink?.id ?? null;
  const activeLinkIdRef = useRef(activeLinkId);
  activeLinkIdRef.current = activeLinkId;

  /** 링크 상자를 띄울 자리 — 여러 줄이면 입력칸 안에 보이는 첫 줄이다. */
  const [anchor, setAnchor] = useState<MemoLinkAnchor | null>(null);
  const measureAnchor = useCallback(() => {
    const id = activeLinkIdRef.current;
    const inner = mirrorRef.current;
    const ta = textRef.current;
    const span = id && inner ? inner.querySelector<HTMLElement>(`[data-memo-link="${CSS.escape(id)}"]`) : null;
    const box = ta?.getBoundingClientRect();
    const next = span && box ? visibleMemoLinkAnchor(span.getClientRects(), box) : null;
    if (!next) {
      setAnchor((prev) => (prev === null ? prev : null));
      return;
    }
    setAnchor((prev) => (prev && prev.left === next.left && prev.top === next.top && prev.bottom === next.bottom ? prev : next));
  }, []);
  // 판의 위치만 바뀐 렌더도 따라간다(예: 분할 칸 이동). 좌표가 같으면 상태를 바꾸지 않는다.
  useLayoutEffect(measureAnchor);
  useEffect(() => {
    const ta = textRef.current;
    if (!hasLinkLayer || !ta || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { syncMirror(); measureAnchor(); });
    ro.observe(ta);
    return () => ro.disconnect();
  }, [hasLinkLayer, collapsed, syncMirror, measureAnchor]);
  useEffect(() => {
    if (!activeLinkId) return;
    window.addEventListener('resize', measureAnchor);
    // textarea 밖의 스크롤 조상도 링크의 화면 좌표를 바꾼다.
    window.addEventListener('scroll', measureAnchor, true);
    return () => {
      window.removeEventListener('resize', measureAnchor);
      window.removeEventListener('scroll', measureAnchor, true);
    };
  }, [activeLinkId, measureAnchor]);

  const onTextScroll = useCallback(() => {
    syncMirror();
    if (activeLinkIdRef.current) measureAnchor();
  }, [syncMirror, measureAnchor]);

  // 상자는 body 포털이다. 키보드 초점이 그 버튼으로 옮겨 가도 링크를 보고 있는 동안이다.
  const onLinkAreaBlur = useCallback((e: React.FocusEvent<HTMLElement>) => {
    const next = e.relatedTarget;
    if (next === textRef.current) return;
    if (next instanceof Element && next.closest('[data-memo-link-bubble]')?.getAttribute('data-memo-link-bubble') === memoRef.current.id) return;
    setTextFocused(false);
  }, []);
  const returnToText = useCallback(() => textRef.current?.focus({ preventScroll: true }), []);
  const onTextKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingKeyEvent(e.nativeEvent)) return;
    const inputType = e.key === 'Backspace' ? 'deleteContentBackward'
      : e.key === 'Delete' ? 'deleteContentForward'
        : (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y') ? 'historyUndo' : undefined;
    captureTextEdit(inputType);
    if (e.key !== 'Tab' || e.shiftKey) return;
    const button = document.querySelector<HTMLButtonElement>(`[data-memo-link-bubble="${CSS.escape(memoRef.current.id)}"] button:not(:disabled)`);
    if (!button) return;
    e.preventDefault();
    button.focus();
  }, [captureTextEdit]);

  /**
   * Ctrl/Cmd+클릭 = 따라가기(편집기의 손버릇). 판정은 `ctrlKey || metaKey` — mac 의 Control+클릭은
   * 우클릭이라 여기 오지 않는다. 끌어서 고른 것은 따라가기가 아니다.
   */
  const onTextClick = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const ta = e.currentTarget;
    if (ta.selectionStart !== ta.selectionEnd) return;
    const m = memoRef.current;
    const link = linkAtRange(m.links, ta.selectionStart, ta.selectionEnd);
    if (!link) return;
    e.preventDefault();
    void onLinkFollow(m.id, link.id);
  }, [onLinkFollow]);

  /**
   * 본문 칸 우클릭 — 메뉴는 판이 그린다(내 입력·다른 세션·파일 목록을 아는 것이 판이다). 선택은 **지금**
   * 떠 둔다(메뉴를 누를 때는 초점이 옮겨가 있을 수 있다). 대화 본문의 메뉴가 같이 뜨지 않게 여기서 끊는다.
   */
  const onTextContextMenu = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    captureTextEdit();
    onTextMenu(memoRef.current.id, { x: e.clientX, y: e.clientY, el, sel: readFieldSelection(el) });
  }, [onTextMenu, captureTextEdit]);

  // ─── 이름 바꾸기: 여는 길은 셋, 도착지는 하나 ───

  /** 편집 시작값은 보이는 제목이다(첫 줄 자동 제목 포함). 고치지 않고 확인하면 아무것도 안 한다 — 안 그러면 F2·Enter 한 번에 자동 제목이 고정된다. */
  const startRename = useCallback(() => {
    const m = memoRef.current;
    onRaise(m.id);
    const seed = memoTitle(m, t('ide.memo.title'));
    nameDraftRef.current = seed;
    setNameDraft(seed);
  }, [onRaise, t]);

  const cancelRename = useCallback(() => {
    nameDraftRef.current = null;
    setNameDraft(null);
  }, []);

  /**
   * 확정. Enter 와 초점 이탈 **둘 다** 이 문을 지나므로 재진입을 막는다 — 그러지 않으면 Enter 로
   * 닫은 직후 도착한 blur 가 같은 값을 한 번 더 올려 저장 왕복이 두 번 나간다.
   */
  const commitRename = useCallback(() => {
    const draft = nameDraftRef.current;
    if (draft === null) return;
    nameDraftRef.current = null;
    setNameDraft(null);
    const m = memoRef.current;
    const next = normalizeMemoName(draft);
    // 자동 제목을 그대로 확인한 것 = 바꾼 것이 없다. 여기서 저장하면 본문을 고쳐도 제목이 따라오지
    //   않는 상태로 굳는데, 사용자는 아무것도 바꾸지 않았다고 믿는다.
    if (!hasMemoName(m) && next === memoTitle(m, t('ide.memo.title'))) return;
    onPatch(m.id, { name: next }, 'now');
  }, [onPatch, t]);

  // 편집을 열면 그 칸으로 초점을 옮기고 전체를 골라 둔다(바로 갈아 칠 수 있게).
  useEffect(() => {
    if (!renaming) return;
    const el = nameRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [renaming]);

  /**
   * F2 — hover·초점일 때만 리스너를 단다(24장이 window 리스너를 들지 않게). 다른 임자: 타이틀바 = 에이전트 이름(`AgentIDEOverlay`, capture), 그 밖 = 세션 탭(`IDETabBar`, bubble) — 포인터가 있는 곳이 임자다.
   * capture + `stopPropagation` 으로 탭 리네임을 막고, `defaultPrevented` 면 비켜선다.
   */
  useEffect(() => {
    if (!(hovered || focusWithin) || renaming) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'F2' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      startRename();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [hovered, focusWithin, renaming, startRename]);

  /** 이름 위 더블클릭 — 제목줄 더블클릭(접기)과 같은 자리라 위로 올려 보내지 않는다. */
  const onTitleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startRename();
  }, [startRename]);

  /** 이름 위 우클릭 — 본문의 우클릭 메뉴(새 메모)가 뜨지 않게 여기서 끊는다. */
  const onTitleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startRename();
  }, [startRename]);

  const onNameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // 한글·일본어 조합 중의 Enter 는 "글자를 확정"이지 "이름을 확정"이 아니다.
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // IDE 의 다른 Esc 동작(검색 닫기 등)까지 함께 터지지 않게 여기서 끊는다.
      e.stopPropagation();
      cancelRename();
    }
  }, [commitRename, cancelRename]);

  // ─── 제스처: 손을 떼기 전까지 DOM 만 만진다 ───

  /** 커서 밑 다른 카드 제목줄 — 합칠 자리의 유일한 창구. ⚠ 잠깐 자신을 `pointer-events: none` 으로(안 그러면 늘 자신이 잡힌다). 포인터 캡처라 드래그는 안 끊긴다. */
  const dropTargetAt = useCallback((clientX: number, clientY: number): { id: string; el: HTMLElement } | null => {
    const self = rootRef.current;
    const prev = self?.style.pointerEvents ?? '';
    if (self) self.style.pointerEvents = 'none';
    const hit = document.elementFromPoint(clientX, clientY);
    if (self) self.style.pointerEvents = prev;
    const header = hit instanceof Element ? hit.closest('[data-memo-drop-id]') : null;
    if (!(header instanceof HTMLElement)) return null;
    const id = header.dataset['memoDropId'] ?? '';
    const card = header.closest('[data-session-memo]');
    if (!id || !(card instanceof HTMLElement) || card === self) return null;
    return { id, el: card };
  }, []);

  /** 합칠 자리를 눈에 보이게 — 이전 표시는 지우고 새 표시를 두른다(React 무관, 인라인 style). */
  const paintDrop = useCallback((el: HTMLElement | null) => {
    const g = gestureRef.current;
    if (g?.dropEl && g.dropEl !== el) g.dropEl.style.outline = '';
    if (el) el.style.outline = DROP_OUTLINE;
    if (g) g.dropEl = el;
  }, []);

  /** 합칠 자리는 4px 넘게 움직였을 때만 다시 찾는다 — `elementFromPoint`·style 쓰기는 강제 레이아웃이라 매 프레임이면 커서가 카드를 앞지른다. */
  const refreshDrop = useCallback((clientX: number, clientY: number): HTMLElement | null => {
    const g = gestureRef.current;
    if (!g) return null;
    const near = g.hitX !== undefined && g.hitY !== undefined
      && Math.abs(clientX - g.hitX) < DROP_HIT_STEP && Math.abs(clientY - g.hitY) < DROP_HIT_STEP;
    if (near) return g.dropEl ?? null;
    g.hitX = clientX;
    g.hitY = clientY;
    const el = dropTargetAt(clientX, clientY)?.el ?? null;
    paintDrop(el);
    return el;
  }, [dropTargetAt, paintDrop]);

  /** 탭을 뽑아 끌 때 커서를 따라다니는 윤곽 — 어디에 놓이는지 미리 보여 준다. */
  const showGhost = useCallback((x: number, y: number, label: string) => {
    const g = gestureRef.current;
    if (!g) return;
    if (!g.ghost) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:fixed', 'pointer-events:none', 'z-index:2147483000',
        'border:2px dashed #38BDF8', 'border-radius:8px',
        'background:rgba(56,189,248,0.10)', 'color:#E0F2FE',
        'font-size:12px', 'padding:4px 8px', 'overflow:hidden',
        'white-space:nowrap', 'text-overflow:ellipsis',
      ].join(';');
      el.textContent = label;
      document.body.appendChild(el);
      g.ghost = el;
    }
    const m = memoRef.current;
    g.ghost.style.width = `${m.w}px`;
    g.ghost.style.height = `${m.collapsed ? SESSION_MEMO.HEADER_H : m.h}px`;
    g.ghost.style.left = `${x}px`;
    g.ghost.style.top = `${y}px`;
    g.ghost.style.display = '';
  }, []);

  const hideGhost = useCallback((remove: boolean) => {
    const g = gestureRef.current;
    if (!g?.ghost) return;
    if (remove) { g.ghost.remove(); g.ghost = null; }
    else g.ghost.style.display = 'none';
  }, []);

  /** 판(컨테이너)의 화면 좌표 원점 — 카드는 판 안에 `left/top = memo.x/y` 로 놓여 있다. */
  const boardOrigin = useCallback((): { left: number; top: number } | null => {
    const el = rootRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const m = memoRef.current;
    return { left: r.left - m.x, top: r.top - m.y };
  }, []);

  const beginGesture = useCallback((e: React.PointerEvent<HTMLElement>, kind: 'move' | 'resize') => {
    if (e.button !== 0) return;
    // 이름 칸을 누른 것은 "끌기"가 아니라 "커서 놓기"다 — preventDefault 로 막으면 캐럿이 안 선다.
    if (kind === 'move' && (e.target as HTMLElement).closest('button, input')) return;
    e.preventDefault();
    e.stopPropagation();
    const m = memoRef.current;
    onRaise(m.id);
    gestureRef.current = { kind, px: e.clientX, py: e.clientY, start: { x: m.x, y: m.y, w: m.w, h: m.h } };
    setGesturing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    const el = rootRef.current;
    // 합성기에 "이 축이 곧 움직인다"를 미리 알린다 — 첫 프레임의 승격 비용을 없앤다.
    if (el) el.style.willChange = kind === 'move' ? 'transform' : 'width, height';
  }, [onRaise]);

  /** 탭 하나를 누름 — 눌렀는지 끌었는지는 손을 떼 봐야 안다(`TAB_DRAG_THRESHOLD`). */
  const beginTabGesture = useCallback((e: React.PointerEvent<HTMLElement>, tabId: string, tabLabel: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const m = memoRef.current;
    onRaise(m.id);
    gestureRef.current = {
      kind: 'tab', px: e.clientX, py: e.clientY,
      start: { x: m.x, y: m.y, w: m.w, h: m.h },
      tabId, tabLabel, moved: false,
    };
    setGesturing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [onRaise]);

  const moveGesture = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    const el = rootRef.current;
    if (!g || !el) return;
    const m = memoRef.current;
    const dx = e.clientX - g.px;
    const dy = e.clientY - g.py;
    if (g.kind === 'move') {
      const next = moveMemo(m, g.start, dx, dy, boundsRef.current);
      // React 가 그린 좌표는 그대로 두고 그 위에서만 민다 — 커밋 때 이 한 줄만 지우면 원위치다.
      el.style.transform = `translate3d(${next.x - m.x}px, ${next.y - m.y}px, 0)`;
      // 다른 카드의 제목줄 위면 "여기에 합친다"를 두른다.
      refreshDrop(e.clientX, e.clientY);
    } else if (g.kind === 'tab') {
      if (!g.moved && Math.abs(dx) < TAB_DRAG_THRESHOLD && Math.abs(dy) < TAB_DRAG_THRESHOLD) return;
      g.moved = true;
      const hit = refreshDrop(e.clientX, e.clientY);
      // 합칠 자리를 가리키고 있으면 테두리가 말해 주므로 윤곽은 접는다(둘이 동시에 뜨면 시끄럽다).
      if (hit) hideGhost(false);
      else showGhost(e.clientX - 20, e.clientY - SESSION_MEMO.HEADER_H / 2, g.tabLabel ?? '');
    } else {
      const next = resizeMemo(m, g.start, dx, dy, boundsRef.current);
      el.style.width = `${next.w}px`;
      el.style.height = `${next.h}px`;
    }
  }, [refreshDrop, showGhost, hideGhost]);

  const endGesture = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    const el = rootRef.current;
    if (!g) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const m = memoRef.current;
    const dx = e.clientX - g.px;
    const dy = e.clientY - g.py;
    const drop = g.kind === 'resize' ? null : dropTargetAt(e.clientX, e.clientY);
    paintDrop(null);
    hideGhost(true);
    gestureRef.current = null;
    setGesturing(false);
    if (el) el.style.willChange = '';

    if (g.kind === 'move') {
      // transform 은 React 가 모르는 값이라 우리가 지운다(안 지우면 커밋된 좌표에 델타가 또 얹힌다).
      if (el) el.style.transform = '';
      // 다른 카드의 제목줄 위에서 놓았으면 **이동이 아니라 합침**이다 — 자리는 받는 쪽이 정하므로
      //   좌표 커밋을 함께 보내지 않는다(두 번 저장하면 합친 카드가 잠깐 엉뚱한 자리로 튄다).
      if (drop) { onMerge(m.id, drop.id, true); return; }
      const next = moveMemo(m, g.start, dx, dy, boundsRef.current);
      onPatch(m.id, { x: next.x, y: next.y }, 'now');
      return;
    }
    if (g.kind === 'tab') {
      const tabId = g.tabId ?? m.id;
      if (!g.moved) { onActivateTab(tabId); return; }   // 끈 것이 아니라 누른 것.
      if (drop) { onMerge(tabId, drop.id, false); return; }
      const origin = boardOrigin();
      if (!origin) return;
      onDetach(tabId, {
        x: e.clientX - origin.left - 20,
        y: e.clientY - origin.top - SESSION_MEMO.HEADER_H / 2,
      });
      return;
    }
    // width·height 는 React 가 소유한다 — 아래 커밋 렌더가 같은 값으로 덮어쓴다.
    const next = resizeMemo(m, g.start, dx, dy, boundsRef.current);
    onPatch(m.id, { w: next.w, h: next.h }, 'now');
  }, [onPatch, onMerge, onDetach, onActivateTab, dropTargetAt, paintDrop, hideGhost, boardOrigin]);

  // 카드가 사라지는 순간에도 몸 밖에 만들어 둔 것은 우리가 치운다(고아 노드·남은 테두리 ❌).
  useEffect(() => () => {
    const g = gestureRef.current;
    if (g?.dropEl) g.dropEl.style.outline = '';
    if (g?.ghost) g.ghost.remove();
    gestureRef.current = null;
  }, []);

  const onHeaderDown = useCallback((e: React.PointerEvent<HTMLElement>) => beginGesture(e, 'move'), [beginGesture]);
  const onHandleDown = useCallback((e: React.PointerEvent<HTMLElement>) => beginGesture(e, 'resize'), [beginGesture]);

  // ─── 버튼 ───

  const toggleCollapsed = useCallback(() => {
    const m = memoRef.current;
    onPatch(m.id, { collapsed: m.collapsed !== true }, 'now');
  }, [onPatch]);

  /** 색 칩 토글 — 팝오버가 pointerdown 으로 먼저 닫힌 뒤 클릭이 와 다시 열린다. 그래서 방금 닫혔는지를 시각으로 본다(트리거 ref 를 넘길 길이 없다). */
  const closedAtRef = useRef(0);
  const closePicker = useCallback(() => {
    closedAtRef.current = Date.now();
    setPickerAnchor(null);
  }, []);
  const openPicker = useCallback(() => {
    if (Date.now() - closedAtRef.current < PICKER_REOPEN_GUARD_MS) return;
    const r = colorBtnRef.current?.getBoundingClientRect();
    setPickerAnchor(r ? { x: r.right, y: r.top } : { x: 0, y: 0 });
  }, []);

  return (
    // 위치·크기·색은 사용자 데이터라 style 로 간다. `--memo-line` 은 판 밝기에 따라 뒤집히는 선 색(hover 배경).
    // 포커스가 ring 이 아니라 outline 인 이유: ring(box-shadow)은 인라인 `boxShadow` 에 덮인다.
    <div
      ref={rootRef}
      className="pointer-events-auto absolute flex flex-col overflow-hidden rounded-lg focus-within:[outline:1px_solid_#38BDF8AA] focus-within:[outline-offset:-1px]"
      style={{
        left: memo.x,
        top: memo.y,
        width: memo.w,
        height: collapsed ? SESSION_MEMO.HEADER_H : memo.h,
        background: surface.background,
        color: surface.text,
        border: `1px solid ${surface.border}`,
        // 손이 올라가면 그림자를 더 깊게 — 지금 이 장이 **들려 있다**는 신호다(z 만 바뀌면 겹친
        //   더미에서 무엇이 앞으로 왔는지 눈으로 알기 어렵다).
        boxShadow: peeking
          ? `inset 0 1px 0 ${surface.glassEdge}, 0 18px 42px -12px rgba(0,0,0,0.8), 0 4px 12px -4px rgba(0,0,0,0.6)`
          : `inset 0 1px 0 ${surface.glassEdge}, 0 10px 28px -10px rgba(0,0,0,0.65), 0 2px 8px -4px rgba(0,0,0,0.5)`,
        ...(surface.blur ? { backdropFilter: 'blur(14px) saturate(140%)', WebkitBackdropFilter: 'blur(14px) saturate(140%)' } : {}),
        ['--memo-line' as string]: surface.hairline,
        // 손이 올라간 장은 **잠시** 맨 앞으로 온다 — 겹쳐 둔 순서(배열)는 그대로다. 밑에 깔린 장의
        //   삐져나온 조각에 손만 올려도 통째로 읽히므로, 읽자고 순서를 영구히 바꿀 필요가 없다.
        zIndex: peeking ? SESSION_MEMO.PEEK_Z : zIndex,
      }}
      onPointerDown={() => onRaise(memo.id)}
      // F2 를 이 카드에게 주기 위한 두 조건(hover · 카드 안 초점). onFocus/onBlur 는 React 에서
      //   버블링하므로 본문·버튼 어디에 초점이 가도 여기서 한 번에 받는다.
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={() => setFocusWithin(false)}
      data-session-memo={memo.id}
    >
      <div
        className="flex flex-shrink-0 cursor-grab touch-none select-none items-center gap-1 pl-2 pr-1 active:cursor-grabbing"
        style={{
          height: SESSION_MEMO.HEADER_H,
          background: surface.headerTint,
          ...(collapsed ? {} : { borderBottom: `1px solid ${surface.hairline}` }),
        }}
        onPointerDown={onHeaderDown}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onLostPointerCapture={endGesture}
        onDoubleClick={toggleCollapsed}
        // 합치는 법은 여기서 알린다 — 제목·탭에는 각자 제 툴팁이 있어 이 문구는 빈 자리와
        //   집게 아이콘 위에서만 뜬다(즉 "끌 수 있는 곳" 위에서만).
        title={t('ide.memo.mergeHint')}
        // 다른 카드가 "여기에 합칠 수 있다"를 찾는 표식 — 값은 이 카드의 활성 장 id 다.
        data-memo-drop-id={memo.id}
      >
        <svg className="h-3.5 w-3.5 flex-shrink-0 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 17v5" />
          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
        </svg>
        {!renaming && merged ? (
          /* 탭 줄 — 합쳐진 카드의 제목줄은 탭이 된다. 넘치면 가로로 스크롤한다(카드가 좁으므로
             줄바꿈 ❌ — 제목줄 높이가 늘면 본문이 밀린다). 탭을 끌면 뽑혀 나온다. */
          <div className="relative flex min-w-0 flex-1 items-stretch">
            <div ref={tabRowRef} className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {tabs.map((tab) => {
                const on = tab.id === memo.id;
                const label = memoTitle(tab, t('ide.memo.title'));
                return (
                  <button
                    key={tab.id}
                    type="button"
                    title={`${label}\n${t('ide.memo.tabHint')}`}
                    aria-current={on ? 'true' : undefined}
                    // 탭이 캡처를 쥐므로 제스처는 여기서 끝난다 — 제목줄까지 올려 보내면 같은
                    //   제스처가 두 번 돈다(무해하지만 헛일이고, 어느 쪽이 주인인지도 흐려진다).
                    onPointerDown={(e) => beginTabGesture(e, tab.id, label)}
                    onPointerMove={(e) => { e.stopPropagation(); moveGesture(e); }}
                    onPointerUp={(e) => { e.stopPropagation(); endGesture(e); }}
                    onPointerCancel={(e) => { e.stopPropagation(); endGesture(e); }}
                    onLostPointerCapture={(e) => { e.stopPropagation(); endGesture(e); }}
                    onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); if (on) startRename(); }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (on) startRename(); }}
                    className={`flex min-w-0 max-w-[9rem] flex-shrink-0 items-center gap-1 rounded px-1.5 text-[12px] leading-none transition-opacity ${on ? 'opacity-100' : 'opacity-55 hover:opacity-85'}`}
                    style={on ? { background: surface.hairline } : undefined}
                  >
                    {/* 탭마다 자기 색 — 합쳐도 색은 장마다 따로다(그것이 "합쳤다"와 "뭉갰다"의 차이). */}
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: tab.color, opacity: memoAlpha(tab) }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 truncate">{label}</span>
                  </button>
                );
              })}
            </div>
            {/* 좌/우 끝 페이드 — 가려진 방향에만 뜬다(위 효과가 `visible` 을 켜고 끈다). 누름은 통과시킨다. */}
            <div ref={tabFadeLeftRef} className="scroll-fade-left" />
            <div ref={tabFadeRightRef} className="scroll-fade-right" />
          </div>
        ) : renaming ? (
          // 제자리 편집 — 제목이 서 있던 자리를 그대로 쓴다(칸이 따로 열리면 눈이 한 번 더 움직인다).
          //   `maxLength` 는 저장 상한과 같은 값이라, 화면에서 못 치는 글자가 서버에서 잘리는 일이 없다.
          <input
            ref={nameRef}
            type="text"
            value={nameDraft}
            maxLength={SESSION_MEMO.NAME_MAX}
            spellCheck={false}
            aria-label={t('ide.memo.rename')}
            placeholder={t('ide.memo.namePlaceholder')}
            onChange={(e) => { nameDraftRef.current = e.target.value; setNameDraft(e.target.value); }}
            onKeyDown={onNameKeyDown}
            onBlur={commitRename}
            // 편집 중엔 제목줄 손버릇(끌기·더블클릭)을 끊는다. 우클릭은 막지 않는다 — 글자 칸 우클릭은 전역 텍스트 메뉴가 capture 로 가져간다(`GlobalTextFieldContextMenu`).
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            // `select-text` 는 장식이 아니다 — 제목줄이 끌기 손잡이라 `select-none` 이 걸려 있고,
            //   그 값은 자식 input 까지 내려와 **글자를 고를 수 없는 입력칸**이 된다(전체 선택도 안 보인다).
            className="min-w-0 flex-1 cursor-text select-text rounded bg-transparent px-1 text-[12px] font-medium outline-none"
            style={{ color: surface.text, boxShadow: `inset 0 0 0 1px ${surface.hairline}` }}
          />
        ) : (
          // 폭이 모자라면 `…` 로 줄고(truncate), 잘린 전문은 툴팁으로 남는다.
          //   커서는 제목줄의 `cursor-grab` 을 그대로 물려받는다 — 여기는 여전히 끌기 손잡이라
          //   `cursor-text` 로 덮으면 거짓말이 된다. 고칠 수 있다는 신호는 hover 점선 밑줄이 맡는다.
          <span
            className="min-w-0 flex-1 truncate text-[12px] font-medium opacity-90 hover:underline hover:decoration-dotted hover:underline-offset-2"
            title={`${title}\n${t('ide.memo.renameHint')}`}
            onDoubleClick={onTitleDoubleClick}
            onContextMenu={onTitleContextMenu}
          >
            {title}
          </span>
        )}
        {/* 겹침 배지 — **덮은 쪽**이 단다. 완전히 가려진 장은 hover 도 클릭도 못 받으므로 그쪽에
            손잡이를 달면 영영 못 누른다. 누를 때마다 바로 밑장이 올라와 한 겹씩 벗겨 볼 수 있다. */}
        {stackedUnder > 0 && (
          <button
            type="button"
            title={t('ide.memo.stacked', { n: stackedUnder })}
            aria-label={t('ide.memo.stacked', { n: stackedUnder })}
            // ⚠ 누르는 순간 **이 장의 피크를 내린다**. 안 내리면 손이 아직 이 장 위에 있어
            //   `PEEK_Z` 로 맨 앞에 서고, 밑장을 올려도 그대로 가려 "눌러도 아무 일이 없는" 손잡이가
            //   된다. 손이 나갔다 다시 들어오면(mouseenter) 피크는 저절로 돌아온다.
            onClick={() => { setHovered(false); onRaiseUnder(memo.id); }}
            className="flex h-5 flex-shrink-0 items-center gap-0.5 rounded px-1 text-[12px] leading-none transition-colors hover:bg-[var(--memo-line)]"
            style={{ boxShadow: `inset 0 0 0 1px ${surface.hairline}` }}
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="8" y="8" width="12" height="12" rx="2" />
              <path d="M4 16V6a2 2 0 0 1 2-2h10" />
            </svg>
            <span className="tabular-nums">{stackedUnder}</span>
          </button>
        )}
        {onRestore && <SessionMemoHistory closedMemos={closedMemos ?? []} onRestore={onRestore} restoreDisabled={restoreDisabled} />}
        {/* 색 칩 — 지금 색과 지금 불투명도를 그대로 보여 준다(체커보드가 비치는 만큼이 뚫린 정도). */}
        <button
          ref={colorBtnRef}
          type="button"
          title={t('ide.memo.color')}
          aria-label={t('ide.memo.color')}
          aria-haspopup="dialog"
          aria-expanded={pickerAnchor !== null}
          onClick={openPicker}
          className="relative mr-0.5 h-4 w-4 flex-shrink-0 overflow-hidden rounded-full transition-transform hover:scale-110"
          style={{ background: CHECKERBOARD, boxShadow: `inset 0 0 0 1px ${surface.hairline}` }}
        >
          <span className="absolute inset-0" style={{ backgroundColor: memo.color, opacity: alpha }} />
        </button>
        <button
          type="button"
          title={collapsed ? t('ide.memo.expand') : t('ide.memo.collapse')}
          aria-label={collapsed ? t('ide.memo.expand') : t('ide.memo.collapse')}
          onClick={toggleCollapsed}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--memo-line)]"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {collapsed ? <path d="m6 9 6 6 6-6" /> : <path d="m18 15-6-6-6 6" />}
          </svg>
        </button>
        <button
          type="button"
          title={t('ide.memo.close')}
          aria-label={t('ide.memo.close')}
          onClick={() => onDelete(memo.id)}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-rose-500/30"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {!collapsed && (
        <>
          {/* ⑫ 본문 칸은 거울 층 위에 겹쳐 선다 — 거울이 링크 글자 밑을 칠하고, 글자와 캐럿은 위의 칸이 그린다. */}
          <div className="relative min-h-0 flex-1">
            {hasLinkLayer && (
              <MemoLinkMirror ref={mirrorRef} segments={segments} ink={ink} activeLinkId={activeLinkId} />
            )}
            <textarea
              ref={textRef}
              value={memo.text}
              aria-label={t('ide.memo.title')}
              maxLength={SESSION_MEMO.TEXT_MAX}
              spellCheck={false}
              placeholder={t('ide.memo.placeholder')}
              // ⑫ 이 칸은 자기 우클릭 메뉴를 갖는다(글자 항목 + 링크) — 전역 글자 메뉴가 가로채지 않게 알린다.
              data-text-menu="own"
              onChange={onTextChange}
              onCut={() => captureTextEdit('deleteByCut')}
              onPaste={() => captureTextEdit('insertFromPaste')}
              onFocus={() => { setTextFocused(true); readCaret(); }}
              onBlur={(e) => { onLinkAreaBlur(e); onPatch(memo.id, {}, 'now'); }}
              onKeyDown={onTextKeyDown}
              onSelect={readCaret}
              onScroll={onTextScroll}
              onClick={onTextClick}
              onContextMenu={onTextContextMenu}
              className="absolute inset-0 h-full w-full resize-none bg-transparent px-2.5 py-2 text-[13px] leading-relaxed outline-none placeholder:opacity-40"
            />
          </div>
          <div
            // 마우스 전용 손잡이 — 키보드로는 닿을 수 없으므로 보조기술에는 감춘다.
            aria-hidden="true"
            title={t('ide.memo.resize')}
            onPointerDown={onHandleDown}
            onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onLostPointerCapture={endGesture}
            className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none"
          >
            <svg className="h-4 w-4 opacity-40" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M14 6 6 14" />
              <path d="M14 11l-3 3" />
            </svg>
          </div>
        </>
      )}

      {/* ⑫ 링크 상자 — 캐럿이 링크 안에 있을 때만. 스스로 body 로 포털한다(색 선택기와 같은 이유). */}
      {activeLink && anchor && linkHost && (
        <MemoLinkBubble
          key={activeLink.id}
          memoId={memo.id}
          link={activeLink}
          anchor={anchor}
          host={linkHost}
          onFollow={() => onLinkFollow(memo.id, activeLink.id)}
          onRepick={(at) => onLinkRepick(memo.id, activeLink.id, at)}
          onRemove={() => onLinkRemove(memo.id, activeLink.id)}
          onBlur={onLinkAreaBlur}
          onReturnToText={returnToText}
        />
      )}

      {/* 색 선택기 — 카드의 overflow-hidden·transform 에 갇히지 않게 body 로 포털한다. */}
      {pickerAnchor && createPortal(
        <CommentBoxColorPopover
          value={memo.color}
          alpha={alpha}
          presets={SESSION_MEMO_PALETTE}
          anchor={pickerAnchor}
          onLive={(hex, a) => onPatch(memo.id, { color: hex, alpha: a }, 'defer')}
          onCommit={(hex, a) => onPatch(memo.id, { color: hex, alpha: a }, 'now')}
          onClose={closePicker}
        />,
        document.body,
      )}
    </div>
  );
}

/** 층이 판 전체를 낙관 갱신하므로 이 `memo()` 가 없으면 글자 하나에 24장이 리렌더된다(핸들러가 id 를 인자로 받는 이유). */
export const SessionMemoCard = reactMemo(SessionMemoCardImpl);
