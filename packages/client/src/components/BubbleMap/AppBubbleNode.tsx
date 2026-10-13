import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import type { AppBubblePastFile } from '@vibisual/shared';

import type { AppBubbleShape } from '../../apps/registry.js';
import { getInternalApp } from '../../apps/registry.js';
import { openAppWindow } from '../../apps/appWindows.js';
import { appNodeResizeBounds, resetSizeMove, type AppNodeForm } from '../../apps/appNodeForm.js';
import { thumbBakeBox, thumbPixelSize, useSteadyThumbnail } from '../../apps/appThumbnails.js';
import { useAppCanvasFace } from '../../apps/appCanvasFaces.js';
import { FACE_CONTROL, isFaceControlTarget } from '../../apps/canvasFaceKit.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { useRefLinkDragStore } from '../../stores/refLinkDrag.js';
import { useOutsidePressDismiss } from '../../hooks/usePopupDismiss.js';
import { isInteractiveTarget, useBubbleSelectGesture } from './bubbleSelectGesture.js';
import { useCanvasNodeSelection } from './useCanvasNodeSelection.js';
import { openGroupMenuIfGrouped } from './BubbleContextMenu.js';
import { appNodeLabel } from './agentCard.js';
import { AppScreenFace } from './AppScreenFace.js';
import { useAppLinkedItems } from '../../apps/appLinkedItems.js';
import { appNodeShowsLinkedItems } from './linkView.js';
import { AppLinkedSatellites } from './AppLinkedSatellites.js';

/** §5.4 #36 (H) ③ — 지난 결과가 없을 때 한 객체를 돌려 써서, 구슬 줄 memo 가 매 그리기마다 깨지지 않게. */
const EMPTY_PAST: readonly AppBubblePastFile[] = [];

/**
 * §5.4 #36 (B) — 위성줄의 끝점 계산용 숨은 손잡이(가운데). 줄은 노드 실측 상자로 테두리를 잡으므로 손잡이
 * 자리는 계산에 쓰이지 않지만, React Flow 는 손잡이가 없는 노드에 선을 잇지 않는다.
 */
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

/**
 * 필름 앱의 화면 머리줄 위 가장자리를 지나는 **네모 구멍 한 줄** — 위아래 퍼포레이션 띠를 걷은 자리에서 "영상"이라는
 * 신호를 이어받는다(§5.4 #36 (G) — 둥근 구멍 ❌, 띠 두 줄이 먹던 높이 ❌).
 */
const SPROCKET_ROW = 'repeating-linear-gradient(90deg, rgba(255,255,255,0.5) 0 3px, transparent 3px 8px)';

/**
 * §5.13 v4.45 — 내부 앱 버블 노드.
 *
 * CommentBox·캡처 버블과 같은 "사용자가 만든 독립 캔버스 요소"이고, 커스텀 에이전트
 * 버블과 같은 조작 감각을 준다 — **누르면 선택, 더블클릭하면 그 앱의 창이 열리고, 우클릭하면
 * 메뉴가 뜬다.**
 *
 * §5.4 #36 (F) — 형태가 둘이다. 놓아 둔 앱은 **명패**이고, 에이전트에 이어졌거나 결과를 담은 앱은
 * **화면**이다 — 커져서 담긴 결과를 비춘다(앱이 구운 미리보기).
 *
 * §5.4 #36 (G) — 화면은 **작은 작업대**다. ① 누름은 선택(명패·다른 버블과 같은 상태기계), 여는 손은 둘 — 더블클릭과
 * 머리줄의 [에디터에서 열기] 단추. ② 명패·화면 둘 다 고르면 모서리·변 손잡이로 크기를 바꾼다(크기는 형태에 붙는다 —
 * `sizedForm`). ③ 결과가 담긴 화면의 안쪽은 앱이 레지스트리 `canvasFace` 로 그린다 — 캔버스에서 바로 하는 간단한 조작
 * (재생·돌려 보기·맞춤). ④ 생김새는 컴팩트하게 — 4px 모서리·1px 테·22px 머리줄, 화면에는 스프링 눌림이 없다(안쪽 조작
 * 단추를 누를 때 노드 전체가 줄어들지 않게).
 *
 * 특정 앱을 알지 않는다. `appId` 로 레지스트리를 찾아 색·아이콘·이름·여는 방법·미리보기·안쪽 조작을
 * 전부 거기서 가져오므로, 앱이 늘어도 이 파일은 그대로다.
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
}

interface MenuPos {
  x: number;
  y: number;
}

/**
 * 필름 퍼포레이션 띠 — 명패 프레임 위·아래에 붙는 구멍 줄.
 *
 * 이 한 줄이 "원이 아닌 무언가"를 넘어 **영상**이라고 말한다. 구멍의 수·크기는 부르는 쪽이
 * 프레임 치수에서 비례로 뽑아 넘긴다 — 고정 크기로 두면 작게 줄인 버블에서 띠가 화면을
 * 통째로 잡아먹는다(v4.66 에서 실제로 그랬다). §5.4 #36 (G) — 구멍은 네모다(둥근 구멍 ❌ — "동글동글" 지적).
 */
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
   * §6 — 고른 묶음(React Flow `selected`)도 다른 버블과 같은 칸이다. 종전에는 `selectable:false` 라 박스 선택이
   * 이 노드를 건너뛰고 Ctrl/Shift 클릭도 묶음에 넣지 못했다(사용자 보고 — "새로 만든 버블들이 선택이 잘 안 된다").
   * 보통 클릭(`selectAppBubble`)은 묶음을 이 노드 하나로 바꾸면서 우측 패널을 열고, Ctrl/Cmd 클릭은 패널 없이 넣고 뺀다.
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
  /**
   * 선택 여부는 **store 를 직접 본다** — React Flow 가 내려 주는 `selected` 만 믿지 않는다.
   *
   * 둘은 뜻이 다르다. store 한 칸(`selectedAppBubbleId`)은 "우측 패널이 보는 것", `selected` 는 캔버스가
   * 칠해 주는 **고른 묶음**(§6 — 박스·Shift·Ctrl/Cmd 로 여럿을 골랐을 때)이다. 둘 중 하나라도 켜지면 고른
   * 표시를 낸다 — 왕복 어딘가가 끊겨도 "눌러도 선택 표시가 안 뜨는" 버블이 되지 않게(v4.68, 캡처·플레이 같음).
   */
  /**
   * 선택 링은 `selectIntentId`(캔버스가 나눠 쓰는 "지금 고른 것 한 칸")도 함께 본다.
   *
   * 더블클릭이 있는 버블은 실제 선택을 240ms 미루므로(`bubbleSelectGesture`), 그 사이 눈에 보이는
   * 반응은 이 한 칸이 낸다. 에이전트 버블이 원래 쓰던 것과 **같은 칸**이라 링은 언제나 하나다.
   * 둘 다 판정 결과만 구독한다(§9) — id 를 받으면 다른 버블을 고를 때마다 이 버블도 다시 그려진다.
   */
  const chosenHere = useGraphStore((s) => s.selectedAppBubbleId === data.appBubbleId || s.selectIntentId === data.appBubbleId);
  const isSelected = selected === true || chosenHere;
  /**
   * §5.4 #36 (B) — 끄는 위성줄이 지금 이 노드 위에 있다 — 놓으면 여기 이어진다는 것을 **놓기 전에** 에이전트 색 테로
   * 알린다. 판정 결과(색 한 글자 또는 null)만 구독한다 — 끄는 매 프레임 모든 앱 노드가 깨면 안 된다.
   */
  const dropColor = useRefLinkDragStore((s) => (s.drag?.target?.id === data.appBubbleId ? s.drag.color : null));

  const [menu, setMenu] = useState<MenuPos | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 바깥 press 로 닫기(공통 규약 — 메뉴 안에서 시작한 press·드래그로는 안 닫힌다).
  // capture 단계 — React Flow 가 이벤트를 선점하기 전에 닫는다.
  useOutsidePressDismiss({
    enabled: menu !== null,
    onDismiss: () => setMenu(null),
    refs: [menuRef],
  });

  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menu]);

  const projectPath = Object.values(projects).find((p) => p.name === data.projectName)?.path;
  const open = useCallback((): void => {
    if (!app) return;
    const projectId = projectPath ?? data.projectName;
    // §5.13 (S-1) — **앱 안 창**으로 연다. 밖으로 나가는 것은 그 창을 끌어냈을 때뿐이다.
    // §5.4 #36 (C) — 담긴 결과 파일이 있으면 그 파일로 연다(§5.13 (R-2) `file`).
    // §5.13 (L) — 묶인 작업 문서(`ref`)가 있으면 앱이 그 문서를 먼저 연다. 노드 id 를 함께 실어 창에서 다른 문서를
    //   고르면 이 노드가 그 문서를 기억한다.
    openAppWindow({ appId: data.appId, projectId, ref: data.refKey, file: data.file, title: data.title, bubbleId: data.appBubbleId });
  }, [app, projectPath, data.projectName, data.refKey, data.appId, data.title, data.file, data.appBubbleId]);

  /**
   * 선택 — 에이전트(IDE) 버블과 **같은 상태기계**를 쓴다(`bubbleSelectGesture`).
   *
   * 움직임 없이 뗐을 때만 선택하고, 더블클릭 창(240ms) 안에 두 번째 누름이 오면 선택을 접는다.
   * 링은 지연 없이 켜지므로 손끝 반응은 그대로다.
   *
   * §5.4 #36 (G) — 화면도 이 규칙으로 돌아왔다(첫 판 (F) 는 화면에서 누름 = 열기였다 — 사용자 지시로 걷었다).
   * 버블 위 버튼·입력과 **화면 안 조작 자리**(재생 위치·파형·돌려 보기 — `nodrag`)에서 시작한 누름은 선택이 아니다.
   *
   * 핸들러 묶음이 **캡처 단계 pointerdown** 을 쓰는 이유는 `bubbleSelectGesture` 에 적어 두었다
   * (React Flow 의 `d3-drag` 가 버블 단계 누름을 통째로 삼킨다 — v4.69 에서 실제로 겪은 자리).
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
   * §5.4 #36 (G) — 크기 조절. 플레이 프리뷰(§5.14)와 같은 길이다 — 끄는 동안은 store 에 낙관 반영 + 드래그 락
   * (먼저 출발한 스냅샷이 손을 따라오던 크기를 되돌리지 않게), 손을 떼면 PATCH 한 번 뒤에 락을 푼다.
   * 크기는 **지금 형태에 붙는다**(`sizedForm`) — 명패에서 정한 크기가 화면을 키우지 않고, 그 반대도 같다.
   */
  const [resizing, setResizing] = useState(false);
  const bounds = appNodeResizeBounds(form);
  const handleResizeStart = useCallback((): void => {
    setAppBubbleDragLock(data.appBubbleId, true);
    setResizing(true);
  }, [setAppBubbleDragLock, data.appBubbleId]);
  const handleResize = useCallback<NonNullable<React.ComponentProps<typeof NodeResizer>['onResize']>>(
    (_evt, p) => {
      patchAppBubbleLocal(data.appBubbleId, { x: p.x, y: p.y, width: p.width, height: p.height, sizedForm: form });
    },
    [patchAppBubbleLocal, data.appBubbleId, form],
  );
  const handleResizeEnd = useCallback<NonNullable<React.ComponentProps<typeof NodeResizer>['onResizeEnd']>>(
    (_evt, p) => {
      setResizing(false);
      const id = data.appBubbleId;
      void (async () => {
        await commitAppBubbleSize(id, { x: p.x, y: p.y, width: p.width, height: p.height }, form);
        // 저장 직후 도착하는 스냅샷이 방금 정한 크기를 덮지 않도록 잠깐 더 잠근다(§5.13 v4.60 규칙).
        setTimeout(() => setAppBubbleDragLock(id, false), 300);
      })();
    },
    [commitAppBubbleSize, setAppBubbleDragLock, data.appBubbleId, form],
  );

  /**
   * §5.4 #36 (F) — 화면이 비출 미리보기. 앱이 굽고 코어가 기억한다(같은 결과면 다시 굽지 않는다).
   * 결과 버전(`fileAt`)이 열쇠에 들어 있어, 같은 이름으로 다시 보내도 새 결과가 바로 비친다.
   *
   * §5.4 #36 (G) — 굽는 자리는 `bakeStep` 단위로 올려 잡고 **크기를 바꾸는 동안 얼린다**(끄는 내내 다시 굽지 않게).
   * 손을 뗀 뒤 새로 굽는 동안에는 앞 그림을 그대로 보인다(`useSteadyThumbnail`).
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
  const thumbState = useSteadyThumbnail(
    resultProject !== undefined && hasFile
      ? { appId: data.appId, projectId: resultProject, file: resultFile, version: data.fileAt ?? 0, width: thumbPx.width, height: thumbPx.height }
      : null,
  );
  const thumb = thumbState.status === 'ready' ? thumbState.thumb : null;
  // §5.4 #36 (G) — 결과가 담긴 화면의 안쪽은 앱이 그린다(늦은 로더 — 내려오는 동안은 정지 미리보기).
  const Face = useAppCanvasFace(resultProject !== undefined ? data.appId : null);
  // 이어진 에이전트 중 하나라도 도는가 — 판정 결과(불리언)만 구독한다(위성줄의 구슬 흐름과 같은 규칙).
  const linkedKey = (data.linkedAgentIds ?? []).join('\n');
  const linkedIds = useMemo(() => (linkedKey === '' ? [] : linkedKey.split('\n')), [linkedKey]);
  const working = useGraphStore((s) => linkedIds.length > 0 && s.agents.some((a) => a.status === 'active' && linkedIds.includes(a.id)));

  /**
   * §5.4 #36 (H) — 연결 보기. ③ 노드 아래 구슬 줄(연결된 것 위성)을 펴는가 — 노드에서 끈 것(①)이 이기고, 이어진 에이전트가
   * **모두** "작업 파일" 보기면 접는다(②). 판정은 `linkView.ts` 한 벌, 구독은 판정 결과(불리언) 하나.
   */
  const linksHidden = data.linksHidden === true;
  const showLinked = useGraphStore((s) =>
    appNodeShowsLinkedItems({ linksHidden: data.linksHidden, linkedAgentIds: linkedIds }, s.agents));
  const hasRef = typeof data.refKey === 'string' && data.refKey !== '';
  // 앱이 선언한 "연결된 것"(장면·소재 등) — 화면이고, 펴는 보기이고, 묶인 문서나 결과가 있을 때만 묻는다(늦은 로더).
  const linkedReq = isScreen && showLinked && projectPath !== undefined && (hasFile || hasRef)
    ? { projectId: projectPath, projectName: data.projectName, ref: data.refKey, file: data.file }
    : null;
  const linkedItems = useAppLinkedItems(linkedReq !== null && app?.linkedItems !== undefined ? data.appId : null, linkedReq);
  const pastFiles = isScreen && showLinked ? (data.pastFiles ?? EMPTY_PAST) : EMPTY_PAST;

  /**
   * 더블클릭 — 그 앱의 창을 연다. **선택은 하지 않는다.**
   *
   * §5.13 (H) 개정 전에는 "안 깔렸으면 설치" 라는 두 번째 뜻이 있었다. 설치라는 단계가
   * 사라졌으므로 더블클릭의 뜻은 이제 하나다.
   *
   * (S-1) 그 창은 **앱 안 창**이다 — 종전처럼 곧바로 OS 창이 뜨지 않는다.
   * §5.4 #36 (G) — 조작 자리(단추·재생 위치·파형·돌려 보기)를 빨리 두 번 누른 것은 여는 뜻이 아니다 — 건너뛴다.
   */
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
    // 우클릭은 고르지 않는다 — 우측 패널은 왼쪽 클릭 선택에서만 뜬다(§6, 2026-10-11 사용자 지시).
    //   메뉴 항목은 전부 이 노드(`data.appBubbleId`)를 직접 가리키므로 선택이 없어도 대상이 갈리지 않는다.
    setMenu({ x: e.clientX, y: e.clientY });
  }, [id, selected]);

  // 이름·핀·삭제는 전부 store 한 경로로 — 우클릭 메뉴와 우측 옵션 패널이 같은 함수를 쓴다(v4.68).
  const rename = useCallback((): void => {
    setMenu(null);
    const next = window.prompt(
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

  /**
   * §5.13 (M) v4.66 — 명패 프레임 치수는 전부 버블 크기에서 비례로 뽑는다.
   *
   * 버블을 1/3(80×50)로 줄인 뒤에도 퍼포레이션 띠·아이콘·글자가 서로를 밀어내지 않아야
   * 한다. `dense` 는 "글자 두 줄과 아이콘을 한꺼번에 놓을 자리가 없다"는 뜻이고, 그 아래에서는
   * **덜 중요한 것부터** 뺀다(보조 라벨 → 아이콘). 크기가 커지면 원래 밀도로 돌아온다(§5.4 #36 (G) — 이제 사용자가 키울 수 있다).
   */
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
    <button
      type="button"
      onClick={onClick}
      disabled={opts.disabled === true}
      title={opts.title}
      className={`w-full px-3 py-2 text-left text-sm transition-colors ${
        opts.disabled === true
          ? 'cursor-not-allowed text-gray-500'
          : `hover:bg-gray-800 ${opts.danger === true ? 'text-rose-300' : 'text-gray-200'}`
      }`}
    >
      {text}
    </button>
  );

  /**
   * 우클릭 메뉴 — 등록된 앱이든 아니든 **항상 뜬다**.
   *
   * 미등록 앱 버블에서 메뉴가 안 뜨면 그 버블은 지울 방법이 없다(가장 지우고 싶은 버블인데도).
   * 고정·삭제는 앱을 몰라도 되는 조작이라 두 경우가 공유하고, 열기·설치·이름 바꾸기만 앱이
   * 있을 때 붙는다. §5.4 #36 (G) — [기본 크기로] 는 지금 형태에서 크기를 정했을 때만.
   */
  const menuPortal = menu
    ? createPortal(
        <div
          ref={menuRef}
          className="fixed z-[60] min-w-44 rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl shadow-black/40"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
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
          <div className="mx-2 my-1 border-t border-gray-700" />
          {/* 핀이 걸린 버블은 서버가 409 로 거절한다(§2.4) — 눌러도 아무 일 없는 대신 이유를 보여 준다. */}
          {menuItem(remove, t('panel.apps.delete', { defaultValue: '삭제' }), {
            danger: true,
            disabled: isPinned,
            ...(isPinned
              ? { title: t('panel.apps.deletePinnedHint', { defaultValue: '고정된 버블입니다. 먼저 고정을 해제하세요.' }) }
              : {}),
          })}
        </div>,
        document.body,
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
  // 이름은 번역이 있으면 번역, 없으면 레지스트리가 선언한 **제품 이름**. `id` 로 떨어뜨리면
  // 로케일이 아직 빈 언어에서 버블에 소문자 식별자가 그대로 찍힌다(v4.66 전까지 그랬다).
  const appName = t(app.nameKey, { defaultValue: app.name });
  // §5.4 #36 (C) — 사용자 제목 → 담긴 결과 파일 이름 → 앱 이름(말풍선의 위성 칩과 같은 규칙 한 벌).
  const label = appNodeLabel({ title: data.title, file: data.file }, appName);

  /**
   * §5.13 (M) v4.60 — 모양은 앱이 정한다. 코어는 원을 그리지 않는다.
   *
   * 커스텀 에이전트 버블이 원이라, 앱 버블까지 원이면 캔버스에서 둘을 가려낼 방법이 없다.
   * 조작 감각(더블클릭 열기 · 우클릭 메뉴 · 드래그)만 같게 두고 형태는 갈라 놓는다.
   */
  const shape: AppBubbleShape = app.bubbleShape ?? 'plate';
  const isFilm = shape === 'film';

  /**
   * §5.4 #36 (G) — 크기 손잡이. 고른 노드에만 뜨고, 위성줄을 받을 참일 때는 숨긴다(무엇에 이어질지가 먼저다).
   * 손잡이는 네모다 — 둥근 공 손잡이 ❌("동글동글" 지적). 하한·상한은 형태마다(`APP_NODE_RESIZE`).
   * §6 — **지금 고른 하나**(클릭해 우측 패널이 보는 노드)에만 뜬다. 여럿을 묶어 골랐을 때 노드마다 네모 손잡이가
   * 서면 묶음 표시가 손잡이에 묻힌다 — 묶음 안 노드는 고른 테두리만 낸다.
   */
  const resizer = (
    <NodeResizer
      isVisible={chosenHere && !dropColor}
      minWidth={bounds.minWidth}
      minHeight={bounds.minHeight}
      maxWidth={bounds.maxWidth}
      maxHeight={bounds.maxHeight}
      onResizeStart={handleResizeStart}
      onResize={handleResize}
      onResizeEnd={handleResizeEnd}
      lineClassName="!border-white/35"
      handleClassName="!h-2 !w-2 !rounded-none !border !border-white !bg-[#0A0C12]"
    />
  );

  /**
   * §5.4 #36 (G) — **화면**(앱 위성). 컴팩트한 판 하나 — 22px 머리줄(앱 색 바탕: 앱 아이콘 · 이름 · 고정 표식 ·
   * [에디터에서 열기]) · 결과(어두운 바탕). 결과가 담겼으면 그 안쪽을 앱이 그린다(`canvasFace` — 아래 조작줄까지).
   * 머리줄은 앱 안 창의 제목 줄을 줄인 것이다 — 이름이 프레임 **안**에 있어 참고 화면의 바깥 이름표((D))와 다르다.
   * 스프링 눌림(`bubble-press`)을 쓰지 않는다 — 안쪽 조작 단추를 누를 때 노드 전체가 줄어든다.
   */
  if (isScreen) {
    const openLabel = t('panel.fileEdit.openInEditor', { defaultValue: '에디터에서 열기' });
    const screenStyle: React.CSSProperties = {
      width: data.width,
      height: data.height,
      border: `${SCREEN_BORDER}px solid`,
      borderColor: isSelected ? '#FFFFFF' : `${app.glow}59`,
      background: '#07090D',
      // 선택 링은 흰 테 + 바깥 헤일로 두 겹(v4.68) — 컴팩트하게 얇게. 위성줄을 받을 참이면 에이전트 색 두 겹.
      boxShadow: isSelected && !dropColor
        ? `0 0 0 1px #FFFFFF, 0 0 0 4px ${app.glow}4D, 0 6px 18px rgba(0,0,0,0.55)`
        : dropColor
          ? `0 0 0 1px ${dropColor}, 0 0 0 4px ${dropColor}40, 0 6px 18px rgba(0,0,0,0.55)`
          : '0 4px 14px rgba(0,0,0,0.5)',
    };
    return (
      <>
        {resizer}
        <div
          {...gesture.handlers}
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

  /**
   * 명패 — 놓아 둔 앱. §5.4 #36 (G) 컴팩트한 언어: 4px 모서리 · 1px 테 · 평평한 앱 색 · 네모 퍼포레이션(클래퍼 사선 ❌).
   * 안쪽 조작이 없으니 눌림 반응(`bubble-press`)은 남긴다 — 다른 버블과 같은 손끝 감각.
   */
  const borderColor = isSelected ? '#FFFFFF' : `${app.glow}80`;
  const shellStyle: React.CSSProperties = {
    width: data.width,
    height: data.height,
    border: '1px solid',
    borderColor,
    // 구(球)로 보이는 방사형 그라디언트 ❌ — 그게 에이전트 버블의 인상이다. 평면 판으로.
    background: app.color,
    // 색 번짐(bloom) ❌ — 그 인상이 곧 "장난감"이다. 선택 링만 앱 색으로, 평시엔 그림자로 띄운다.
    //   선택 링은 **흰 테 + 바깥 헤일로 두 겹**이다(v4.68). 작게 줄인 버블에서는 테두리 색만
    //   흰색으로 바뀌어서는 "선택됐다"가 눈에 안 들어온다 — 다른 버블처럼 바깥으로 한 겹 더 나간다.
    //   box-shadow 는 자기 박스 밖에 그려지므로 `overflow-hidden` 에 잘리지 않는다.
    //   위성줄을 받을 참이면(§5.4 #36 (B)) 선택 링 대신 에이전트 색 두 겹 — 무엇에 이어질지가 먼저다.
    boxShadow: isSelected && !dropColor
      ? `0 0 0 1px #FFFFFF, 0 0 0 ${dense ? 3 : 4}px ${app.glow}59, 0 4px 14px rgba(0,0,0,0.5)`
      : dropColor
        ? `0 0 0 1px ${dropColor}, 0 0 0 ${dense ? 3 : 4}px ${dropColor}40, 0 4px 14px rgba(0,0,0,0.5)`
        : '0 3px 10px rgba(0,0,0,0.45)',
  };

  /**
   * 보조 라벨 — **덧붙일 말이 있을 때만** 나온다.
   *
   * 여기는 바로 윗줄의 앱 이름을 **대문자로 한 번 더** 쓰던 자리였다. 같은 말을 두 번 하는 것은
   * 정보가 아니라 장식이고, 1/3 로 줄인 프레임에서는 자리마저 없다. 이제 **이름을 바꾼 버블**만
   * 이 줄을 쓴다(그 버블이 원래 어떤 앱인지).
   */
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
