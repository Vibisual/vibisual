import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import type { AppBubblePastFile } from '@vibisual/shared';
import { fileFaceKindOf, previewLaneOf } from '@vibisual/shared';

import type { AppBubbleShape } from '../../apps/registry.js';
import { getInternalApp } from '../../apps/registry.js';
import { openAppWindow } from '../../apps/appWindows.js';
import { prefetchAppShell } from '../../apps/prefetchAppShell.js';
import { appNodeResizeBounds, resetSizeMove, type AppNodeForm } from '../../apps/appNodeForm.js';
import { thumbBakeBox, thumbPixelSize, useSteadyThumbnail } from '../../apps/appThumbnails.js';
import { useAppCanvasFace } from '../../apps/appCanvasFaces.js';
import { FACE_CONTROL, isFaceControlTarget } from '../../apps/canvasFaceKit.js';
import { useCoarsePointer } from '../../hooks/useIsMobile.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { promptDialog } from '../../utils/appDialog.js';
import { useRefLinkDragStore } from '../../stores/refLinkDrag.js';
import { isInteractiveTarget, useBubbleSelectGesture } from './bubbleSelectGesture.js';
import { CanvasNodeMenu, CanvasNodeMenuItem, CanvasNodeMenuSeparator } from './CanvasNodeMenu.js';
import { useCanvasNodeSelection } from './useCanvasNodeSelection.js';
import { openGroupMenuIfGrouped } from './BubbleContextMenu.js';
import { appNodeLabel } from './agentCard.js';
import { AppScreenFace } from './AppScreenFace.js';
import { useAppLinkedItems } from '../../apps/appLinkedItems.js';
import { appNodeShowsLinkedItems } from './linkView.js';
import { AppLinkedSatellites } from './AppLinkedSatellites.js';
import { AppWorkOrbit } from './AppWorkOrbit.js';
import type { AppWorkOrbitInfo } from './appWorkFold.js';

/** §5.4 #36 (H) ③ — 지난 결과가 없을 때 한 객체를 돌려 써서, 구슬 줄 memo 가 매 그리기마다 깨지지 않게. */
const EMPTY_PAST: readonly AppBubblePastFile[] = [];

/** §5.4 #36 (B) — 위성줄용 숨은 손잡이(가운데). 자리는 안 쓰이지만 React Flow 는 손잡이 없는 노드에 선을 잇지 않는다. */
const LINK_HANDLE_STYLE: React.CSSProperties = {
  left: '50%',
  top: '50%',
  opacity: 0,
  width: 1,
  height: 1,
  border: 'none',
  minWidth: 0,
  minHeight: 0,
  pointerEvents: 'none',
};

/** §5.4 #36 (G) — 화면의 머리줄 높이(px). 아래 머리줄의 `h-[22px]` 와 같은 값 — 결과 자리 높이를 셀 때 뺀다. */
const SCREEN_HEADER_HEIGHT = 22;
/** 화면 테두리 두께(px) — 좌우·위아래로 한 번씩 빠진다. */
const SCREEN_BORDER = 1;

/** 필름 앱 화면 머리줄 위 가장자리의 네모 구멍 한 줄 — "영상" 신호(§5.4 #36 (G) — 둥근 구멍 ❌, 위아래 띠 두 줄 ❌). */
const SPROCKET_ROW = 'repeating-linear-gradient(90deg, rgba(255,255,255,0.5) 0 3px, transparent 3px 8px)';

/**
 * §5.13 — 내부 앱 버블 노드(누르면 선택 · 더블클릭은 앱 창 · 우클릭은 메뉴). 특정 앱을 모른다 — `appId` 로 레지스트리에서 다 가져온다.
 * §5.4 #36 (F)(G) — 놓아 둔 앱은 명패, 이어졌거나 결과를 담은 앱은 화면. 화면도 누름은 선택, 크기는 형태에 붙는다(`sizedForm`), 결과 안쪽은 앱의 `canvasFace`.
 * 화면엔 스프링 눌림 ❌(안쪽 단추를 누를 때 노드 전체가 줄지 않게).
 */

export interface AppBubbleNodeData extends Record<string, unknown> {
  appBubbleId: string;
  appId: string;
  title?: string | undefined;
  refKey?: string | undefined;
  projectName: string;
  width: number;
  height: number;
  preservePinned?: boolean | undefined;
  /** §5.4 #36 (C) — 결과 전달로 담긴 파일(루트 기준 상대 경로). 열면 이 파일로 앱이 열린다. */
  file?: string | undefined;
  /** §5.4 #36 (F) — 명패냐 화면이냐(캔버스가 `appNodeForm` 으로 판정해 넘긴다). 없으면 명패. */
  form?: AppNodeForm | undefined;
  /** §5.4 #36 (F) — 결과 버전. 같은 이름으로 다시 와도 미리보기를 다시 굽는 열쇠다. */
  fileAt?: number | undefined;
  /** §5.4 #36 (F) — 이 노드를 참조하는 에이전트들 — 그중 하나가 돌면 화면이 "만드는 중"을 보인다. */
  linkedAgentIds?: readonly string[] | undefined;
  /** §5.4 #36 (G) — 지금 형태에서 사용자가 정한 크기인가(우클릭 [기본 크기로] 를 띄울지). */
  userSized?: boolean | undefined;
  /** §5.4 #36 (H) ① — 이 노드에서 위성줄·구슬 줄을 감췄나. 연결은 그대로다. */
  linksHidden?: boolean | undefined;
  /** §5.4 #36 (H) ③ — 지난 결과(결과 전달로 바뀌기 전 파일들, 최근 것부터). 구슬 줄의 마지막 묶음이 된다. */
  pastFiles?: readonly AppBubblePastFile[] | undefined;
  /** §5.1 #2-1 (F) ⑤⑧ — 앱 작업 보기의 초점 노드면 작업 궤도(위성 수 · 넘침). 그리는 사본에만 실린 표시 값이다. */
  appWorkOrbit?: AppWorkOrbitInfo | undefined;
}

interface MenuPos {
  x: number;
  y: number;
}

/** 필름 퍼포레이션 띠. 구멍 수·크기는 부르는 쪽이 프레임 치수에서 비례로 뽑는다(고정이면 작은 버블에서 띠가 화면을 다 먹는다). 구멍은 네모(§5.4 #36 (G)). */
function FilmPerforation({
  count,
  height,
  holeWidth,
  holeHeight,
}: {
  count: number;
  height: number;
  holeWidth: number;
  holeHeight: number;
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center justify-around bg-black/50 px-1" style={{ height }}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="shrink-0 bg-white/60" style={{ width: holeWidth, height: holeHeight }} />
      ))}
    </div>
  );
}

/** 고정 표식 — 압정(Lucide `pin` 결의 stroke). */
function PinGlyph({ className }: { className: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 17v5" />
      <path d="M9 10.76V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v3.76a2 2 0 0 0 .59 1.42L17 13.5V17H7v-3.5l1.41-1.32A2 2 0 0 0 9 10.76z" />
    </svg>
  );
}

/** 에디터에서 열기 — 바깥으로 벌어지는 두 화살(Lucide `maximize-2` 결). 앱 안 창으로 크게 연다는 뜻. */
function OpenGlyph(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3"
      aria-hidden="true"
    >
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

export const AppBubbleNode = memo(function AppBubbleNode({
  id,
  data,
  selected,
}: NodeProps & { data: AppBubbleNodeData }): React.JSX.Element {
  const { t } = useTranslation();
  const app = getInternalApp(data.appId);
  const projects = useGraphStore((s) => s.projects);
  const selectAppBubbleInStore = useGraphStore((s) => s.selectAppBubble);
  /**
   * §6 — 고른 묶음(`selected`)도 다른 버블과 같은 칸(`selectable:false` 면 박스 선택·Ctrl/Shift 클릭이 건너뛴다).
   * 보통 클릭은 묶음을 이 하나로 + 우측 패널, Ctrl/Cmd 클릭은 패널 없이 넣고 뺀다.
   */
  const canvasSelection = useCanvasNodeSelection(id, data.appBubbleId);
  const selectAppBubble = useCallback((bubbleId: string): void => {
    canvasSelection.replace();
    selectAppBubbleInStore(bubbleId);
  }, [canvasSelection, selectAppBubbleInStore]);
  const deleteAppBubble = useGraphStore((s) => s.deleteAppBubble);
  const renameAppBubble = useGraphStore((s) => s.renameAppBubble);
  const setAppBubblePin = useGraphStore((s) => s.setAppBubblePin);
  const patchAppBubbleLocal = useGraphStore((s) => s.patchAppBubbleLocal);
  const setAppBubbleDragLock = useGraphStore((s) => s.setAppBubbleDragLock);
  const commitAppBubbleSize = useGraphStore((s) => s.commitAppBubbleSize);
  /** 선택 표시는 store(`selectedAppBubbleId` — 우측 패널)와 `selected`(고른 묶음, §6) 중 하나라도 켜지면 낸다 — 왕복이 끊겨도 표시가 안 뜨는 버블이 없게. */
  /**
   * 링은 `selectIntentId` 도 본다 — 더블클릭 버블은 선택을 240ms 미루므로 그 사이 반응을 이 칸이 낸다.
   * 판정 결과만 구독한다(§9 — id 를 받으면 남을 고를 때마다 다시 그려진다).
   */
  const chosenHere = useGraphStore((s) => s.selectedAppBubbleId === data.appBubbleId || s.selectIntentId === data.appBubbleId);
  const isSelected = selected === true || chosenHere;
  // 터치에는 hover 가 없다 — 크기 조절 손잡이는 **고른 노드에서만** 보이고 손가락 크기다(전부 띄우면 캔버스가 손잡이로 덮인다).
  const coarsePointer = useCoarsePointer();
  /** §5.4 #36 (B) — 끄는 위성줄이 이 노드 위면 놓기 전에 에이전트 색 테로 알린다. 판정 결과(색 또는 null)만 구독한다 — 끄는 매 프레임 모든 앱 노드가 깨면 안 된다. */
  const dropColor = useRefLinkDragStore((s) => (s.drag?.target?.id === data.appBubbleId ? s.drag.color : null));

  const [menu, setMenu] = useState<MenuPos | null>(null);
  // 바깥 press·아무 키로 닫기는 메뉴 껍데기(`CanvasNodeMenu`)가 든다 — 다섯 노드가 같은 규약 한 벌.
  const closeMenu = useCallback((): void => setMenu(null), []);

  const projectPath = Object.values(projects).find((p) => p.name === data.projectName)?.path;
  const open = useCallback((): void => {
    if (!app) return;
    const projectId = projectPath ?? data.projectName;
    // §5.13 (S-1) — 앱 안 창으로 연다(밖은 끌어냈을 때만). §5.4 #36 (C) — 담긴 결과 파일이 있으면 그 파일로.
    // §5.13 (L) — 묶인 작업 문서(`ref`)가 있으면 그 문서를 먼저 연다 — 노드 id 를 실어 창에서 고른 문서를 이 노드가 기억한다.
    openAppWindow({ appId: data.appId, projectId, ref: data.refKey, file: data.file, title: data.title, bubbleId: data.appBubbleId });
  }, [app, projectPath, data.projectName, data.refKey, data.appId, data.title, data.file, data.appBubbleId]);
  // §5.13 (X) 39-2 — 손이 올라가면 한가할 때, 누르면 바로 그 앱의 화면 청크를 받아 둔다(더블클릭으로 열 때 기다리지 않게).
  const prefetchSoon = useCallback((): void => prefetchAppShell(data.appId), [data.appId]);
  const prefetchNow = useCallback((): void => prefetchAppShell(data.appId, { now: true }), [data.appId]);

  /**
   * 선택 — 에이전트 버블과 같은 상태기계(`bubbleSelectGesture`): 움직임 없이 뗐을 때만, 240ms 안 두 번째 누름이면 접는다. 화면도 누름은 선택이다(§5.4 #36 (G)).
   * 버튼·입력·화면 안 조작 자리(`nodrag`)의 누름은 선택 ❌. 캡처 단계 pointerdown — React Flow `d3-drag` 가 버블 단계 누름을 삼킨다.
   */
  const form: AppNodeForm = data.form ?? 'nameplate';
  const isScreen = app !== undefined && form === 'screen';
  const gesture = useBubbleSelectGesture({
    // 미등록 앱 버블에는 열 창이 없다 — 더블클릭할 일이 없으니 지연도 붙이지 않는다.
    doubleClickable: app !== undefined,
    select: () => selectAppBubble(data.appBubbleId),
    // §6 — Ctrl/Cmd 클릭은 묶음에 넣고 뺀다(링·우측 패널 ❌).
    toggle: canvasSelection.toggle,
    setIntent: (active) => {
      useGraphStore.getState().setSelectIntent(active ? data.appBubbleId : null);
    },
    ignore: (e) => isInteractiveTarget(e.target) || isFaceControlTarget(e.target),
  });

  /**
   * §5.13 39-2 — 누르면 앱 화면 청크를 미리 받는다. 손짓의 캡처 누름과 한 핸들러여야 한다 — `onPointerDownCapture` 를 따로 적으면
   * 손짓을 덮어써 앱 노드가 안 골라지고 `Delete` 로 안 지워진다.
   */
  const handlePressCapture = useCallback((e: React.PointerEvent): void => {
    prefetchNow();
    gesture.handlers.onPointerDownCapture(e);
  }, [prefetchNow, gesture]);

  /**
   * §5.4 #36 (G) — 크기 조절(§5.14 플레이 프리뷰와 같은 길): 끄는 동안 낙관 반영 + 드래그 락(스냅샷이 되돌리지 않게), 떼면 PATCH 뒤 락을 푼다.
   * 크기는 지금 형태에 붙는다(`sizedForm`).
   */
  const [resizing, setResizing] = useState(false);
  /** 크기가 실제로 바뀌는 중인가 — 첫 변화(`handleResize`)에서 켜고 끝(`handleResizeEnd`)에서 끈다. */
  const resizingRef = useRef(false);
  const bounds = appNodeResizeBounds(form);
  /**
   * 락은 크기가 실제로 바뀔 때 건다 — 크기 그대로인 누름(테두리 클릭)엔 `onResizeEnd` 가 안 와, `onResizeStart` 에서 걸면 락이 영영 남는다
   * (스냅샷 ❌ · 손잡이가 켜진 채). 바뀌기 시작한 누름은 선택 손짓에서 접는다.
   */
  const handleResize = useCallback<NonNullable<React.ComponentProps<typeof NodeResizer>['onResize']>>(
    (_evt, p) => {
      if (!resizingRef.current) {
        resizingRef.current = true;
        gesture.cancelPress();
        setAppBubbleDragLock(data.appBubbleId, true);
        setResizing(true);
      }
      patchAppBubbleLocal(data.appBubbleId, { x: p.x, y: p.y, width: p.width, height: p.height, sizedForm: form });
    },
    [gesture, setAppBubbleDragLock, patchAppBubbleLocal, data.appBubbleId, form],
  );
  const handleResizeEnd = useCallback<NonNullable<React.ComponentProps<typeof NodeResizer>['onResizeEnd']>>(
    (_evt, p) => {
      resizingRef.current = false;
      setResizing(false);
      const id = data.appBubbleId;
      void (async () => {
        await commitAppBubbleSize(id, { x: p.x, y: p.y, width: p.width, height: p.height }, form);
        // 저장 직후 도착하는 스냅샷이 방금 정한 크기를 덮지 않도록 잠깐 더 잠근다(§5.13).
        setTimeout(() => setAppBubbleDragLock(id, false), 300);
      })();
    },
    [commitAppBubbleSize, setAppBubbleDragLock, data.appBubbleId, form],
  );

  /**
   * §5.4 #36 (F)(G) — 화면이 비출 미리보기(앱이 굽고 코어가 기억). 열쇠에 결과 버전(`fileAt`)이 있어 같은 이름으로 다시 보내도 새로 비친다.
   * 굽는 크기는 `bakeStep` 단위, 크기를 바꾸는 동안 얼리고 새로 굽는 동안 앞 그림을 보인다(`useSteadyThumbnail`).
   */
  const hasFile = typeof data.file === 'string' && data.file !== '';
  // §5.13 (L) — 결과 파일 없이 작업 문서만 묶인 노드도, 앱이 그 문서를 비추겠다고 선언했으면(`faceShowsRef`) 안쪽을 앱이 그린다.
  const hasRefFace = app?.faceShowsRef === true && typeof data.refKey === 'string' && data.refKey !== '';
  const bodyWidth = Math.max(1, data.width - SCREEN_BORDER * 2);
  const bodyHeight = Math.max(1, data.height - SCREEN_BORDER * 2 - SCREEN_HEADER_HEIGHT);
  const bakeRef = useRef<{ width: number; height: number } | null>(null);
  const bakeBox = !resizing || bakeRef.current === null ? thumbBakeBox(bodyWidth, bodyHeight) : bakeRef.current;
  bakeRef.current = bakeBox;
  const thumbPx = thumbPixelSize(bakeBox.width, bakeBox.height, typeof window === 'undefined' ? 1 : window.devicePixelRatio);
  // 결과를 비출 화면이면 그 프로젝트 루트(아니면 undefined) — 미리보기·안쪽 조작이 같은 판정을 쓴다.
  const resultProject = isScreen && (hasFile || hasRefFace) ? projectPath : undefined;
  const resultFile = data.file ?? '';
  // 코어가 굽는 정지 미리보기는 **결과 파일**의 것이다 — 문서 모드는 앱이 스스로 비춘다.
  // §5.1 #2-1 (G) ④ — 결과 파일의 종류로 굽는 줄을 가른다(영상·소리·3D 는 한 번에 하나). 화면은 한 화면 속 상한 밖이다.
  const resultLane = hasFile ? previewLaneOf(fileFaceKindOf(resultFile)) ?? undefined : undefined;
  const thumbState = useSteadyThumbnail(
    resultProject !== undefined && hasFile
      ? {
        appId: data.appId, projectId: resultProject, file: resultFile, version: data.fileAt ?? 0,
        width: thumbPx.width, height: thumbPx.height, ...(resultLane ? { lane: resultLane } : {}),
      }
      : null,
  );
  const thumb = thumbState.status === 'ready' ? thumbState.thumb : null;
  // §5.4 #36 (G) — 결과가 담긴 화면의 안쪽은 앱이 그린다(늦은 로더 — 내려오는 동안은 정지 미리보기).
  const Face = useAppCanvasFace(resultProject !== undefined ? data.appId : null);
  // 이어진 에이전트 중 하나라도 도는가 — 판정 결과(불리언)만 구독한다(위성줄의 구슬 흐름과 같은 규칙).
  const linkedKey = (data.linkedAgentIds ?? []).join('\n');
  const linkedIds = useMemo(() => (linkedKey === '' ? [] : linkedKey.split('\n')), [linkedKey]);
  const working = useGraphStore((s) => linkedIds.length > 0 && s.agents.some((a) => a.status === 'active' && linkedIds.includes(a.id)));

  /** §5.4 #36 (H) ③ — 구슬 줄은 노드에서 끈 것(①)만 접는다(에이전트의 보기 ②는 묻지 않는다). 판정은 `linkView.ts`. */
  const linksHidden = data.linksHidden === true;
  const showLinked = appNodeShowsLinkedItems({ linksHidden: data.linksHidden });
  const hasRef = typeof data.refKey === 'string' && data.refKey !== '';
  // 앱이 선언한 "연결된 것"(장면·소재 등) — 화면이고, 펴는 보기이고, 묶인 문서나 결과가 있을 때만 묻는다(늦은 로더).
  const linkedReq = isScreen && showLinked && projectPath !== undefined && (hasFile || hasRef)
    ? { projectId: projectPath, projectName: data.projectName, ref: data.refKey, file: data.file }
    : null;
  const linkedItems = useAppLinkedItems(linkedReq !== null && app?.linkedItems !== undefined ? data.appId : null, linkedReq);
  const pastFiles = isScreen && showLinked ? (data.pastFiles ?? EMPTY_PAST) : EMPTY_PAST;

  /** 더블클릭 — 그 앱의 앱 안 창을 연다(§5.13 (S-1)), 선택 ❌. 조작 자리를 빨리 두 번 누른 것은 건너뛴다(§5.4 #36 (G)). */
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent): void => {
      e.stopPropagation();
      if (isInteractiveTarget(e.target) || isFaceControlTarget(e.target)) return;
      gesture.cancelPendingSelect();
      open();
    },
    [gesture, open],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    // §6 — 여럿을 고른 묶음 안에서 눌렀으면 묶음 메뉴다(묶음 안 어느 버블 위에서 눌러도 같다). 판정은 캔버스가 한다.
    if (selected === true && openGroupMenuIfGrouped(id, e.clientX, e.clientY)) return;
    // 우클릭은 고르지 않는다(§6 — 우측 패널은 왼쪽 클릭 선택만). 메뉴는 `data.appBubbleId` 를 직접 가리킨다.
    setMenu({ x: e.clientX, y: e.clientY });
  }, [id, selected]);

  // 이름·핀·삭제는 store 한 경로 — 우클릭 메뉴와 우측 옵션 패널이 같은 함수를 쓴다.
  const rename = useCallback(async (): Promise<void> => {
    setMenu(null);
    const next = await promptDialog(
      t('panel.apps.renamePrompt', { defaultValue: '버블 이름' }),
      data.title ?? '',
    );
    if (next === null) return;
    renameAppBubble(data.appBubbleId, next);
  }, [t, data.title, data.appBubbleId, renameAppBubble]);

  const togglePin = useCallback((): void => {
    setMenu(null);
    setAppBubblePin(data.appBubbleId, data.preservePinned !== true);
  }, [data.preservePinned, data.appBubbleId, setAppBubblePin]);

  // 삭제는 store 한 곳으로 — Delete 키와 이 메뉴가 같은 경로를 쓴다(핀 거절 처리도 한 벌).
  const remove = useCallback((): void => {
    setMenu(null);
    void deleteAppBubble(data.appBubbleId);
  }, [deleteAppBubble, data.appBubbleId]);

  // §5.4 #36 (G) — [기본 크기로]: 정한 크기를 걷고 선언 크기로, 가운데를 지킨다(판정은 `appNodeForm` 한 벌).
  const resetSize = useCallback((): void => {
    setMenu(null);
    const store = useGraphStore.getState();
    const bubble = store.appBubbles.find((b) => b.id === data.appBubbleId);
    if (!bubble) return;
    store.resetAppBubbleSize(bubble.id, resetSizeMove(getInternalApp(bubble.appId), bubble));
  }, [data.appBubbleId]);

  // §5.4 #36 (H) ① — [연결선 숨기기]/[연결선 보이기]: 이 노드의 위성줄과 구슬 줄만 감춘다(연결은 그대로). store 한 경로.
  const toggleLinks = useCallback((): void => {
    setMenu(null);
    useGraphStore.getState().setAppBubbleLinksHidden(data.appBubbleId, !linksHidden);
  }, [data.appBubbleId, linksHidden]);

  // §5.4 #36 (H) ③ — 지난 결과 구슬을 더블클릭하면 그 파일을 이 앱으로 연다. 노드에 묶지 않는다(`bubbleId` ❌) —
  //   노드의 지금 결과는 그대로이고, 앱 창이 고른 문서를 노드가 기억하는 길(§5.13 (L))도 타지 않는다.
  const openPast = useCallback((file: string): void => {
    if (!app) return;
    openAppWindow({ appId: data.appId, projectId: projectPath ?? data.projectName, file });
  }, [app, data.appId, projectPath, data.projectName]);

  const isPinned = data.preservePinned === true;

  /** §5.13 (M) — 명패 치수는 버블 크기에서 비례로 뽑는다(작게 줄여도 서로 밀지 않게). `dense` 면 덜 중요한 것부터 뺀다(보조 라벨 → 아이콘). */
  const dense = data.height < 96 || data.width < 150;
  const stripHeight = Math.max(4, Math.min(10, Math.round(data.height * 0.1)));
  const holeHeight = Math.max(2, stripHeight - 3);
  const holeWidth = Math.max(3, Math.round(holeHeight * 1.4));
  const holeCount = Math.max(4, Math.min(24, Math.round(data.width / 14)));

  const menuItem = (
    onClick: () => void,
    text: string,
    opts: { danger?: boolean; disabled?: boolean; title?: string } = {},
  ): React.JSX.Element => (
    <CanvasNodeMenuItem onClick={onClick} label={text} danger={opts.danger} disabled={opts.disabled} title={opts.title} />
  );

  /**
   * 우클릭 메뉴는 미등록 앱이어도 늘 뜬다(안 뜨면 지울 길이 없다) — 고정·삭제는 공통, 열기·설치·이름 바꾸기는 앱이 있을 때만.
   * [기본 크기로] 는 지금 형태에서 크기를 정했을 때만(§5.4 #36 (G)).
   */
  const menuPortal = menu
    ? (
        <CanvasNodeMenu x={menu.x} y={menu.y} minWidthClass="min-w-44" onClose={closeMenu}>
          {app
            ? menuItem(() => {
                setMenu(null);
                open();
              }, t('panel.apps.open', { defaultValue: '열기' }))
            : null}
          {app ? menuItem(rename, t('panel.apps.rename', { defaultValue: '이름 바꾸기' })) : null}
          {app && data.userSized === true
            ? menuItem(resetSize, t('panel.apps.resetSize', { defaultValue: '기본 크기로' }))
            : null}
          {menuItem(
            togglePin,
            isPinned
              ? t('panel.apps.unpin', { defaultValue: '고정 해제' })
              : t('panel.apps.pin', { defaultValue: '고정' }),
          )}
          {/* §5.4 #36 (H) ① — 이어졌거나 결과를 담은 노드(화면)만 — 놓아 둔 명패에는 감출 선이 없다. 문구는 에이전트 메뉴와 같은 키. */}
          {app && isScreen
            ? menuItem(
                toggleLinks,
                linksHidden ? t('canvas.bubbleMenu.showLinks') : t('canvas.bubbleMenu.hideLinks'),
                linksHidden ? {} : { title: t('canvas.bubbleMenu.hideLinksNote') },
              )
            : null}
          <CanvasNodeMenuSeparator />
          {/* 핀이 걸린 버블은 서버가 409 로 거절한다(§2.4) — 눌러도 아무 일 없는 대신 이유를 보여 준다. */}
          {menuItem(remove, t('panel.apps.delete', { defaultValue: '삭제' }), {
            danger: true,
            disabled: isPinned,
            ...(isPinned
              ? { title: t('panel.apps.deletePinnedHint', { defaultValue: '고정된 버블입니다. 먼저 고정을 해제하세요.' }) }
              : {}),
          })}
        </CanvasNodeMenu>
      )
    : null;

  // 등록되지 않은 앱 — 조용히 빈 도형을 그리지 않고 무엇이 없는지 보여 준다.
  // (원 ❌ — 앱 버블은 어떤 상태에서도 에이전트 버블과 같은 모양이 되지 않는다.)
  if (!app) {
    return (
      <>
        <div
          {...gesture.handlers}
          onContextMenu={handleContextMenu}
          className={`bubble-press flex cursor-pointer select-none items-center justify-center overflow-hidden rounded border border-dashed bg-gray-900/70 text-center text-[12px] leading-tight text-amber-300 ${
            dense ? 'px-1' : 'px-2'
          } ${isSelected ? 'border-white ring-2 ring-amber-300/70' : 'border-amber-400/70'}`}
          style={{ width: data.width, height: data.height }}
        >
          <Handle type="source" id="src" position={Position.Top} style={LINK_HANDLE_STYLE} isConnectable={false} />
          <Handle type="target" id="tgt" position={Position.Top} style={LINK_HANDLE_STYLE} isConnectable={false} />
          {/* 작게 줄인 프레임에서는 두 줄이 안 들어간다 — 무엇이 없는지(=appId)를 남긴다. */}
          {dense ? (
            <span className="max-w-full truncate">{data.appId}</span>
          ) : (
            <>
              {t('panel.apps.unknown', { defaultValue: '알 수 없는 앱' })}
              <br />
              {data.appId}
            </>
          )}
        </div>
        {menuPortal}
      </>
    );
  }

  const Icon = app.icon;
  // 이름은 번역, 없으면 레지스트리의 제품 이름 — `id` 로 떨어뜨리면 로케일이 빈 언어에서 소문자 식별자가 찍힌다.
  const appName = t(app.nameKey, { defaultValue: app.name });
  // §5.4 #36 (C) — 사용자 제목 → 담긴 결과 파일 이름 → 앱 이름(말풍선의 위성 칩과 같은 규칙 한 벌).
  const label = appNodeLabel({ title: data.title, file: data.file }, appName);

  /** §5.13 (M) — 모양은 앱이 정한다. 코어는 원을 그리지 않는다(에이전트 버블이 원이라 앱까지 원이면 가려낼 수 없다). */
  const shape: AppBubbleShape = app.bubbleShape ?? 'plate';
  const isFilm = shape === 'film';

  /**
   * 가장자리·모서리는 선택 없이 바로 잡는다. 손잡이는 닿거나 바꾸는 동안만 보이고, 가운데는 pointer-events 를 통과시킨다. 위성줄을 받을 참이면 숨긴다(한도 `APP_NODE_RESIZE`).
   * 띠도 노드다 — 몸통 밖 형제라 몸통 핸들러가 닿지 않으므로 선택 손짓·더블클릭·우클릭 메뉴를 이 감싸개에도 단다(`pointer-events-none` 은 전파를 막지 않는다).
   */
  const resizer = (
    <div
      className="group/app-resize pointer-events-none absolute inset-0 z-10"
      {...gesture.handlers}
      onPointerDownCapture={handlePressCapture}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      <NodeResizer
        isVisible={!dropColor}
        minWidth={bounds.minWidth}
        minHeight={bounds.minHeight}
        maxWidth={bounds.maxWidth}
        maxHeight={bounds.maxHeight}
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
        lineStyle={{ borderColor: 'transparent', borderWidth: 4, pointerEvents: 'auto' }}
        handleStyle={{ width: coarsePointer ? 18 : 10, height: coarsePointer ? 18 : 10, borderColor: app.glow, background: '#0A0C12', pointerEvents: 'auto' }}
        handleClassName={`!rounded-none ${resizing ? 'opacity-100' : `opacity-0 group-hover/app-resize:opacity-100${isSelected ? ' pointer-coarse:opacity-100' : ''}`}`}
      />
    </div>
  );

  /**
   * §5.4 #36 (G) — 화면: 22px 머리줄(앱 색 · 아이콘·이름·고정 표식·[에디터에서 열기]) + 결과(담겼으면 앱의 `canvasFace`).
   * `bubble-press` ❌ — 안쪽 단추를 누를 때 노드 전체가 줄어든다.
   */
  if (isScreen) {
    const openLabel = t('panel.fileEdit.openInEditor', { defaultValue: '에디터에서 열기' });
    const screenStyle: React.CSSProperties = {
      width: data.width,
      height: data.height,
      border: `${SCREEN_BORDER}px solid`,
      borderColor: isSelected ? app.glow : `${app.glow}59`,
      background: '#07090D',
      // 에이전트 버블처럼 바깥 고리로 선택을 알리되, 흰 선 대신 앱 색을 쓴다. 연결 대상 색이 선택보다 먼저다.
      boxShadow: isSelected && !dropColor
        ? `0 0 0 1px ${app.glow}80, 0 0 0 4px ${app.glow}4D, 0 6px 18px rgba(0,0,0,0.55)`
        : dropColor
          ? `0 0 0 1px ${dropColor}, 0 0 0 4px ${dropColor}40, 0 6px 18px rgba(0,0,0,0.55)`
          : '0 4px 14px rgba(0,0,0,0.5)',
    };
    return (
      <>
        {/* §5.1 #2-1 (F) ⑤⑧ — 작업 위성이 앉는 위쪽 반원 궤도 · 넘친 작업물 점(앱 작업 보기에서만). 화면 뒤에 깔린다. */}
        {data.appWorkOrbit ? <AppWorkOrbit orbit={data.appWorkOrbit} width={data.width} height={data.height} /> : null}
        {resizer}
        <div
          {...gesture.handlers}
          onPointerEnter={prefetchSoon}
          onPointerDownCapture={handlePressCapture}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          title={t('panel.apps.openHint', { defaultValue: '더블클릭하면 열립니다.' })}
          className="relative flex select-none flex-col overflow-hidden rounded text-white"
          style={screenStyle}
        >
          <Handle type="source" id="src" position={Position.Top} style={LINK_HANDLE_STYLE} isConnectable={false} />
          <Handle type="target" id="tgt" position={Position.Top} style={LINK_HANDLE_STYLE} isConnectable={false} />
          <div
            className="relative flex h-[22px] shrink-0 items-center gap-1.5 border-b pl-1.5 pr-0.5"
            style={{ background: app.color, borderColor: `${app.glow}33` }}
          >
            {isFilm ? (
              <div className="pointer-events-none absolute inset-x-1 top-0 h-[3px] opacity-60" style={{ background: SPROCKET_ROW }} />
            ) : null}
            <span className="flex shrink-0 opacity-90 [&>svg]:h-3 [&>svg]:w-3" style={{ color: app.glow }}>
              <Icon />
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-none text-white/90">{label}</span>
            {isPinned ? <PinGlyph className="h-3 w-3 shrink-0 text-white/70" /> : null}
            <button
              type="button"
              title={openLabel}
              aria-label={openLabel}
              onClick={(e) => {
                e.stopPropagation();
                gesture.cancelPendingSelect();
                open();
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className={`${FACE_CONTROL} flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm text-white/65 transition-colors hover:bg-white/15 hover:text-white`}
            >
              <OpenGlyph />
            </button>
            {working ? (
              // 이어진 에이전트가 도는 중 — 머리줄 아래 가장자리를 훑는 가는 줄(transform 만 움직인다 · 움직임 줄이기면 멈춘다).
              <div className="pointer-events-none absolute inset-x-0 -bottom-px h-px overflow-hidden">
                <div
                  className="app-screen-scan h-full w-2/5"
                  style={{ background: `linear-gradient(90deg, transparent, ${app.glow}, transparent)` }}
                />
              </div>
            ) : null}
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {resultProject !== undefined && Face ? (
              <Face
                projectId={resultProject}
                file={resultFile}
                {...(hasRefFace ? { workRef: data.refKey, projectName: data.projectName } : {})}
                version={data.fileAt ?? 0}
                width={bodyWidth}
                height={bodyHeight}
                glow={app.glow}
                icon={<Icon />}
                thumb={thumb}
                thumbLoading={thumbState.status === 'loading'}
              />
            ) : (
              <AppScreenFace
                width={bodyWidth}
                height={bodyHeight}
                glow={app.glow}
                icon={<Icon />}
                hasFile={hasFile}
                working={working}
                thumb={thumb}
                thumbLoading={thumbState.status === 'loading'}
                emptyText={t('panel.apps.screenEmpty', { defaultValue: '결과가 여기 뜹니다' })}
                workingText={t('panel.apps.screenWorking', { defaultValue: '만드는 중…' })}
              />
            )}
          </div>
        </div>
        {/* §5.4 #36 (H) ③ — 노드 아래 구슬 줄: 앱이 고른 "연결된 것"(장면·소재) + 지난 결과. 노드와 함께 움직인다. */}
        {showLinked && (linkedItems.length > 0 || pastFiles.length > 0) ? (
          <AppLinkedSatellites
            items={linkedItems}
            pastFiles={pastFiles}
            nodeWidth={data.width}
            nodeHeight={data.height}
            glow={app.glow}
            appId={data.appId}
            appIcon={<Icon />}
            projectId={projectPath}
            onOpenNode={open}
            onOpenPast={openPast}
            onContextMenu={handleContextMenu}
          />
        ) : null}
        {menuPortal}
      </>
    );
  }

  /** 명패 — 4px 모서리 · 1px 테 · 평평한 앱 색 · 네모 퍼포레이션(§5.4 #36 (G)). 안쪽 조작이 없어 `bubble-press` 는 남긴다. */
  const borderColor = isSelected ? app.glow : `${app.glow}80`;
  const shellStyle: React.CSSProperties = {
    width: data.width,
    height: data.height,
    border: '1px solid',
    borderColor,
    // 구(球)로 보이는 방사형 그라디언트 ❌ — 그게 에이전트 버블의 인상이다. 평면 판으로.
    background: app.color,
    // 색 번짐(bloom) ❌ — 선택 링만 앱 색(고리 + 바깥 헤일로 — box-shadow 라 `overflow-hidden` 에 안 잘린다), 평시엔 그림자.
    // 위성줄을 받을 참이면 에이전트 색 두 겹(§5.4 #36 (B)).
    boxShadow: isSelected && !dropColor
      ? `0 0 0 1px ${app.glow}80, 0 0 0 ${dense ? 3 : 4}px ${app.glow}59, 0 4px 14px rgba(0,0,0,0.5)`
      : dropColor
        ? `0 0 0 1px ${dropColor}, 0 0 0 ${dense ? 3 : 4}px ${dropColor}40, 0 4px 14px rgba(0,0,0,0.5)`
        : '0 3px 10px rgba(0,0,0,0.45)',
  };

  /** 보조 라벨 — 이름을 바꾼 버블만 원래 앱 이름을 적는다(같은 이름을 두 번 쓰지 않는다). */
  const subLabel = label === appName ? null : appName;
  const showSubLabel = subLabel !== null && !dense;
  const showIcon = !dense || !showSubLabel;

  const caption = (
    <>
      <div className="max-w-full truncate text-center text-[12px] font-semibold leading-tight text-white">{label}</div>
      {showSubLabel ? (
        <div className="mt-0.5 max-w-full truncate text-center text-[12px] leading-tight tracking-wide text-white/55">
          {subLabel}
        </div>
      ) : null}
    </>
  );

  return (
    <>
      {resizer}
      <div
        {...gesture.handlers}
        onPointerEnter={prefetchSoon}
        onPointerDownCapture={handlePressCapture}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        title={t('panel.apps.openHint', { defaultValue: '더블클릭하면 열립니다.' })}
        // bubble-press — 기존 버블과 같은 눌림 반응(스프링 복귀). 조작 감각은 이어받는다.
        className={`bubble-press relative flex cursor-pointer select-none flex-col overflow-hidden rounded text-white ${
          isFilm ? '' : 'items-center justify-center'
        }`}
        style={shellStyle}
      >
        <Handle type="source" id="src" position={Position.Top} style={LINK_HANDLE_STYLE} isConnectable={false} />
        <Handle type="target" id="tgt" position={Position.Top} style={LINK_HANDLE_STYLE} isConnectable={false} />
        {isFilm ? (
          <>
            <FilmPerforation count={holeCount} height={stripHeight} holeWidth={holeWidth} holeHeight={holeHeight} />
            <div className={`relative flex flex-1 flex-col items-center justify-center overflow-hidden ${dense ? 'px-1' : 'px-2'}`}>
              {showIcon ? (
                <div className={`opacity-95 ${dense ? 'mb-px [&>svg]:h-3.5 [&>svg]:w-3.5' : 'mb-1 [&>svg]:h-6 [&>svg]:w-6'}`}>
                  <Icon />
                </div>
              ) : null}
              {caption}
            </div>
            <FilmPerforation count={holeCount} height={stripHeight} holeWidth={holeWidth} holeHeight={holeHeight} />
          </>
        ) : (
          <div className={`flex w-full flex-col items-center justify-center overflow-hidden ${dense ? 'px-1' : 'px-2'}`}>
            {showIcon ? (
              <div className={`opacity-90 ${dense ? 'mb-px [&>svg]:h-3.5 [&>svg]:w-3.5' : 'mb-1 [&>svg]:h-6 [&>svg]:w-6'}`}>
                <Icon />
              </div>
            ) : null}
            {caption}
          </div>
        )}
        {/* 고정 표식 — 필름 프레임에서는 위쪽 퍼포레이션 띠를 피해 화면 영역 안쪽에 놓는다. */}
        {isPinned ? (
          <PinGlyph
            className={`pointer-events-none absolute z-10 text-white/80 ${
              dense
                ? `right-0.5 h-2.5 w-2.5 ${isFilm ? 'top-2' : 'top-1'}`
                : `right-1.5 h-3 w-3 ${isFilm ? 'top-3.5' : 'top-1.5'}`
            }`}
          />
        ) : null}
      </div>

      {menuPortal}
    </>
  );
});
