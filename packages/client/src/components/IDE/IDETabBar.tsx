import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { collectCmdPaneIds, cmdPaneTermId } from '@vibisual/shared';
import type { SubAgent, SubAgentHistoryItem } from '@vibisual/shared';
import { useGraphStore, selectIDEOverlay } from '../../stores/graphStore.js';
import { useIDEPaneValue, useIDEPaneActions } from './idePane.js';
import { TabContextMenu } from '../Layout/TabContextMenu.js';
import { HoverTooltip } from '../Layout/HoverTooltip.js';
import { useBackdropDismiss } from '../../hooks/usePopupDismiss.js';
import { useTabPushAnimation } from '../../hooks/useTabPushAnimation.js';
import { applyLocalOrder, resolveTabReorder, sameMembers, sameOrder } from '../../hooks/tabPushGeom.js';
import { SESSION_STATUS_DOT, sessionRunStateOf, serializeBusySubIds, parseBusySubIds } from '../../utils/sessionStatus.js';
import { serializeRunningLoops, parseRunningLoops } from './sessionLoopIndicator.js';
// §5.5 #17-34 — 탭을 본문으로 끌면 화면이 나뉜다. 탭바는 짐표만 실어 주고 판정·배치는 분할 쪽이 한다.
import { SESSION_DRAG_MIME, encodeSessionDrag, sessionIdMime, sessionOwnerMime } from './splitDrop.js';
import { cellSessionIds } from './splitLayout.js';
import { useIDESlotKey } from './ideSlot.js';
import { useSelectSessionInSplit } from './useSplitDrop.js';
import { useIsNarrowViewport } from '../../hooks/useIsMobile.js';
import {
  findHiddenRunningTabs, sameHiddenRunningTabs, noHiddenRunningTabs,
  type HiddenRunningTabs, type TabBox,
} from './hiddenRunningTabs.js';

interface IDETabBarProps {
  subAgents: SubAgent[];
  isCustom: boolean;
  onNewSession: () => void;
}

// 도트 색표는 `utils/sessionStatus` 한 곳에 산다 — 종전에는 같은 표가 여기·사이드바·패널 세 벌로
// 복사돼 있었고 확인(ack) 반영 여부까지 갈려, 같은 세션이 화면마다 다른 색으로 보였다.

/**
 * §5.5 #17-9 ④(b) v5.03 — 가려진 실행 알림 한 쪽을 갱신.
 * 스크롤·리사이즈마다 도는 자리라 React 상태가 아니라 DOM 만 직접 만진다(페이드·썸과 같은 경로).
 */
function applyHiddenIndicator(
  btn: HTMLElement | null,
  countEl: HTMLElement | null,
  count: number,
  label: string,
): void {
  if (!btn) return;
  btn.style.display = count > 0 ? 'flex' : 'none';
  if (count === 0) return;
  if (countEl) countEl.textContent = String(count);
  btn.setAttribute('title', label);
  btn.setAttribute('aria-label', label);
}

export const IDETabBar = memo(function IDETabBar({
  subAgents,
  isCustom,
  onNewSession,
}: IDETabBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  const agentId = useIDEPaneValue((o) => o.agentId);
  const { setSession } = useIDEPaneActions();
  const tabPins = useGraphStore((s) => s.tabPins);
  const acknowledgedSubAgents = useGraphStore((s) => s.acknowledgedSubAgents);
  // §5.5 #17-27 ⑪ (h) ⑤ — 추종 켜짐은 탭에 표시하지 않는다(토글과 추종 띠가 말한다).
  const defaultSubAgents = useGraphStore((s) => s.defaultSubAgents);
  const defaultSubId = agentId ? defaultSubAgents[agentId] ?? null : null;
  const subAgentLabels = useGraphStore((s) => s.subAgentLabels);
  const setSubAgentLabel = useGraphStore((s) => s.setSubAgentLabel);

  // §5.5 #17-11 ⑩ v5.02 — 지금 반복 루프가 도는 탭. 활동바는 열어 둔 탭 하나만 비추므로
  //   탭 자신이 "나는 지금 반복 중"이라고 말한다(점등 근거는 활동바와 같은 `enabled`).
  //   `sessionLoops` 는 스냅샷마다 새 객체라 그대로 구독하면 탭바가 매번 다시 그려진다 —
  //   켜진 루프만 문자열로 뽑아(순수 모듈) 값이 바뀔 때만 리렌더한다.
  const runningLoopKey = useGraphStore((s) => serializeRunningLoops(s.sessionLoops));
  const runningLoops = useMemo(() => parseRunningLoops(runningLoopKey), [runningLoopKey]);
  // 백단 서브에이전트를 가진 탭 — 그 탭의 status 가 idle 이어도 도트는 켜져 있어야 한다.
  //   루프와 같은 수법으로 문자열 하나만 구독해 켜짐이 바뀔 때만 다시 그린다.
  const busySubKey = useGraphStore((s) => serializeBusySubIds(agentId ? s.runningSubagentTasks[agentId] : undefined));
  const busySubIds = useMemo(() => parseBusySubIds(busySubKey), [busySubKey]);
  // §5.5 #17-34 — 지금 분할 칸에 떠 있는 세션들. Set 을 그대로 뽑으면 매 스냅샷마다 새 객체라
  //   선택자가 늘 달라진다 — 도트·루프와 같은 수법으로 문자열 하나만 구독한다.
  const splitSlotKey = useIDESlotKey();
  const isNarrowViewport = useIsNarrowViewport();
  const splitCellKey = useGraphStore((s) => {
    const layout = s.ideSplits[splitSlotKey]?.layout;
    return layout ? [...cellSessionIds(layout)].sort().join('|') : '';
  });
  // §5.5 #17-34 — 탭 클릭은 분할을 아는 창구를 지난다(이미 떠 있는 칸이면 그 칸으로 초점만 옮긴다).
  const selectSessionInSplit = useSelectSessionInSplit(splitSlotKey);
  const splitCellSessions = useMemo(
    () => new Set(splitCellKey ? splitCellKey.split('|') : []),
    [splitCellKey],
  );

  // 탭 이름 인라인 편집 — 편집 중인 탭 id와 입력값.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // 표시용 라벨 — 사용자 지정(subAgentLabels) 우선, 없으면 서버 기본 라벨.
  const displayLabel = useCallback(
    (sub: SubAgent): string => subAgentLabels[sub.id] ?? sub.label,
    [subAgentLabels],
  );

  const startRename = useCallback((subId: string) => {
    const sub = subAgents.find((s) => s.id === subId);
    setEditValue(subAgentLabels[subId] ?? sub?.label ?? '');
    setEditingId(subId);
  }, [subAgents, subAgentLabels]);

  const commitRename = useCallback((subId: string) => {
    setSubAgentLabel(subId, editValue);
    setEditingId(null);
    setEditValue('');
  }, [editValue, setSubAgentLabel]);

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditValue('');
  }, []);

  // F2 단축키 — 활성 탭의 인라인 이름 편집을 시작(VS Code 동일). 이미 편집 중이거나 활성 탭이
  // 없으면 무시. 임베디드 터미널이 포커스를 쥔 상태(xterm textarea)에서도 동작해야 하므로
  // input/textarea 포커스를 가드하지 않는다 — 대신 editingId 로 리네임 입력 자기 자신만 제외.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'F2') return;
      if (editingId) return;
      if (!activeSessionId) return;
      if (!subAgents.some((s) => s.id === activeSessionId)) return;
      e.preventDefault();
      startRename(activeSessionId);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingId, activeSessionId, subAgents, startRename]);

  // 드래그 재정렬 — 끌고 있는 탭 id + 커밋 왕복 동안 화면을 붙들어 두는 로컬 순서.
  // §5.4 #14 밀어내기: 손이 지나가는 즉시 옆 탭이 비켜서야 하므로(드롭까지 기다린 뒤 서버 왕복 ❌)
  //   순서는 여기서 먼저 바뀌고, 손을 뗄 때 그 순서를 그대로 서버에 커밋한다.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);

  // 화면에 그릴 순서 = 서버 목록 + (있으면) 로컬 순서 덧씌움.
  const orderedSubs = useMemo(
    () => (localOrder ? applyLocalOrder(subAgents, localOrder, (s) => s.id) : subAgents),
    [subAgents, localOrder],
  );

  // 서버가 같은 순서를 돌려줬거나(커밋 반영) 식구가 달라지면(탭 추가·삭제) 로컬 순서는 소임을 다한다.
  useEffect(() => {
    if (!localOrder) return;
    const ids = subAgents.map((s) => s.id);
    if (sameOrder(ids, localOrder) || !sameMembers(ids, localOrder)) setLocalOrder(null);
  }, [subAgents, localOrder]);

  const handleDragStart = useCallback((e: React.DragEvent, subId: string) => {
    // 닫기 버튼/이름 편집 입력 위에서 시작된 드래그는 무시. 탭 div 가 draggable 이라 X 위에서 살짝만
    // 움직여도 네이티브 dragstart 가 발화하며 click 이벤트를 삼켜 "닫기 눌러도 바로 안 닫힘"(다시 눌러야
    // 닫힘) 버그를 유발한다. 버튼/입력에서 시작된 드래그는 막아 클릭이 정상 전달되게 한다.
    if ((e.target as HTMLElement).closest('button, input')) {
      e.preventDefault();
      return;
    }
    setDraggingId(subId);
    e.dataTransfer.effectAllowed = 'move';
    // Firefox 호환 — data 없으면 드래그 취소됨
    e.dataTransfer.setData('text/plain', subId);
    // §5.5 #17-34 — 같은 드래그가 본문 위에서는 **화면 분할**로 읽힌다. `dragover` 중에는 값을 못 읽고
    //   종류만 보이므로 전용 MIME 으로 실어 OS 파일 드래그와 구분되게 한다(탭 순서 바꾸기는 그대로).
    e.dataTransfer.setData(SESSION_DRAG_MIME, encodeSessionDrag(subId));
    // 누구의 세션인지도 **종류로** 싣는다 — 창이 여럿일 때 옆 창이 dragover 단계에서 바로 거절한다.
    if (agentId) e.dataTransfer.setData(sessionOwnerMime(agentId), '1');
    // 어느 세션인지도 종류로 — 이미 그것을 보여 주는 칸은 파란 박스를 띄우지 않는다.
    e.dataTransfer.setData(sessionIdMime(subId), '1');
  }, [agentId]);

  // 자리를 내주는 순간 = 커서가 **그 탭의 중앙선을 넘었을 때**(순수 판정은 `tabPushGeom`).
  // 넘기 전에 바꾸면 자리가 바뀌자마자 커서가 다시 반대편 탭 위에 놓여 두 탭이 매 프레임 맞바꿔진다.
  const handleDragOver = useCallback((e: React.DragEvent, subId: string) => {
    if (!draggingId) return;
    // 탭바 어디서 손을 떼도 유효한 드롭이 되게 — 무효 위치면 네이티브 고스트가 되돌아가는 연출이 뜬다.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggingId === subId) return;
    // rect/좌표는 핸들러가 살아 있는 지금 읽는다(updater 안에서는 currentTarget 이 이미 비어 있다).
    const rect = e.currentTarget.getBoundingClientRect();
    const pointerX = e.clientX;
    setLocalOrder((prev) => resolveTabReorder({
      order: prev ?? subAgents.map((s) => s.id),
      movedKey: draggingId,
      targetKey: subId,
      pointerX,
      targetLeft: rect.left,
      targetWidth: rect.width,
    }) ?? prev);
  }, [draggingId, subAgents]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    // 순서는 이미 dragOver 에서 바뀌었다 — 여기서는 네이티브 되돌리기 연출만 막는다(커밋은 dragEnd).
    e.preventDefault();
  }, []);

  // 손을 떼는 순간(드롭·취소·바깥 릴리스 모두 여기로 온다) 화면에 보이는 순서를 그대로 커밋한다.
  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    if (!agentId || !localOrder) return;
    if (sameOrder(subAgents.map((s) => s.id), localOrder)) { setLocalOrder(null); return; }
    fetch(`/api/subagents/${agentId}/order`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: localOrder }),
    })
      // snapshot 이 권위 — 커밋이 거절되면 로컬 순서를 놓아 서버 순서로 되돌아간다.
      .then((r) => { if (!r.ok) setLocalOrder(null); })
      .catch(() => setLocalOrder(null));
  }, [agentId, localOrder, subAgents]);

  // 활성 탭이 닫히는 집합에 포함되면 인접한 생존 탭(앞→뒤 순)으로 이동, 없으면 null.
  // 단일/일괄 닫기 공용 — 일괄 닫기에서 active 가 대상에 있어도 한 번에 올바른 생존 탭을 고른다.
  // "인접"은 **화면에 보이는** 이웃이어야 하므로 orderedSubs 기준으로 고른다.
  const reassignActiveIfClosing = useCallback((closing: Set<string>) => {
    if (!activeSessionId || !closing.has(activeSessionId)) return;
    const idx = orderedSubs.findIndex((s) => s.id === activeSessionId);
    let survivor: SubAgent | undefined;
    for (let i = idx + 1; i < orderedSubs.length; i++) {
      const s = orderedSubs[i];
      if (s && !closing.has(s.id)) { survivor = s; break; }
    }
    if (!survivor) {
      for (let i = idx - 1; i >= 0; i--) {
        const s = orderedSubs[i];
        if (s && !closing.has(s.id)) { survivor = s; break; }
      }
    }
    setSession(survivor ? survivor.id : null);
  }, [activeSessionId, orderedSubs, setSession]);

  // 탭 1개의 로컬 정리(서버 요청 제외) — PTY 종료 + 낙관적 제거 + 핀/Default 해제.
  // 단일·일괄 닫기가 공유한다. 서버 요청은 호출부가 단일 DELETE 또는 일괄 POST 로 1회만 보낸다.
  const purgeSubLocal = useCallback((subId: string) => {
    if (!agentId) return;
    const store = useGraphStore.getState();
    // §4 v2.63 — CMD 에이전트의 세션 탭은 임베디드 PTY 핸들이기도 하다. 탭을 명시적으로 닫으면
    //   그 세션의 PTY 도 종료(좀비 셸 방지). 비-CMD 에이전트엔 해당 termId 가 없어 no-op.
    // §4 (CMD ⑤ QA) — **분할된 pane 의 PTY 도 전부** 회수한다. 종전에는 기본 termId 하나만 죽여
    //   `#1`·`#2` 셸이 화면 없이 계속 돌았다(탭을 닫을수록 좀비가 쌓였다). 어떤 pane 이 있었는지는
    //   그 세션의 `paneTree` 가 진실이므로 거기서 id 를 모아 하나씩 끈다.
    const base = `term:${agentId}:${subId}`;
    const paneTree = store.subAgents[agentId]?.find((x) => x.id === subId)?.paneTree ?? null;
    for (const paneId of collectCmdPaneIds(paneTree)) {
      void window.api?.terminal?.kill(cmdPaneTermId(base, paneId));
    }
    // 낙관적 제거 — 서버 왕복/브로드캐스트(혹은 stale full-snapshot)를 기다리지 않고 즉시 탭 제거.
    store.optimisticRemoveSubAgent(agentId, subId);
    store.setTabPin(`subagent:${subId}`, false);
    // 닫힌 서브에이전트가 Default였으면 Default도 해제
    if (store.defaultSubAgents[agentId] === subId) {
      store.setDefaultSubAgent(agentId, null);
    }
  }, [agentId]);

  const deleteSubAgent = useCallback((subId: string) => {
    if (!agentId) return;
    reassignActiveIfClosing(new Set([subId]));
    purgeSubLocal(subId);
    fetch(`/api/subagents/${agentId}/${subId}`, { method: 'DELETE' })
      .catch(() => { /* snapshot이 권위 — 인텐트가 정리될 때까지 유지 */ });
  }, [agentId, reassignActiveIfClosing, purgeSubLocal]);

  // 여러 탭 일괄 닫기 — 개별 DELETE(매번 broadcast+checkpoint) 대신 1회 일괄 POST 로 서버 부하/지연을
  // 없앤다("다른 탭 닫기"가 한 개씩 느리게 닫히던 버그). 낙관적 제거는 즉시 모두 반영(React 가 배치).
  const deleteSubAgents = useCallback((ids: string[]) => {
    if (!agentId || ids.length === 0) return;
    if (ids.length === 1) { deleteSubAgent(ids[0]!); return; }
    reassignActiveIfClosing(new Set(ids));
    for (const id of ids) purgeSubLocal(id);
    fetch(`/api/subagents/${agentId}/remove-bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }).catch(() => { /* snapshot이 권위 — 인텐트가 정리될 때까지 유지 */ });
  }, [agentId, reassignActiveIfClosing, purgeSubLocal, deleteSubAgent]);

  // --- 동작 중 세션 닫기 확인 ---
  // 닫으려는 세션 중 status==='active'(동작 중)인 게 하나라도 있으면 즉시 닫지 않고 확인 팝업을 띄운다.
  // pendingClose = 확인 대기 중인 닫기 대상 세션 id 목록. "닫기" 확정 시 그대로 진행, "취소"/Esc 시 폐기.
  const [pendingClose, setPendingClose] = useState<string[] | null>(null);

  // 닫기 요청 공용 진입점(X 버튼·컨텍스트 메뉴). active 세션이 대상에 없으면 바로 닫고, 있으면 확인 팝업으로.
  const requestClose = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const hasActive = ids.some((id) => subAgents.find((s) => s.id === id)?.status === 'active');
    if (hasActive) { setPendingClose(ids); return; }
    deleteSubAgents(ids);
  }, [subAgents, deleteSubAgents]);

  const confirmClose = useCallback(() => {
    if (pendingClose) deleteSubAgents(pendingClose);
    setPendingClose(null);
  }, [pendingClose, deleteSubAgents]);

  const cancelClose = useCallback(() => setPendingClose(null), []);
  const confirmBackdrop = useBackdropDismiss(cancelClose);

  // 확인 팝업이 목록으로 보여줄, 닫힘 대상 중 실제 동작 중인 세션들.
  const pendingActiveSubs = useMemo(() => {
    if (!pendingClose) return [];
    return pendingClose
      .map((id) => subAgents.find((s) => s.id === id))
      .filter((s): s is SubAgent => !!s && s.status === 'active');
  }, [pendingClose, subAgents]);

  // 확인 팝업 열림 동안 Esc 로 취소.
  useEffect(() => {
    if (!pendingClose) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); setPendingClose(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingClose]);

  const handleClose = useCallback((e: React.MouseEvent, subId: string) => {
    e.stopPropagation();
    requestClose([subId]);
  }, [requestClose]);

  // --- 가로 스크롤 (탭이 많아지면 좌/우 페이드 + wheel 가로 스크롤 + 오버레이 썸) ---
  // 네이티브 스크롤바는 레이아웃 점유로 탭을 줄이기 때문에 hide 하고, 오버레이 썸을 별도 DOM 으로 그린다(VS Code 식).
  // 페이드/썸 갱신은 imperative ref 조작 — 스크롤·리사이즈마다 React 리렌더 없이 즉시 반영.
  const scrollRef = useRef<HTMLDivElement>(null);
  const fadeLeftRef = useRef<HTMLDivElement>(null);
  const fadeRightRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  // §5.5 #17-9 ④(b) v5.03 — 스크롤 밖으로 밀린 실행 중 탭 알림.
  //   탭이 많으면 도는 탭이 화면 밖으로 나가는데 그 사실을 말하는 자리가 없어, 아무것도 안 도는
  //   화면과 구별되지 않았다. 판정은 순수 모듈이 하고 여기서는 결과만 DOM 에 반영한다.
  const hiddenLeftRef = useRef<HTMLButtonElement>(null);
  const hiddenRightRef = useRef<HTMLButtonElement>(null);
  const hiddenLeftCountRef = useRef<HTMLSpanElement>(null);
  const hiddenRightCountRef = useRef<HTMLSpanElement>(null);
  const runningIdsRef = useRef<ReadonlySet<string>>(new Set<string>());
  const hiddenRef = useRef<HiddenRunningTabs>(noHiddenRunningTabs());

  const syncHiddenRunning = useCallback((el: HTMLDivElement) => {
    const boxes: TabBox[] = [];
    for (const child of Array.from(el.children)) {
      // 탭이 아닌 자식(마지막 인라인 New 버튼)은 `data-tab-id` 가 없어 자연히 걸러진다.
      if (!(child instanceof HTMLElement)) continue;
      const id = child.dataset.tabId;
      if (!id) continue;
      boxes.push({ id, left: child.offsetLeft, right: child.offsetLeft + child.offsetWidth });
    }
    const hidden = findHiddenRunningTabs(boxes, runningIdsRef.current, el.scrollLeft, el.clientWidth);
    if (sameHiddenRunningTabs(hidden, hiddenRef.current)) return;
    hiddenRef.current = hidden;
    applyHiddenIndicator(hiddenLeftRef.current, hiddenLeftCountRef.current, hidden.left.length,
      t('ide.tabbar.hiddenRunning', { count: hidden.left.length }));
    applyHiddenIndicator(hiddenRightRef.current, hiddenRightCountRef.current, hidden.right.length,
      t('ide.tabbar.hiddenRunning', { count: hidden.right.length }));
  }, [t]);

  /** 그 방향으로 처음 만나는 실행 탭으로 이동 — 선택하면 아래 "활성 탭 자동 가시화"가 스크롤까지 맡는다. */
  const jumpToHidden = useCallback((dir: 'left' | 'right') => {
    const id = hiddenRef.current[dir][0];
    if (id) setSession(id);
  }, [setSession]);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    const fL = fadeLeftRef.current;
    const fR = fadeRightRef.current;
    const th = thumbRef.current;
    if (!el || !fL || !fR || !th) return;
    const overflow = el.scrollWidth - el.clientWidth;
    fL.classList.toggle('visible', el.scrollLeft > 4);
    fR.classList.toggle('visible', overflow - el.scrollLeft > 4);
    // 넘치지 않는 경우(아래 early return)에도 알림은 꺼져야 하므로 여기서 먼저 맞춘다.
    syncHiddenRunning(el);
    if (overflow <= 0 || el.clientWidth <= 0) {
      th.style.opacity = '0';
      th.style.width = '0px';
      return;
    }
    const ratio = el.clientWidth / el.scrollWidth;
    const width = Math.max(24, el.clientWidth * ratio);
    const left = (el.scrollLeft / overflow) * (el.clientWidth - width);
    th.style.opacity = '1';
    th.style.width = `${width}px`;
    th.style.transform = `translateX(${left}px)`;
  }, [syncHiddenRunning]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    // 다중 ResizeObserver — 부모 트리 사이즈 변화도 잡는다(Electron maximize/restore 가
    // 자식 ResizeObserver 를 누락하는 케이스 대응).
    if (el.parentElement) ro.observe(el.parentElement);
    ro.observe(document.documentElement);
    const onWinResize = (): void => {
      updateScrollState();
      requestAnimationFrame(updateScrollState);
    };
    window.addEventListener('resize', onWinResize);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
      window.removeEventListener('resize', onWinResize);
    };
  }, [updateScrollState]);

  // 탭 수/이름/핀 변동 시 재계산. 도는 탭 집합도 여기서 갱신한다 — 실행이 시작·종료되면
  // 가려진 알림의 수도 함께 바뀌어야 한다(§5.5 #17-9 ④(b) v5.03).
  useEffect(() => {
    runningIdsRef.current = new Set(subAgents.filter((s) => s.status === 'active').map((s) => s.id));
    updateScrollState();
  }, [subAgents, tabPins, updateScrollState]);

  // §5.4 #14 — 순서가 바뀌면 옆 세션 탭이 **밀려나며** 제자리에 앉는다(FLIP). 끌고 있는 탭은 손을 바로
  // 따라오고 이웃은 살짝 넘겼다 돌아온다. 탭을 닫아 옆이 메워질 때도 같은 재생이 돈다.
  useTabPushAnimation({
    container: scrollRef,
    keyAttribute: 'data-tab-id',
    order: orderedSubs.map((s) => s.id),
    leadKey: draggingId,
  });

  // 휠은 기본적으로 세로지만 가로 스크롤 영역에서는 가로로 변환 — VS Code 동일 동작.
  // shiftKey 휠이나 trackpad 가로 휠(deltaX)도 자연스럽게 처리.
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth) return;
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (delta === 0) return;
    el.scrollLeft += delta;
    e.preventDefault();
  }, []);

  // 활성 탭이 뷰포트 밖이면 자동 가시화.
  useEffect(() => {
    if (!activeSessionId) return;
    const el = scrollRef.current;
    if (!el) return;
    const tab = el.querySelector<HTMLElement>(`[data-tab-id="${activeSessionId}"]`);
    if (!tab) return;
    const tl = tab.offsetLeft;
    const tr = tl + tab.offsetWidth;
    const vl = el.scrollLeft;
    const vr = vl + el.clientWidth;
    if (tl < vl) el.scrollLeft = tl - 8;
    else if (tr > vr) el.scrollLeft = tr - el.clientWidth + 8;
  }, [activeSessionId, subAgents.length]);

  // --- Context menu ---
  const [ctx, setCtx] = useState<{ subId: string; index: number; x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, subId: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ subId, index, x: e.clientX, y: e.clientY });
  }, []);

  const ctxIsPinned = ctx ? !!tabPins[`subagent:${ctx.subId}`] : false;
  const ctxIsDefault = ctx ? defaultSubId === ctx.subId : false;
  // ctx.index 는 **화면에 보이는** 자리다 — 좌/우 판정도 같은 순서(orderedSubs)로 봐야 어긋나지 않는다.
  const ctxHasOthers = useMemo(() => {
    if (!ctx) return false;
    return orderedSubs.some((s, i) => i !== ctx.index && !tabPins[`subagent:${s.id}`]);
  }, [ctx, orderedSubs, tabPins]);
  const ctxHasLeft = useMemo(() => {
    if (!ctx) return false;
    return orderedSubs.some((s, i) => i < ctx.index && !tabPins[`subagent:${s.id}`]);
  }, [ctx, orderedSubs, tabPins]);
  const ctxHasRight = useMemo(() => {
    if (!ctx) return false;
    return orderedSubs.some((s, i) => i > ctx.index && !tabPins[`subagent:${s.id}`]);
  }, [ctx, orderedSubs, tabPins]);

  const handleCtxAction = useCallback((action: 'close' | 'closeOthers' | 'closeLeft' | 'closeRight' | 'closeAll' | 'togglePin' | 'toggleDefault' | 'splitRight' | 'splitDown') => {
    if (!ctx) return;
    const store = useGraphStore.getState();

    // §5.5 #17-34 — 끌어다 놓는 것과 같은 동작을 메뉴로도. 대상 칸을 `null` 로 주면 초점 칸이
    //   기준이 되고(아직 안 나눴으면 창 전체), 그 다음 그 세션으로 초점이 따라간다.
    if (action === 'splitRight' || action === 'splitDown') {
      store.dropSessionOnIDECell(splitSlotKey, null, action === 'splitRight' ? 'right' : 'bottom', ctx.subId);
      setSession(ctx.subId);
      return;
    }
    if (action === 'togglePin') {
      store.setTabPin(`subagent:${ctx.subId}`, !ctxIsPinned);
      return;
    }
    if (action === 'toggleDefault') {
      if (!agentId) return;
      store.setDefaultSubAgent(agentId, ctxIsDefault ? null : ctx.subId);
      return;
    }

    let targets: SubAgent[] = [];
    if (action === 'close') {
      const target = orderedSubs[ctx.index];
      if (target) targets = [target];
    } else if (action === 'closeOthers') {
      targets = orderedSubs.filter((s, i) => i !== ctx.index && !tabPins[`subagent:${s.id}`]);
    } else if (action === 'closeLeft') {
      targets = orderedSubs.filter((_, i) => i < ctx.index).filter((s) => !tabPins[`subagent:${s.id}`]);
    } else if (action === 'closeRight') {
      targets = orderedSubs.filter((_, i) => i > ctx.index).filter((s) => !tabPins[`subagent:${s.id}`]);
    } else if (action === 'closeAll') {
      targets = orderedSubs.filter((s) => !tabPins[`subagent:${s.id}`]);
    }

    // 단일은 단일 DELETE, 다중은 1회 일괄 POST 로 닫는다(deleteSubAgents 가 분기).
    // 단, 대상에 동작 중(active) 세션이 있으면 requestClose 가 확인 팝업을 먼저 띄운다.
    if (targets.length > 0) requestClose(targets.map((t) => t.id));
  }, [ctx, ctxIsPinned, ctxIsDefault, agentId, orderedSubs, tabPins, requestClose, splitSlotKey, setSession]);

  return (
    <div className="flex h-9 flex-shrink-0 items-end gap-0 border-b border-gray-700 bg-[#15192a]">
      {/* Hook 에이전트: 메인 세션 탭 (프롬프트+결과 read-only) */}
      {!isCustom && (
        <button
          type="button"
          draggable
          // §5.5 #17-34 — 메인 탭도 칸으로 끌어 놓을 수 있다(세션 `null` = 에이전트 전체 합본).
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', encodeSessionDrag(null));
            e.dataTransfer.setData(SESSION_DRAG_MIME, encodeSessionDrag(null));
            if (agentId) e.dataTransfer.setData(sessionOwnerMime(agentId), '1');
            e.dataTransfer.setData(sessionIdMime(null), '1');
          }}
          onClick={() => { selectSessionInSplit(null); }}
          className={`flex h-8 flex-shrink-0 items-center gap-1.5 border-r border-gray-700 px-3 text-xs transition-colors ${
            activeSessionId === null
              ? 'border-b-2 border-b-blue-400 bg-gray-800 text-white'
              : 'bg-gray-900/40 text-gray-400 hover:bg-gray-800/60 hover:text-gray-300'
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          <HoverTooltip className="max-w-[100px] truncate max-md:max-w-[4.5rem]" label={t('ide.tabbar.agentTabLabel')} />
        </button>
      )}

      {/* SubAgent session tabs — 가로 스크롤 컨테이너 (overflow 시 좌/우 페이드 + hover 오버레이 썸) */}
      <div className="group/tabscroll relative flex min-w-0 flex-1 items-end">
        <div
          ref={scrollRef}
          onWheel={handleWheel}
          className="scrollbar-overlay flex h-9 min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden"
        >
          {orderedSubs.map((sub, index) => {
        const isActive = activeSessionId === sub.id;
        // 도트 색 = 공유 판정(실행/실패/완료·미확인/완료·확인) → 공유 색표. 규약은 한 곳에만 있다.
        const isAcked = !!acknowledgedSubAgents[sub.id];
        const dot = SESSION_STATUS_DOT[sessionRunStateOf(sub, isAcked, busySubIds.has(sub.id))];
        // §4 (CMD ①) — 막힌 세션은 **새 모양을 발명하지 않고** 기존 도트에 앰버 링만 덧입힌다
        //   (§2.4 '잠듦'이 상태 유니온을 늘리지 않고 표기 한 줄만 덧붙인 것과 같은 규율).
        const blockedRing = sub.blocked ? ' ring-2 ring-amber-400/80' : '';
        // §4 (CMD ②) — 전경 프로세스명은 **라벨을 덮지 않고** 도트 툴팁에만 덧붙인다(사용자 rename 우선).
        const tabTitle = [displayLabel(sub), sub.foregroundProcess, sub.blocked ? sub.blockedReason : undefined]
          .filter((x): x is string => !!x && x.length > 0)
          .join(' · ');
        const isDragging = draggingId === sub.id;
        const inSplitCell = splitCellSessions.has(sub.id);
        const isPinned = !!tabPins[`subagent:${sub.id}`];
        const isDefault = defaultSubId === sub.id;
        // 이 탭의 루프가 켜져 있는 동안에만 값이 있다 — [정지]·삭제·중지로 꺼지면 아이콘도 사라진다.
        // 툴팁은 활동바 배지와 같은 표기를 기존 i18n 키 조합으로 말한다(신규 키 ❌).
        const loopRun = runningLoops.get(sub.id);
        const loopTitle = loopRun
          ? `${t('ide.activityBar.loop')} — ${loopRun.total !== null
            ? t('ide.loop.progressCount', { done: loopRun.completed, total: loopRun.total })
            : t('ide.loop.progressInfinite', { done: loopRun.completed })}`
          : '';
        return (
          <div
            key={sub.id}
            data-tab-id={sub.id}
            draggable
            onDragStart={(e) => handleDragStart(e, sub.id)}
            onDragOver={(e) => handleDragOver(e, sub.id)}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            onClick={() => { selectSessionInSplit(sub.id); }}
            onContextMenu={(e) => handleContextMenu(e, sub.id, index)}
            className={`group relative flex h-8 flex-shrink-0 cursor-pointer items-center gap-1.5 border-r border-gray-700 pl-3 pr-1.5 text-xs transition-colors ${
              isActive
                ? 'border-b-2 border-b-blue-400 bg-gray-800 text-white'
                : inSplitCell
                  // §5.5 #17-34 — 초점은 아니지만 **지금 옆 칸에 떠 있는** 세션. 옅은 밑줄로 그 사실만 말한다.
                  ? 'border-b-2 border-b-blue-400/40 bg-gray-800/50 text-gray-300 hover:bg-gray-800/70'
                  : 'bg-gray-900/40 text-gray-400 hover:bg-gray-800/60 hover:text-gray-300'
            } ${isDragging ? 'opacity-40' : ''}`}
          >
            {isPinned && (
              <span className="flex-shrink-0 cursor-help" title={t('tabMenu.pinTooltip')}>
                <svg className="h-2.5 w-2.5 text-amber-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 3l-1 1 1 1-4 4-3-1-4 4 5 5-5 5 1 1 5-5 5 5 1-1-5-5 4-4-1-3 4-4 1 1 1-1-5-5z" />
                </svg>
              </span>
            )}
            {isDefault && (
              <span className="flex-shrink-0 cursor-help" title={t('tabMenu.defaultTooltip')}>
                <svg className="h-2.5 w-2.5 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l2.39 7.36H22l-6.19 4.5L18.2 21 12 16.5 5.8 21l2.39-7.14L2 9.36h7.61z" />
                </svg>
              </span>
            )}
            {loopRun && (
              <span className="flex-shrink-0 cursor-help text-amber-400" title={loopTitle}>
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 2l4 4-4 4" />
                  <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                  <path d="M7 22l-4-4 4-4" />
                  <path d="M21 13v1a4 4 0 0 1-4 4H3" />
                </svg>
              </span>
            )}
            <span className={`h-1.5 w-1.5 rounded-full ${dot}${blockedRing}`} title={tabTitle} />
            {editingId === sub.id ? (
              <input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commitRename(sub.id);
                  else if (e.key === 'Escape') cancelRename();
                }}
                onBlur={() => commitRename(sub.id)}
                className="w-[120px] rounded border border-blue-400/60 bg-gray-900 px-1 py-0.5 text-xs text-gray-100 outline-none max-md:w-[6.5rem]"
              />
            ) : (
              // 탭 크기 고정 — 이름이 길면 ...(truncate). HoverTooltip 으로 전체 라벨 빠르게 호버 표시.
              //   폰(max-md)에서는 120px 탭 두 개면 화면이 찬다 — **지금 보고 있는 탭만** 넓게 두고
              //   나머지는 좁혀, 세션이 여럿일 때 옆 탭이 화면 밖으로 밀리지 않게 한다.
              <HoverTooltip
                className={`w-[120px] truncate ${isActive ? 'max-md:w-[6.5rem]' : 'max-md:w-[4rem]'}`}
                label={displayLabel(sub)}
              />
            )}
            <button
              type="button"
              onClick={(e) => handleClose(e, sub.id)}
              className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-gray-500 opacity-0 transition-all hover:bg-gray-600/50 hover:text-gray-200 group-hover:opacity-100 ${
                // 터치엔 hover 가 없다 — 폰에서 세션을 닫을 유일한 길. 좁은 탭이 X 로 덮이지 않게
                // **지금 보고 있는 탭**에만 띄우고, 손가락 크기에 맞춰 조금 키운다.
                isActive ? 'pointer-coarse:h-5 pointer-coarse:w-5 pointer-coarse:opacity-100' : ''
              }`}
              aria-label={`Close ${sub.label}`}
              title={t('ide.tabbar.closeTab')}
            >
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        );
          })}
          {/* 세션 탭 바로 옆 인라인 New 버튼 — 우측 끝 + 버튼이 멀어서, 마지막 탭 옆에 바로 붙는다(크롬식).
              §5.5 #17-29 — 훅 버블은 읽기 전용이라 세션을 새로 붙일 손잡이 자체를 두지 않는다. */}
          {isCustom && (
          <button
            type="button"
            onClick={onNewSession}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center self-end text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
            title={t('ide.tabbar.newSession')}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          )}
        </div>
        {/* 좌/우 에지 페이드 — 가려진 방향에만 표시 (imperative class toggle) */}
        <div ref={fadeLeftRef} className="scroll-fade-left" />
        <div ref={fadeRightRef} className="scroll-fade-right" />
        {/* §5.5 #17-9 ④(b) v5.03 — 그쪽에 가려진 **실행 중** 탭 알림. 표시·숫자는 ref 로 갱신하고
            누르면 그 방향으로 처음 만나는 실행 탭으로 이동한다. 가려진 실행이 없으면 뜨지 않는다. */}
        <button
          ref={hiddenLeftRef}
          type="button"
          onClick={() => jumpToHidden('left')}
          style={{ display: 'none' }}
          className="absolute bottom-1 left-0 z-20 items-center gap-1 rounded-r border border-l-0 border-blue-400/40 bg-gray-900/95 py-0.5 pl-0.5 pr-1.5 text-blue-200 transition-colors hover:bg-gray-800"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-blue-400" />
          <span ref={hiddenLeftCountRef} className="text-[12px] font-semibold tabular-nums">0</span>
        </button>
        <button
          ref={hiddenRightRef}
          type="button"
          onClick={() => jumpToHidden('right')}
          style={{ display: 'none' }}
          className="absolute bottom-1 right-0 z-20 items-center gap-1 rounded-l border border-r-0 border-blue-400/40 bg-gray-900/95 py-0.5 pl-1.5 pr-0.5 text-blue-200 transition-colors hover:bg-gray-800"
        >
          <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-blue-400" />
          <span ref={hiddenRightCountRef} className="text-[12px] font-semibold tabular-nums">0</span>
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        {/* 오버레이 스크롤바 썸 — 탭 위로 떠서 hover 시 표시. 레이아웃 점유 X. style 은 ref 로 직접 갱신. */}
        <div
          ref={thumbRef}
          className="pointer-events-none absolute bottom-0 left-0 h-[3px] rounded-full bg-slate-400/0 transition-[background-color] duration-200 group-hover/tabscroll:bg-slate-400/50"
          style={{ opacity: 0, width: 0 }}
        />
      </div>

      {/* New tab button — 커스텀 에이전트만(§5.5 #17 / #17-29 훅 버블 = 읽기 전용) */}
      {isCustom && (
        <button
          type="button"
          onClick={onNewSession}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          title={t('ide.tabbar.newSession')}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      )}

      {/* History(폴더) button — 이 cwd에서 쓰였던 과거 세션을 다시 열기.
          §5.5 #17-29 — 되살리기도 세션 추가라 훅 버블에는 두지 않는다. */}
      {isCustom && <HistoryButton />}

      {ctx && (
        <TabContextMenu
          x={ctx.x}
          y={ctx.y}
          isPinned={ctxIsPinned}
          isDefault={ctxIsDefault}
          hasOthers={ctxHasOthers}
          hasLeft={ctxHasLeft}
          hasRight={ctxHasRight}
          showDetach={false}
          showRename
          // §5.5 #17-34 — 폰 폭에서는 나눠 봐야 두 칸 다 못 읽는다. 그 화면에서는 메뉴를 아예 안 준다.
          showSplit={!isNarrowViewport}
          onAction={(action) => {
            // §5.4 #14-1 — IDE 서브에이전트 탭은 detach 미지원. showDetach=false 라 도달하지 않지만
            // 타입 좁힘을 위해 가드.
            if (action === 'detach') return;
            if (action === 'rename') { startRename(ctx.subId); return; }
            handleCtxAction(action);
          }}
          onClose={() => setCtx(null)}
        />
      )}

      {/* 동작 중 세션 닫기 확인 팝업 — 대상에 active 세션이 있을 때만. IDE 모달 위(z-[70])로 body 포털. */}
      {pendingClose && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60"
          {...confirmBackdrop}
        >
          <div className="mx-4 w-[clamp(20rem,34vw,28rem)] rounded-lg border border-gray-700 bg-gray-900 shadow-xl shadow-black/40">
            <div className="border-b border-gray-800 px-5 py-3 text-sm font-semibold text-gray-100">
              {t('ide.tabbar.confirmCloseTitle')}
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-300">{t('ide.tabbar.confirmCloseMessage')}</p>
              {pendingActiveSubs.length > 0 && (
                <ul className="scrollbar-thin mt-3 flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {pendingActiveSubs.map((sub) => (
                    <li key={sub.id} className="flex items-center gap-2 text-xs text-gray-300">
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-400" />
                      <span className="truncate">{displayLabel(sub)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelClose}
                  className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-700"
                >
                  {t('ide.tabbar.confirmCloseCancel')}
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={confirmClose}
                  className="rounded border border-red-700 bg-red-800 px-3 py-1.5 text-sm text-white transition-colors hover:bg-red-700"
                >
                  {t('ide.tabbar.confirmCloseConfirm')}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
});

// ─── History 팝업 ───

function HistoryButton(): React.JSX.Element | null {
  const { t } = useTranslation();
  const agentId = useIDEPaneValue((o) => o.agentId);
  const { setSession } = useIDEPaneActions();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SubAgentHistoryItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/subagents/${agentId}/history`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { ok: boolean; items?: SubAgentHistoryItem[] };
      })
      .then((data) => setItems(data.items ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [agentId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // 통합 앱 — restore 도 optimistic. 히스토리 항목에 stub 데이터가 다 있으므로
  // store 에 즉시 추가 + setSession 동기 호출. fetch 는 fire-and-forget (서버가 같은 id 로 archive→registry 이동).
  const handleRestore = useCallback((item: SubAgentHistoryItem) => {
    if (!agentId) return;
    const stub: SubAgent = {
      id: item.subAgentId,
      sessionId: item.sessionId,
      label: item.label,
      parentAgentId: agentId,
      status: 'idle',
      lastCommand: item.lastCommand,
      createdAt: item.lastActivityAt,
      lastActivityAt: item.lastActivityAt,
    };
    // 낙관적 복원 — 서버 restore 왕복 전에 즉시 탭 추가. full-snapshot race 에도 유지되도록
    // 복원 인텐트로 등록(loadSnapshot 이 스냅샷에 반영될 때까지 다시 채워 넣음).
    useGraphStore.getState().optimisticRestoreSubAgent(agentId, stub);
    setSession(stub.id);
    setOpen(false);
    fetch(`/api/subagents/${agentId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subAgentId: item.subAgentId }),
    }).catch(() => {});
  }, [agentId, setSession]);

  const backdrop = useBackdropDismiss(() => setOpen(false));

  if (!agentId) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
        title={t('ide.tabbar.pastSessions')}
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M3 7v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-8l-2-2H5a2 2 0 0 0-2 2z" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          {...backdrop}
        >
          <div
            className="mx-4 flex max-h-[70vh] w-full max-w-xl flex-col rounded-lg border border-gray-700 bg-gray-900 shadow-2xl shadow-black/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
              <span className="text-sm font-semibold text-gray-100">{t('ide.tabbar.pastSessions')}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                aria-label={t('ide.tabbar.pastSessionsClose')}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="scrollbar-thin flex-1 overflow-y-auto p-3">
              {loading && <p className="p-4 text-center text-xs text-gray-500">{t('ide.tabbar.loading')}</p>}
              {error && <p className="p-4 text-center text-xs text-red-400">{error}</p>}
              {!loading && !error && items && items.length === 0 && (
                <p className="p-4 text-center text-xs text-gray-500">{t('ide.tabbar.noClosedSessions')}</p>
              )}
              {!loading && items && items.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {items.map((it) => (
                    <li key={it.subAgentId}>
                      <button
                        type="button"
                        onClick={() => handleRestore(it)}
                        className="flex w-full items-center gap-3 rounded border border-gray-700/50 bg-gray-800/40 px-3 py-2 text-left transition-colors hover:border-blue-500/50 hover:bg-gray-700/60"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-gray-200">{it.label}</span>
                          {it.lastCommand && (
                            <span className="block truncate text-[12px] text-gray-500">{it.lastCommand}</span>
                          )}
                        </div>
                        <span className="flex-shrink-0 text-[12px] text-gray-500">
                          {new Date(it.lastActivityAt).toLocaleString('en-US', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
