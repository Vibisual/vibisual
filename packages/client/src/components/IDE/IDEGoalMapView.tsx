/**
 * §5.5 #17-17 ⑪·⑫·⑭·⑰ — **살아 있는 단계 지도.** ⑭ 로 무대의 **몸통 전부**가 됐다.
 *
 * ④ 의 `w-52` 사이드바 체크리스트는 "몇 개 남았나"는 답하지만 "지금 무슨 성격의 일을 하는
 * 중인가"는 답하지 못한다. 이 뷰는 그 답을 그린다 — 단계 하나가 노드, 순서가 엣지, 좌측에
 * 종류 색 레인, `done` 은 취소선, `in_progress` 는 맥동, `low` 확신은 빗금.
 *
 * ⑪(j) — 카메라가 **도는 단계를 따라간다.** 프로그램이 옮긴 화면은 추종을 끄지 않고, 사용자가
 * 손으로 끌거나 확대했을 때만 끈다 — 둘을 구분하지 못하면 이 기능은 첫 회에 스스로 죽는다.
 *
 * ⑭(c) — **조작 창구는 우클릭 하나다.** 빈 자리에서 우클릭하면 노드 메뉴가 뜨고 고른 것이 누른
 * 그 자리에 선다(흐름 템플릿·배운 행동·종류·직접 쓰기·설치 스킬·두뇌 스킬). 노드 위에서 우클릭하면
 * 그 단계의 메뉴다(비추기·나란히 놓기·종류 바꾸기). 걷어낸 세 칸(⑭(a))이 하던 일이 전부 여기로 들어왔다.
 *
 * ⑭(d) — **자유 배치.** 노드는 x·y 어디로든 가고 놓인 자리는 그대로 남는다(클라 로컬 저장 —
 * 서버 페이로드에 실리는 것은 여전히 **순서뿐**이다).
 *
 * ⑳ — **자리는 자리고, 흐름은 선이다.** 끌어 놓는 것은 자리만 바꾼다. 차례는 노드 아래 **핀(작은 원)** 을
 * 끌어 다른 단계의 위 핀에 꽂을 때만 바뀐다 — 꽂힌 단계가 그 단계 **바로 다음**에 선다(블루프린트의
 * 실행 선). 이미 그려진 선의 끝을 잡아 다른 단계로 옮겨 꽂아도 같은 일이다. 판정은 `goalDropTarget.ts`
 * 의 순수 함수 한 벌(`wireAfter`) — 종전의 "세로가 차례를 정한다"는 없다(보기 좋게 옮긴 손짓이
 * 실행을 바꿔 버렸다 — 사용자 지시 "이동 시킨게 바로 바로 연결되서 실행을 바꾸는게 아니라").
 *
 * ㉖(h)-3 — **끊은 것은 끊긴 채로 남는다.** 무대의 선은 두 원천에서 온다(차례가 그리는 팬아웃·팬인 +
 * 사용자가 그은 `goalWires`). 끊기가 그은 목록에서만 빼던 동안, 차례는 같은 선을 매 프레임 도로 그렸다
 * — 끊어도 화면이 그대로였다. 그래서 **끊은 자리를 기억하는 목록**(`goalCuts`)을 두고 두 원천 모두에서
 * 뺀다. 종전의 행 합치기(`breakAt`)는 걷었다 — 합치면 팬아웃이 **방금 끊은 그 핀에** 새 선을 도로 그린다.
 * 끊기는 차례를 건드리지 않는다(서버 왕복 ❌) — 나란히(병렬)로 만드는 손잡이는 [나란히 놓기]다.
 *
 * ⑰(a) — **나란히 = 병렬.** 행은 순서 위에 얹힌 표식 하나(`parallel`)다. 엣지는 행 단위 팬아웃·팬인이라
 * "이것들이 끝나야 저것이 시작된다"가 선으로 읽힌다. 행에 붙이고 떼는 손잡이는 노드 메뉴와 우클릭
 * 끼워 넣기(노드 옆이면 한 행)다 — ⑳ 뒤로 끌어 옆에 놓는 것은 행을 만들지 않는다.
 *
 * 렌더러를 새로 만들지 않는다 — 캔버스가 쓰는 React Flow 를 그대로 쓴다.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ReactFlow,
  Background,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  Handle,
  Position,
} from '@xyflow/react';
import {
  resolveSkillPluginState,
  type AvailableSkill,
  type AutoGoalSkillSummary,
  type GoalActionCard,
  type GoalFlowTemplate,
  type SessionGoalStep,
  type VisualKindCard,
} from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useIDEPaneValue } from './idePane.js';
import { CanvasZoomControls } from '../BubbleMap/canvasControlKit.js';
import { KindGlyph, SceneArt, StepMark, KIND_NEUTRAL } from './StageGlyph.js';
// ⑰(d) — 설치된 스킬은 사이드바·자동완성과 **같은 훅**(캐시·구독 공유)에서 온다.
import { useAvailableSkills } from '../../hooks/useAvailableSkills.js';
// ㉖(h)-2 — 단축키 **표시**는 플랫폼이 정한다(mac 은 ⌘). 판정은 `ctrlKey || metaKey` 한 줄이다.
import { shortcutLabel } from '../../utils/platform.js';
// ⑳(g) — 잰 치수를 노드에 도로 실어 주는 한 겹. 없으면 목록이 갱신될 때마다 **선이 사라진다**(훅 주석).
import { useMeasuredFlowNodes } from '../../hooks/useMeasuredFlowNodes.js';
// §5.5 #17-17 ⑫(c)·⑭(c)(d)·⑰(a)·⑳ — 자리와 선을 뜻으로 바꾸는 판정은 순수 모듈 한 곳에 있다.
import {
  NEW_POINT_ID,
  addWire,
  canBreakAt,
  derivePositions,
  drawableWires,
  hasOutgoing,
  isCut,
  placeNewAt,
  removeWire,
  rowWires,
  rowWiresAt,
  wireAfter,
  type GoalNodePoint,
  type GoalPinSide,
  type GoalRowEntry,
  type GoalWire,
} from './goalDropTarget.js';
import { StageCanvasMenu, type StageMenuAnchor } from './StageCanvasMenu.js';

/** 노드 하나가 나르는 것 — 단계 + 그 단계가 가리키는 종류 카드. */
type StepNodeData = {
  step: SessionGoalStep;
  kind?: VisualKindCard;
  selected: boolean;
  /** ⑰(a) — 앞 단계와 같은 행(첫 단계는 언제나 `false`). */
  parallel: boolean;
  onOpen: (id: string) => void;
  /** ㉖(h) — 핀에서 `Ctrl`(⌘)+클릭. 그 핀에 걸린 선이 끊긴다. */
  onBreakPin: (id: string, side: GoalPinSide) => void;
  /** ㉖(h) — 핀에서 우클릭. [끊기] 한 칸이 있는 메뉴가 그 자리에 뜬다. */
  onPinMenu: (clientX: number, clientY: number, id: string, side: GoalPinSide) => void;
};

/** 서버로 보내는 단계 한 칸 — 좌표는 없고 순서·표식만(⑭(d)·⑰(a)). */
type StepPayload = {
  text: string;
  status: SessionGoalStep['status'];
  kind?: string;
  confidence?: 'high' | 'low';
  parallel?: boolean;
};

const NODE_W = 210;
const NODE_H = 64;
const GAP_Y = 92;
const NODE_X = 40;
/** ⑰(a) — 같은 행의 노드 사이 가로 간격. */
const GAP_X = 28;
/** ⑰(a)② — 우클릭 자리가 노드 **옆**(같은 행)으로 읽히는 가운데 높이 차(노드 높이의 절반). */
const PARALLEL_BAND = NODE_H / 2;

/**
 * ⑳ — **핀과 선 끌기.** 노드 위·아래의 작은 원이 핀이고, 선은 핀에서 핀으로만 이어진다.
 *
 * - `CONNECT_RADIUS` — 끌던 선이 핀에 **달라붙는** 거리(흐름 좌표). React Flow 기본 10 은 10px 짜리 핀
 *   위에 정확히 놓아야 해서 손이 자주 빗나간다. 노드 높이의 절반쯤이면 "그 노드 위쪽에 놓았다"가 곧 연결이다.
 * - `RECONNECT_RADIUS` — 이미 그려진 선의 **끝**을 잡을 수 있는 반지름. 이 원이 "선 끝의 작은 원"이다 —
 *   잡아서 다른 단계에 옮겨 꽂으면 새로 잇는 것과 같은 일이 된다(`applyWire` 한 곳).
 * - `DASH` — 끌고 가는 동안의 점선 간격. 화면 좌표로 못 박는다(⑱ 과 같은 이유).
 */
const STAGE_WIRE = {
  CONNECT_RADIUS: 32,
  RECONNECT_RADIUS: 12,
  DASH: 5,
  /** 핀 기본 색 — 선(`STAGE_EDGE.COLOR`)과 같은 계열 한 단 위라 선 끝이 원으로 맺힌 것으로 읽힌다. */
  PIN_COLOR: '#94A3B8',
} as const;

/**
 * ⑳ — 핀의 생김새. React Flow 기본 핸들(6px · 검정)은 어두운 무대에서 보이지 않아 "잡을 것"으로 읽히지
 * 않는다. 노드 테두리 색 위에 뜨는 10px 원 + 무대 배경색 테두리로 노드에서 떠 보이게 한다. 크기·모양은
 * 라이브러리 CSS 를 이겨야 해서 `!` 접두다(같은 파일의 `!mb-8` 과 같은 사정). 색은 종류 색을 빌리므로
 * 클래스가 아니라 인라인 값이다.
 */
const PIN_CLASS = '!h-2.5 !w-2.5 !rounded-full !border-2 !border-gray-950 transition-colors hover:!border-white';

/**
 * ⑱ — **흐름 선.** 종전에는 아무 값도 주지 않아 React Flow 기본값(`#b1b1b7` · 1px)이 그대로 나갔고,
 * 그 1px 은 **흐름 좌표**라 화면 굵기가 줌 배율에 곱해졌다 — `fitView` 로 배율이 0.6 쯤 내려가는
 * 흔한 상태에서 선이 0.6px 이 되어 어두운 무대 위에서 사실상 사라졌다(사용자 지적 "확대 축소
 * 때문인지 여기 선들이 잘 안 보여"). 점선(`stroke-dasharray: 5`)도 같이 줄어 진행 표시까지 뭉갰다.
 *
 * `vector-effect: non-scaling-stroke` 는 굵기·점선 간격을 **화면 좌표**로 못 박는다 — 어느 배율에서도
 * 같은 굵기다. 줌을 구독해 매번 다시 계산하는 방법도 있지만, 그러면 확대·축소하는 내내 선 전부가
 * 다시 그려진다. 여기서는 CSS 한 줄이 같은 일을 공짜로 한다.
 */
const STAGE_EDGE = {
  /** 평상시 선 — 노드 테두리(gray-700)보다 밝아 눈에 걸리고, `KIND_NEUTRAL` 보다는 한 단 아래라 선이 노드를 이기지 않는다. */
  COLOR: '#64748B',
  WIDTH: 1.8,
  /** 지금 도는 단계로 **들어가는** 선. 색은 그 단계의 종류 색을 그대로 빌린다(새 색 ❌ — 노드 테두리와 같은 색이라 눈이 잇는다). */
  WIDTH_RUNNING: 2.4,
} as const;

/**
 * ⑳(f) — **끄는 손짓의 상수.**
 *
 * - `THRESHOLD` — 이만큼(화면 px) 움직여야 "끈 것"이다. 그 아래는 누른 것으로 읽어 단계를 비춘다
 *   (노드가 클릭으로 여는 카드이기도 해서 이 문턱이 없으면 비추려던 손이 노드를 1px 씩 옮긴다).
 */
const STAGE_DRAG = {
  THRESHOLD: 4,
} as const;

/**
 * ⑳(g) — 카드의 치수. 인라인 `style` 로 못 박은 값이라 **재기 전에도 우리가 아는 값**이다.
 * 이걸 노드에 실어 보내면 React Flow 가 첫 프레임부터 손잡이 치수를 지키므로 선이 깜빡이지 않는다
 * (모듈 상수여야 한다 — 매 렌더 새 객체를 만들면 그만큼 헛렌더가 는다).
 */
const NODE_SIZE = { width: NODE_W, height: NODE_H };

/** ㉖(c) — 선을 하나도 긋지 않은 세션이 매 렌더 새 빈 배열을 받지 않도록(그것만으로 memo 가 깨진다). */
const NO_WIRES: GoalWire[] = [];

/** 판정이 낸 행 표식으로 덮어쓴다 — 사용자 문에서는 **자리가 진실**이다(⑰(a)). */
function withRow(p: StepPayload, parallel: boolean): StepPayload {
  const { parallel: _old, ...rest } = p;
  return parallel ? { ...rest, parallel: true } : rest;
}

/**
 * ㉖(h) — **핀에서 끊는 손짓 한 벌.** 두 핀이 같은 규약을 쓰므로 한 자리에서 만든다.
 *
 * - `mousedown` — `Ctrl`(⌘)을 누른 채면 **삼킨다.** 안 그러면 React Flow 가 그 누름을 "선을 끌기
 *   시작했다"로 읽어, 끊으려던 손이 새 선을 끌고 다닌다. 누르지 않았으면 종전대로 흘려보낸다.
 * - `click` — `Ctrl`(⌘)+클릭이면 끊는다. 판정은 `ctrlKey || metaKey` 한 줄이라 Windows·Linux 는
 *   `Ctrl`, macOS 는 `⌘` 다(멀티플랫폼 5축). 노드의 `onClick`(카드 열기)으로 번지지 않게 막는다.
 * - `contextmenu` — 핀 메뉴. macOS 의 `Ctrl`+클릭은 OS 가 이 이벤트를 내므로 **그쪽으로도 끊을
 *   길이 있다**(위 `click` 은 그때 오지 않는다).
 */
function pinBreakHandlers(
  stepId: string,
  side: GoalPinSide,
  onBreakPin: StepNodeData['onBreakPin'],
  onPinMenu: StepNodeData['onPinMenu'],
): Pick<React.HTMLAttributes<HTMLDivElement>, 'onMouseDown' | 'onClick' | 'onContextMenu'> {
  return {
    onMouseDown: (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    onClick: (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      onBreakPin(stepId, side);
    },
    onContextMenu: (e) => {
      e.preventDefault();
      e.stopPropagation();
      onPinMenu(e.clientX, e.clientY, stepId, side);
    },
  };
}

/**
 * ⑪(f)(n)·⑰(a) — 단계 노드.
 *
 * 종전에는 회색 상자 안에 작은 글리프 하나라 스무 개가 전부 같은 모양이었다. 이제 **종류 색이
 * 칸을 차지한다** — 왼쪽 색 레인 + 옅은 색 밑칠 + 오른쪽에 장면 워터마크. 그래야 지도를 훑는 것만으로
 * "여기까지가 찾기고 여기부터가 고치기"가 읽힌다. 나란히 놓인 노드는 오른쪽 위에 `∥`.
 */
function StepNode({ data }: NodeProps): React.JSX.Element {
  const { t } = useTranslation();
  const { step, kind, selected, parallel, onOpen, onBreakPin, onPinMenu } = data as unknown as StepNodeData;
  const done = step.status === 'done';
  const running = step.status === 'in_progress';
  const low = step.confidence === 'low';
  const byUser = step.authoredBy === 'user';
  const color = kind?.color ?? KIND_NEUTRAL;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(step.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(step.id);
        }
      }}
      style={{
        width: NODE_W,
        height: NODE_H,
        borderColor: running || selected ? color : undefined,
        backgroundColor: done ? undefined : `${color}12`,
      }}
      className={[
        'relative flex cursor-pointer items-center gap-2 overflow-hidden rounded-lg border bg-gray-900/90 pl-0 pr-2 text-left outline-none transition-colors',
        low ? 'border-dashed' : 'border-solid',
        running ? 'animate-pulse border-2' : 'border-gray-700 hover:border-gray-500',
        // ⑪(j) — 무대가 지금 비추고 있는 단계. 도는 단계와 **다른 표시**여야 한다(맥동 vs 고리) —
        //   같은 표시를 쓰면 "돌고 있어서 켜진 것"인지 "내가 눌러서 켜진 것"인지 구분되지 않는다.
        selected ? 'ring-2 ring-offset-1 ring-offset-gray-950' : '',
        byUser ? 'ring-1 ring-sky-500/60' : '',
      ].join(' ')}
    >
      {/* ⑳·㉖(h) — 핀. 위는 들어오는 선, 아래는 나가는 선의 자리다. 끌어서 다른 단계의 핀에 꽂고,
          `Ctrl`(⌘)+클릭하거나 우클릭해서 끊는다. */}
      <Handle
        type="target"
        position={Position.Top}
        title={t('ide.stage.pin.in', { shortcut: shortcutLabel('Ctrl') })}
        className={PIN_CLASS}
        style={{ backgroundColor: running || selected ? color : STAGE_WIRE.PIN_COLOR }}
        {...pinBreakHandlers(step.id, 'in', onBreakPin, onPinMenu)}
      />
      {/* 종류 레인 — 색이 칸을 차지한다(글리프 하나로는 git 과 언리얼이 같은 점이다, ⑪(i)). */}
      <span className="h-full w-1 flex-shrink-0" style={{ backgroundColor: done ? '#4B5563' : color }} aria-hidden />
      {/* 장면 워터마크 — 이 단계가 무슨 그림의 일인지 배경으로 말한다. */}
      {kind?.scene && (
        <span className="pointer-events-none absolute -right-2 -top-2 select-none" aria-hidden>
          <SceneArt card={kind} className="h-16 w-16" muted={done} opacity={0.12} />
        </span>
      )}
      {/* ⑰(a) — 나란히 놓인 표식. 사이드바의 같은 그림과 짝이다(같은 뜻은 같은 그림). */}
      {parallel && (
        <span
          className="absolute right-1 top-0.5 flex items-center text-violet-300"
          title={t('ide.stage.parallel.badge')}
          aria-label={t('ide.stage.parallel.badge')}
          role="img"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-3 w-3" aria-hidden>
            <path d="M9 4v16M15 4v16" />
          </svg>
        </span>
      )}
      <StepMark status={step.status} color={color} className="ml-1.5 h-3.5 w-3.5 flex-shrink-0" />
      <span className="relative flex min-w-0 flex-1 flex-col">
        <span
          className={[
            'truncate text-[12px] leading-tight',
            done ? 'text-gray-500 line-through' : 'text-gray-100',
          ].join(' ')}
        >
          {step.text}
        </span>
        {/* 종류 이름은 본문보다 한 단 아래 — 크기를 줄이지 않고 색으로 위계를 만든다(§9 가독 하한). */}
        {kind && (
          <span className="flex items-center gap-1 truncate text-[12px] leading-tight text-gray-500">
            <KindGlyph card={kind} className="h-3 w-3 flex-shrink-0" muted={done} />
            {kind.label}
          </span>
        )}
      </span>
      <Handle
        type="source"
        position={Position.Bottom}
        title={t('ide.stage.pin.out', { shortcut: shortcutLabel('Ctrl') })}
        className={PIN_CLASS}
        style={{ backgroundColor: running || selected ? color : STAGE_WIRE.PIN_COLOR }}
        {...pinBreakHandlers(step.id, 'out', onBreakPin, onPinMenu)}
      />
    </div>
  );
}

const nodeTypes = { goalStep: StepNode };

/**
 * ⑪(j) — **카메라가 비출 단계를 따라간다.** `<ReactFlow>` 의 자식이라야 `useReactFlow` 가 그 인스턴스를
 * 잡으므로 이 조각으로 뺐다(부모에서 부르면 컨텍스트 밖이다).
 *
 * 추종이 꺼져 있으면 아무것도 하지 않는다. 같은 단계로 두 번 옮기지 않는다 — 옮길 때마다 애니메이션이
 * 다시 시작되면 화면이 미세하게 계속 떨린다. ⑭(d) 로 자리가 자유로워졌으므로 **그 노드의 실제 좌표**로
 * 간다(격자 산식으로 계산하면 손으로 옮긴 노드를 비출 때 엉뚱한 빈 곳을 비춘다).
 */
function StageCamera({
  focusId,
  focusPos,
  follow,
}: {
  focusId: string | null;
  focusPos: { x: number; y: number } | null;
  follow: boolean;
}): null {
  const { setCenter } = useReactFlow();
  const lastRef = useRef<string | null>(null);

  useEffect(() => {
    if (!follow || !focusId || !focusPos) {
      lastRef.current = null;
      return;
    }
    if (lastRef.current === focusId) return;
    lastRef.current = focusId;
    setCenter(focusPos.x + NODE_W / 2, focusPos.y + NODE_H / 2, { zoom: 1, duration: 400 });
  }, [focusId, focusPos, follow, setCenter]);

  return null;
}

export interface IDEGoalMapViewProps {
  agentId: string;
  /** 무대가 지금 비추는 단계(고리로 표시). */
  selectedStepId: string | null;
  onSelectStep: (id: string) => void;
  /** ⑪(j) — 도는 단계를 카메라가 따라가는가. */
  follow: boolean;
  /** ⑪(j) — **사용자 제스처**로 화면이 움직였다(프로그램 이동은 여기로 오지 않는다). */
  onUserMove: () => void;
}

export function IDEGoalMapView({
  agentId,
  selectedStepId,
  onSelectStep,
  follow,
  onUserMove,
}: IDEGoalMapViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const activeSessionId = useIDEPaneValue((o) => o.activeSessionId);
  const goal = useGraphStore((s) => (activeSessionId ? s.sessionGoals[activeSessionId] : undefined));
  const visualKinds = useGraphStore((s) => s.visualKinds);
  const setUserGoalSteps = useGraphStore((s) => s.setUserGoalSteps);
  // ⑫(c) — 노드 위에서는 **종류만** 바꾸는 좁은 문으로 간다(넓은 문은 목록을 통째로
  //   사용자 소유로 박는다 — ⑪(i) 가 경계한 그 함정).
  const setGoalStepKind = useGraphStore((s) => s.setGoalStepKind);
  // ⑭(c) — 걷어낸 종류 서랍(⑪(i))·행동 팔레트(⑫(a))의 일이 우클릭 메뉴로 들어왔다.
  const setVisualKindPinned = useGraphStore((s) => s.setVisualKindPinned);
  const setVisualKindTrashed = useGraphStore((s) => s.setVisualKindTrashed);
  const goalActions = useGraphStore((s) => s.goalActions);
  const setGoalActionPinned = useGraphStore((s) => s.setGoalActionPinned);
  // ⑭(d) — 손으로 놓은 자리(세션 단위). 없는 노드는 파생 배치를 쓴다.
  const layout = useGraphStore((s) => (activeSessionId ? s.goalNodeLayout[activeSessionId] : undefined));
  const setGoalNodePosition = useGraphStore((s) => s.setGoalNodePosition);
  const forgetGoalNodePosition = useGraphStore((s) => s.forgetGoalNodePosition);
  const clearGoalNodeLayout = useGraphStore((s) => s.clearGoalNodeLayout);
  // ㉖(c) — **사용자가 그은 선**. 무대에 그려지는 선은 이것뿐이다(차례에서 짓지 않는다).
  const wires = useGraphStore((s) => (activeSessionId ? s.goalWires[activeSessionId] : undefined)) ?? NO_WIRES;
  const addGoalWire = useGraphStore((s) => s.addGoalWire);
  const removeGoalWire = useGraphStore((s) => s.removeGoalWire);
  const clearGoalWiresOf = useGraphStore((s) => s.clearGoalWiresOf);
  const pruneGoalWires = useGraphStore((s) => s.pruneGoalWires);
  // ㉖(h)-3 — **사용자가 끊은 자리.** 그은 선의 대칭 축이다 — 차례가 그리는 선은 여기 적힌 쌍만 빠진다.
  const cuts = useGraphStore((s) => (activeSessionId ? s.goalCuts[activeSessionId] : undefined)) ?? NO_WIRES;
  const addGoalCut = useGraphStore((s) => s.addGoalCut);
  const addGoalCuts = useGraphStore((s) => s.addGoalCuts);
  const removeGoalCut = useGraphStore((s) => s.removeGoalCut);
  const pruneGoalCuts = useGraphStore((s) => s.pruneGoalCuts);
  // ⑰(d) — 팔레트의 두 원천. 설치 스킬은 이미 있는 훅, 두뇌 스킬은 메뉴를 열 때만 기존 REST.
  //   둘 다 스냅샷에 싣지 않는다 — 메뉴를 열 때만 필요한 목록을 매 프레임 전선에 태울 이유가 없다.
  const projectName = useGraphStore((s) => s.agentProjects[agentId]);
  const { skills: installedSkills } = useAvailableSkills(projectName, agentId);
  const readySkills = useMemo(
    () => installedSkills.filter((s) => {
      // #17-33 ⑦ — 이 세션에서 실제로 풀리는 것만 세운다. 고르면 안 먹는 칸은 없는 칸보다 나쁘다.
      const state = resolveSkillPluginState(s);
      return state === 'ready' || state === 'unknown';
    }),
    [installedSkills],
  );
  const [autoGoalSkills, setAutoGoalSkills] = useState<AutoGoalSkillSummary[]>([]);

  const steps = useMemo(() => goal?.steps ?? [], [goal]);
  /** 목록을 고칠 수 있는가 — 착지할 문이 열려 있어야 메뉴가 뜻을 갖는다. */
  const canEdit = !!activeSessionId && !!goal;

  /** ⑫(c)·⑭(c) — 화면 좌표를 캔버스 좌표로 옮기려면 인스턴스가 필요하다. */
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const [menu, setMenu] = useState<StageMenuAnchor | null>(null);

  /*
   * ⑲ — 빈 자리 메뉴가 열릴 때만 자동 목표 스킬을 묻는다.
   *
   * **꺼진 프로젝트에서도 목록은 온다** — 그동안 굳은 절차는 껐다고 사라지지 않기 때문이다(서버
   * `/api/auto-goal/state` 의 계약). 아무것도 없으면 메뉴가 "아직 자란 절차가 없다"고 말한다.
   *
   * 조회 키는 **경로**다(표시명 ❌) — 표시명은 탭에 보이는 이름이라 같은 폴더가 다른 이름으로 뜰 수
   * 있고, 그러면 서버가 저장고를 못 찾아 빈 목록이 온다.
   */
  const projectPath = useGraphStore((s) => (projectName
    ? s.projects[projectName]?.path ?? s.stubProjects[projectName]?.project.path ?? null
    : null));
  const paneMenuOpen = !!menu && !menu.stepId;
  useEffect(() => {
    if (!paneMenuOpen || !projectPath) return undefined;
    let cancelled = false;
    const params = new URLSearchParams({ projectPath, agentId });
    if (activeSessionId) params.set('subAgentId', activeSessionId);
    void fetch(`/api/auto-goal/state?${params.toString()}`)
      .then(async (res) => (res.ok
        ? (((await res.json()) as { state?: { skills?: AutoGoalSkillSummary[] } }).state?.skills ?? [])
        : []))
      .catch(() => [] as AutoGoalSkillSummary[])
      .then((list) => { if (!cancelled) setAutoGoalSkills(list); });
    return () => { cancelled = true; };
  }, [paneMenuOpen, projectPath, agentId, activeSessionId]);

  /**
   * ⑪(f)·⑭(d)·⑰(a)·⑲(c) — 노드마다 지금 자리. 손댄 적 있으면 그 자리, 없으면 파생 배치.
   * 산식은 순수 모듈에 있다(`derivePositions`) — 겹침 규칙은 DOM 없이 시험할 수 있어야 한다.
   */
  const positions = useMemo(
    () => derivePositions(steps, layout, { nodeW: NODE_W, nodeH: NODE_H, gapX: GAP_X, gapY: GAP_Y, originX: NODE_X }),
    [steps, layout],
  );
  /**
   * ⑳(f) — **끄는 동안의 자리.** 저장이 아니라 **화면**이다 — 손을 떼는 순간 로컬 저장(`goalNodeLayout`)으로 넘어간다.
   *
   * React Flow v12 는 controlled 모드(`nodes` prop)에서 드래그 좌표를 자기 store 에 넣지 않고
   * `onNodesChange` 로만 흘려보낸다. 이 무대에는 그 핸들러가 없었으므로 매 프레임 좌표가 **조용히
   * 버려졌고**, 노드는 손을 따라오지 않고 제자리에 붙어 있다가 놓는 순간 그 자리로 순간이동했다
   * (사용자 지적 "드래그할때 자연스럽게 마우스에 붙이란 말야"). 캔버스의 store 기반 버블(§5.13 앱 버블)이
   * 겪은 것과 **같은 함정**이고 푸는 법도 같다 — 매 프레임 낙관 반영 + 놓을 때 저장.
   *
   * 이 값이 파생·저장 좌표를 이기므로(아래 `positionOf`) 끄는 도중 도착한 스냅샷이 손을 되돌리지 못한다
   * — 끄는 노드에 대해서는 이것이 곧 드래그 락이다.
   */
  const [dragPos, setDragPos] = useState<Record<string, { x: number; y: number }> | null>(null);
  /** 세션이 바뀌면 끌던 자리는 버린다 — 다른 목록의 id 에 옛 좌표가 얹히지 않게. */
  useEffect(() => { setDragPos(null); }, [activeSessionId]);
  const positionOf = useCallback(
    (stepId: string) => dragPos?.[stepId] ?? positions.get(stepId) ?? { x: NODE_X, y: 0 },
    [dragPos, positions],
  );

  /** ⑭(c)(d)·⑰(a) — 순서·행·끼워 넣을 자리 판정이 함께 보는 **노드 가운데 높이**. */
  const points = useMemo<GoalNodePoint[]>(
    () => steps.map((s) => {
      const pos = positionOf(s.id);
      return { id: s.id, x: pos.x, y: pos.y + NODE_H / 2 };
    }),
    [steps, positionOf],
  );

  /**
   * ⑭(c) — **우클릭한 자리에 노드가 선다.** 서버가 id 를 발급하므로 새 단계의 자리는 곧바로
   * 저장할 수 없다 — 본문을 적어 두었다가 그 단계가 스냅샷으로 돌아온 순간 자리를 붙인다.
   * (붙이지 않으면 손으로 배치한 캔버스 한가운데에 파생 좌표로 겹쳐 서서 노드가 사라진 것처럼 보인다.)
   */
  const pendingRef = useRef<{ text: string; x: number; y: number }[]>([]);
  useEffect(() => { pendingRef.current = []; }, [activeSessionId]);
  useEffect(() => {
    if (pendingRef.current.length === 0 || !activeSessionId) return;
    const rest: { text: string; x: number; y: number }[] = [];
    for (const p of pendingRef.current) {
      const hit = steps.find((s) => s.text === p.text && !layout?.[s.id]);
      if (hit) setGoalNodePosition(activeSessionId, hit.id, { x: p.x, y: p.y });
      else rest.push(p);
    }
    pendingRef.current = rest;
  }, [steps, activeSessionId, layout, setGoalNodePosition]);

  /** 지금 목록을 그대로 옮겨 담는다(끼워넣기·템플릿·순서 바꾸기가 공유하는 밑작업). */
  const payloadOf = useCallback(
    (s: SessionGoalStep): StepPayload => ({
      text: s.text,
      status: s.status,
      ...(s.kind ? { kind: s.kind } : {}),
      ...(s.confidence ? { confidence: s.confidence } : {}),
      ...(s.parallel ? { parallel: true } : {}),
    }),
    [],
  );
  const currentPayload = useCallback(() => steps.map(payloadOf), [steps, payloadOf]);

  /** ⑰(a)·⑳ — 지금 목록의 행 표식(순서 + 표식). 선 잇기·끼워 넣기가 같은 밑그림에서 출발한다. */
  const currentRows = useCallback(
    (): GoalRowEntry[] => steps.map((s, i) => ({ id: s.id, parallel: i > 0 && !!s.parallel })),
    [steps],
  );

  /** 행 표식 목록을 서버 페이로드로 옮겨 담는다 — 좌표는 없고 차례·표식만(⑭(d)). */
  const payloadOfRows = useCallback(
    (rows: readonly GoalRowEntry[], fresh?: StepPayload): StepPayload[] => {
      const byId = new Map(steps.map((s) => [s.id, payloadOf(s)] as const));
      const next: StepPayload[] = [];
      for (const e of rows) {
        const p = e.id === NEW_POINT_ID ? fresh : byId.get(e.id);
        if (p) next.push(withRow(p, e.parallel));
      }
      return next;
    },
    [steps, payloadOf],
  );

  /**
   * ⑪(d)·⑭(c)·⑰(a)②·⑳ — 그 자리에 단계를 끼워 넣는다. 사용자 소유라 세션이 지우지 못한다.
   * `at` 이 있으면 누른 캔버스 좌표가 자리를 정한다 — **가장 가까운 노드**의 앞·뒤·옆이다(같은 높이 띠면
   * 한 행). ⑳ 뒤로 좌표는 차례를 말하지 않으므로 목록 전체를 다시 세지 않는다 — 있는 차례는 그대로다.
   */
  const insertStep = useCallback(
    (text: string, at?: { x: number; y: number }, kind?: string) => {
      if (!canEdit || !activeSessionId) return;
      const body = text.trim();
      if (!body) return;
      const fresh: StepPayload = { text: body, status: 'pending', ...(kind ? { kind } : {}) };
      let next: StepPayload[];
      if (at) {
        next = payloadOfRows(placeNewAt(currentRows(), points, { x: at.x, y: at.y + NODE_H / 2 }, PARALLEL_BAND), fresh);
        pendingRef.current = [...pendingRef.current.slice(-7), { text: body, x: at.x, y: at.y }];
      } else {
        next = [...currentPayload(), fresh];
      }
      void setUserGoalSteps({ agentId, subAgentId: activeSessionId, steps: next });
    },
    [canEdit, activeSessionId, agentId, points, currentRows, payloadOfRows, currentPayload, setUserGoalSteps],
  );

  /** 직접 쓰기 — 메뉴의 첫 칸. 우클릭한 자리에 선다. */
  const askAndInsert = useCallback(
    (at: { x: number; y: number }) => {
      const text = window.prompt(t('ide.goalMap.insertPrompt'));
      if (text) insertStep(text, at);
    },
    [insertStep, t],
  );

  /**
   * ⑪(m) — **흐름 템플릿을 깐다.** 꼬리에 붙인다(있던 목록을 지우지 않는다 — 지우는 것은 언제나
   * 사용자가 따로 하는 일이고, 버튼 한 번에 남의 계획이 사라지면 그게 더 나쁘다).
   */
  const applyFlow = useCallback(
    (tpl: GoalFlowTemplate) => {
      if (!canEdit || !activeSessionId) return;
      const next = currentPayload();
      for (const s of tpl.steps) {
        next.push({
          text: t(`ide.stage.flow.${tpl.id}.steps.${s.key}`),
          status: 'pending',
          kind: s.kind,
        });
      }
      void setUserGoalSteps({ agentId, subAgentId: activeSessionId, steps: next });
    },
    [canEdit, activeSessionId, agentId, currentPayload, setUserGoalSteps, t],
  );

  /**
   * ⑭(d)·⑳ — 노드를 끌어 놓으면 **자리만** 남는다. 차례·행은 건드리지 않는다.
   *
   * 종전(⑫(d)·⑰(a)①)에는 놓는 순간 세로 순서로 차례를 다시 판정해 서버로 보냈다 — 보기 좋게 옮긴
   * 손짓이 실행 순서를 바꿔 버렸다. 이제 좌표는 클라 로컬에만 앉고(⑪(f) 의 규율은 전송에 그대로 산다),
   * 차례는 아래 `applyWire`(핀을 끌어 꽂기)로만 바뀐다. 서버 왕복이 없으므로 목록이 사용자 소유로
   * 박히는 문(⑲(a))도 열리지 않는다.
   */
  /**
   * ⑳(f) — **끄는 내내 손을 따라온다.** React Flow 가 매 프레임 흘려보내는 좌표를 그대로 받아 화면
   * 자리에 앉힌다(위 `dragPos` 주석 — 이 한 곳이 없으면 노드는 끄는 내내 제자리에 서 있다).
   * 골라 둔 노드가 여럿이면 `moved` 에 그것들이 함께 온다.
   */
  const onNodeDrag = useCallback(
    (_e: React.MouseEvent, node: Node, moved: Node[]) => {
      const dragged = moved.length > 0 ? moved : [node];
      setDragPos((prev) => {
        // 같은 좌표면 그대로 둔다 — 프레임마다 오는 신호라 여기서 새 객체를 만들면 그만큼 헛되이 다시 그린다.
        const same = prev
          && Object.keys(prev).length === dragged.length
          && dragged.every((n) => prev[n.id]?.x === n.position.x && prev[n.id]?.y === n.position.y);
        if (same) return prev;
        const next: Record<string, { x: number; y: number }> = {};
        for (const n of dragged) next[n.id] = { x: n.position.x, y: n.position.y };
        return next;
      });
    },
    [],
  );

  const onNodeDragStop = useCallback(
    (_e: React.MouseEvent, node: Node, moved: Node[]) => {
      // 화면 자리를 저장으로 넘긴다. 둘은 같은 손짓 안에서 함께 반영되므로 되돌아가는 한 프레임이 없다.
      setDragPos(null);
      if (!canEdit || !activeSessionId) return;
      // 함께 끈 노드가 있으면 전부 앉힌다 — 하나만 저장하면 나머지는 놓자마자 제자리로 튄다.
      for (const n of moved.length > 0 ? moved : [node]) {
        setGoalNodePosition(activeSessionId, n.id, { x: n.position.x, y: n.position.y });
      }
    },
    [canEdit, activeSessionId, setGoalNodePosition],
  );

  /**
   * ⑳ — **선을 잇는다.** `source` 의 아래 핀에서 `target` 의 위 핀으로 — 꽂힌 단계가 그 단계 **바로
   * 다음**에 선다(판정은 `wireAfter`). 새로 끈 선이든, 그려진 선의 끝을 옮겨 꽂은 것이든 같은 문이다.
   * 자리는 그대로 둔다 — 블루프린트가 그렇듯 선은 노드를 옮기지 않는다(손대지 않은 노드의 파생 자리만
   * 새 차례를 따라 흐른다). 보낼 것이 없으면(`null`) 왕복도 없다.
   */
  const applyWire = useCallback(
    (source: string, target: string, base: GoalWire[] = wires) => {
      if (!canEdit || !activeSessionId || source === target) return;
      // ㉖(h)-3 — 같은 쌍을 다시 이으면 **끊은 자리가 먼저 풀린다.** 안 풀면 그어 놓고도 보이지
      //   않는 선이 생긴다 — 끊기를 되돌리는 손잡이는 다시 긋는 이 한 손짓이다.
      removeGoalCut(activeSessionId, source, target);
      // ㉖(c) — 순수 함수가 **같은 배열**을 돌려주면 그을 것이 없다는 뜻이다(중복 · 순환).
      //   그때는 차례도 건드리지 않는다 — 화면에 서지 않은 선이 실행만 바꾸면 그게 더 나쁘다.
      if (addWire(base, source, target) === base) return;
      // ㉖(d) — 이 핀에서 **이미 나가는 선**이 있으면 새 끝은 제 행을 세우지 않고 그 행에 합류한다
      //   (한 핀에서 갈라진 선 여럿 = 동시에 간다). 첫 선이면 종전대로 바로 다음 행에 제 행으로 선다.
      const joinRow = hasOutgoing(base, source, target);
      addGoalWire(activeSessionId, source, target);
      const rows = wireAfter(currentRows(), source, target, { joinRow });
      // 이미 그 자리면 보낼 것이 없다 — 선만 남고 왕복은 없다.
      if (!rows) return;
      void setUserGoalSteps({ agentId, subAgentId: activeSessionId, steps: payloadOfRows(rows) });
    },
    [canEdit, activeSessionId, agentId, wires, addGoalWire, removeGoalCut, currentRows, payloadOfRows, setUserGoalSteps],
  );

  /** ⑳ — 핀에서 핀으로 새 선을 끌어 놓았다. */
  const onConnect = useCallback((c: Connection) => applyWire(c.source, c.target), [applyWire]);

  /**
   * ㉖(e) — 선 끝(작은 원)을 **잡은** 순간. 다른 단계에 꽂히면 `onReconnect` 가 이 표식을 내리고,
   * 빈 자리에서 손을 떼면 표식이 그대로 남아 `onReconnectEnd` 가 그 선을 끊는다(블루프린트에서
   * 연결을 떼는 그 손짓). ⑳(b) 의 "빈 자리에 놓으면 취소"를 **끊기**로 정정한 자리다.
   */
  const reconnectedRef = useRef(true);
  const onReconnectStart = useCallback(() => { reconnectedRef.current = false; }, []);

  /** ⑳·㉖(e) — 그려진 선의 끝을 잡아 다른 단계에 옮겨 꽂았다 — 옛 선을 끊고 새로 잇는다. */
  const onReconnect = useCallback(
    (old: Edge, c: Connection) => {
      reconnectedRef.current = true;
      if (!activeSessionId) return;
      removeGoalWire(activeSessionId, old.source, old.target);
      // ㉖(h)-3 — 떠난 자리는 **끊긴 채로** 남는다. 그은 목록에서만 빼면, 그 쌍이 차례로도 이어져
      //   있을 때(대개 그렇다 — 선을 그으면 차례가 따라 바뀐다) 팬아웃이 같은 자리에 도로 그린다.
      addGoalCut(activeSessionId, old.source, old.target);
      // 합류 판정은 **옛 선을 뺀** 목록으로 — 옮겨 가는 그 선이 자기 자신을 형제로 세지 않게 한다.
      applyWire(c.source, c.target, removeWire(wires, old.source, old.target));
    },
    [activeSessionId, removeGoalWire, addGoalCut, applyWire, wires],
  );

  /**
   * ㉖(e)·(h)-3 — 빈 자리에서 손을 뗐다 = 그 선을 끊는다. 그은 목록에서 빼고 **끊은 자리로 남긴다** —
   * 차례(순서·행)는 건드리지 않는다(끊었다고 목록이 뒤섞이면 ⑲ 의 재발이다).
   */
  const onReconnectEnd = useCallback(
    (_e: MouseEvent | TouchEvent, edge: Edge) => {
      if (reconnectedRef.current) return;
      reconnectedRef.current = true;
      if (!activeSessionId) return;
      removeGoalWire(activeSessionId, edge.source, edge.target);
      addGoalCut(activeSessionId, edge.source, edge.target);
    },
    [activeSessionId, removeGoalWire, addGoalCut],
  );

  /**
   * ㉖(e)·(h)-3 — 노드 메뉴 [선 끊기] — 그 단계에 붙은 선을 전부 걷는다(들어오는 것도 나가는 것도).
   * 그은 선은 목록에서 빠지고, 차례가 그리던 선은 끊은 자리로 남는다 — 둘 다 걷어야 노드 하나가
   * 정말로 **떨어져 선다**(한쪽만 걷으면 남은 쪽이 곧바로 다시 그려져 아무 일도 없던 것처럼 보인다).
   */
  const onClearWires = useCallback(
    (stepId: string) => {
      if (!activeSessionId) return;
      clearGoalWiresOf(activeSessionId, stepId);
      addGoalCuts(activeSessionId, rowWiresAt(currentRows(), stepId));
    },
    [activeSessionId, clearGoalWiresOf, addGoalCuts, currentRows],
  );

  /** ⑳ — 자기 자신에게는 꽂히지 않는다(끌던 선이 제 핀에 달라붙지 않게). */
  const isValidConnection = useCallback((c: Connection | Edge) => c.source !== c.target, []);

  /** ⑭(d) — [자동 정렬]. 저장 좌표를 지우면 ⑪(f) 의 파생 배치가 그대로 돌아온다. */
  const onAutoLayout = useCallback(() => {
    if (activeSessionId) clearGoalNodeLayout(activeSessionId);
    window.setTimeout(() => rfRef.current?.fitView({ duration: 300 }), 0);
  }, [activeSessionId, clearGoalNodeLayout]);

  /**
   * ⑰(a) — [나란히 놓기]/[줄에서 떼기]. 끌 자리가 없는 좁은 무대용 손잡이 — 앞 단계와 붙이고 뗀다.
   * 행은 차례의 일부라 차례 바꾸기와 **같은 문**(사용자 문)으로 간다. 손이 놓은 자리는 지운다 —
   * 붙고 뗀 것이 파생 자리(왼쪽 이웃 옆 / 다음 줄)로 보여야 무슨 일이 일어났는지 읽힌다.
   */
  const onToggleParallel = useCallback(
    (stepId: string, parallel: boolean) => {
      if (!canEdit || !activeSessionId) return;
      const idx = steps.findIndex((s) => s.id === stepId);
      if (idx <= 0) return;
      const next = steps.map((s, i) => withRow(payloadOf(s), i === idx ? parallel : i > 0 && !!s.parallel));
      forgetGoalNodePosition(activeSessionId, stepId);
      void setUserGoalSteps({ agentId, subAgentId: activeSessionId, steps: next });
    },
    [canEdit, activeSessionId, agentId, steps, payloadOf, forgetGoalNodePosition, setUserGoalSteps],
  );

  /**
   * ⑲(b) — **단계 지우기.** ⑪(d) 는 사용자 문을 "끼워 넣기·삭제·순서 바꾸기"라고 적어 두고도
   * 삭제 손잡이를 세운 적이 없다. 그래서 한 번 목록에 들어온 단계는 **뺄 방법이 없었고**, 사용자
   * 소유로 박힌 단계는 세션도 못 지워 라운드가 바뀌어도 영영 남았다(⑲ 가 고친 그 오염의 절반).
   *
   * 되돌릴 수 없는 조작이라 한 번 묻는다 — 세션이 쓴 단계는 다음 신고에 다시 서지만, 사용자가
   * 직접 써 넣은 본문은 여기서 끝이다. 손이 놓은 자리도 함께 잊는다(남으면 죽은 좌표가 된다).
   */
  const onDeleteStep = useCallback(
    (stepId: string) => {
      if (!canEdit || !activeSessionId) return;
      const target = steps.find((s) => s.id === stepId);
      if (!target) return;
      if (!window.confirm(t('ide.stage.menu.deleteStepConfirm', { text: target.text }))) return;
      const next = steps
        .filter((s) => s.id !== stepId)
        .map((s, i) => withRow(payloadOf(s), i > 0 && !!s.parallel));
      forgetGoalNodePosition(activeSessionId, stepId);
      // ㉖(c) — 그릴 수 없게 된 선을 저장고에도 남기지 않는다(같은 id 가 다시 나면 옛 선이 되살아난다).
      clearGoalWiresOf(activeSessionId, stepId);
      void setUserGoalSteps({ agentId, subAgentId: activeSessionId, steps: next });
    },
    [canEdit, activeSessionId, agentId, steps, payloadOf, forgetGoalNodePosition, clearGoalWiresOf, setUserGoalSteps, t],
  );

  /**
   * ㉖(c)·(h)-3 — 목록에서 사라진 단계의 선·끊은 자리를 저장고에서도 걷는다. **빈 목록에서는 걷지
   * 않는다** — 탭을 옮긴 직후처럼 스냅샷이 아직 안 온 한 프레임에 목록이 비어 보이는데, 그때 걷으면
   * 사용자가 그은 선이 통째로 날아간다(영속 상태를 스냅샷으로 청소할 때 늘 나는 그 사고).
   */
  useEffect(() => {
    if (!activeSessionId || steps.length === 0) return;
    const live = steps.map((s) => s.id);
    pruneGoalWires(activeSessionId, live);
    pruneGoalCuts(activeSessionId, live);
  }, [activeSessionId, steps, pruneGoalWires, pruneGoalCuts]);

  /**
   * ⑭(c)·㉖(h) — 우클릭 **세 갈래**. 빈 자리는 노드 메뉴, 노드 위는 그 단계의 메뉴,
   * 핀 위는 그 핀의 메뉴([끊기])다. 규약·검색·닫기는 한 벌 그대로다.
   */
  const openMenuAt = useCallback((clientX: number, clientY: number, stepId?: string, pinSide?: GoalPinSide) => {
    const pos = rfRef.current?.screenToFlowPosition({ x: clientX, y: clientY });
    setMenu({
      screenX: clientX,
      screenY: clientY,
      flowX: pos?.x ?? 0,
      flowY: pos?.y ?? 0,
      ...(stepId ? { stepId } : {}),
      ...(pinSide ? { pinSide } : {}),
    });
  }, []);

  /**
   * ㉖(h)·(h)-3 — **핀에서 끊는다.** 그은 선은 **그 방향의 것만** 걷고(위 핀은 들어오는 선, 아래 핀은
   * 나가는 선), 차례가 그리던 선은 **끊은 자리로 남긴다.** 끊을 것이 없는 핀에서는 아무 일도 없다.
   *
   * 종전(㉖(h)-1)에는 여기서 두 행을 합쳤다(`breakAt`). 그 판정이 사용자가 본 결함을 만들었다 —
   * `[A][B][C][D]` 에서 `C` 의 위 핀을 끊으면 `C` 가 `B` 행에 합류해 `[A][B,C][D]` 가 되고, 팬아웃이
   * `A→C` 를 **방금 끊은 그 핀에** 도로 그린다. 그래서 행을 합치지 않는다 — 끊기는 끊기고, 나란히
   * (병렬)로 만드는 손잡이는 종전대로 노드 메뉴 [나란히 놓기]다. 서버 왕복도 없다(차례 무변).
   */
  const onBreakPin = useCallback(
    (stepId: string, side: GoalPinSide) => {
      if (!canEdit || !activeSessionId) return;
      clearGoalWiresOf(activeSessionId, stepId, side);
      addGoalCuts(activeSessionId, rowWiresAt(currentRows(), stepId, side));
    },
    [canEdit, activeSessionId, clearGoalWiresOf, addGoalCuts, currentRows],
  );

  /** ㉖(h) — 핀 우클릭 — 노드 메뉴와 **같은 창구**로 간다(갈래만 다르다). */
  const onPinMenu = useCallback(
    (clientX: number, clientY: number, stepId: string, side: GoalPinSide) => {
      openMenuAt(clientX, clientY, stepId, side);
    },
    [openMenuAt],
  );

  const onPaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openMenuAt(e.clientX, e.clientY);
  }, [openMenuAt]);

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    e.stopPropagation();
    openMenuAt(e.clientX, e.clientY, node.id);
  }, [openMenuAt]);

  /**
   * ⑳(f) — **자리와 몸통을 따로 짓는다.** 끄는 동안 프레임마다 달라지는 것은 자리 하나뿐인데, 한 덩어리로
   * 지으면 그 한 프레임마다 스무 개 노드의 `data` 가 전부 새 객체가 되어 손을 따라오지 않는 노드까지
   * 다시 그려진다(장면 워터마크·글리프까지). 몸통을 여기서 한 번만 짓고 `data` 신원을 그대로 두면
   * React Flow 는 **자리가 바뀐 노드만** 다시 그린다 — 그 차이가 "부드럽게"다.
   */
  const baseNodes = useMemo(
    () => steps.map((step, i) => ({
      id: step.id,
      type: 'goalStep',
      data: {
        step,
        kind: step.kind ? visualKinds[step.kind] : undefined,
        selected: step.id === selectedStepId,
        parallel: i > 0 && !!step.parallel,
        onOpen: onSelectStep,
        // ㉖(h) — 핀에서 끊는 두 손짓. 안정 참조라 `data` 신원이 프레임마다 흔들리지 않는다(⑳(f)).
        onBreakPin,
        onPinMenu,
      },
      // ⑭(d)·⑳ — 끌어서 **자리만** 바꾼다(차례는 핀에서 핀으로 꽂은 선이 정한다).
      draggable: true,
    })),
    [steps, visualKinds, selectedStepId, onSelectStep, onBreakPin, onPinMenu],
  );

  /** ⑳(f) — 끄는 동안 매 프레임 다시 지어지는 것은 이 한 겹뿐이다(자리 = 끌던 자리 → 저장 자리 → 파생 자리). */
  const nodes = useMemo<Node[]>(
    () => baseNodes.map((n) => ({ ...n, position: positionOf(n.id) })),
    [baseNodes, positionOf],
  );

  /**
   * ⑳(g) — **선이 사라지지 않게** 잰 치수를 노드에 도로 실어 준다. 이 한 겹이 없으면 새 노드 객체가
   * 갈 때마다 React Flow 가 그 노드의 손잡이 치수를 지우고, 손잡이 치수가 없는 노드에 붙은 선은
   * 그려지지 않는다 — 목록이 갱신될 때마다 선이 하나씩 빠진 그림이 남았다(훅 주석에 근거).
   */
  const { nodes: flowNodes, onNodesChange } = useMeasuredFlowNodes(nodes, NODE_SIZE);

  /**
   * ⑰(a)·㉖(b) — **차례가 그리는 선 위에 내가 그은 선이 더해진다.**
   *
   * 밑바탕은 종전 그대로다 — 행 단위 **팬아웃·팬인**(앞 행의 모든 노드에서 다음 행의 모든 노드로).
   * 그 선이 곧 "이것들이 끝나야 저것이 시작된다"이고, 목록에 단계가 있는 한 흐름은 언제나 보인다.
   * ㉖ 초안은 이 선을 통째로 걷고 그은 것만 남겼는데, 그러면 지도가 **선 없는 카드 더미**가 된다
   * (사용자 지적 "선이 잘 안보여서 정확하게 보이게 만들라고 하니까 왜 아예 지워버렸어"). 사용자가
   * 본 "긋지도 않은 연결"의 정체는 ㉖(a) 의 **남의 마스크에 잘린 선 토막**이었고, 고칠 자리는
   * 그쪽이다 — 흐름을 그리는 선 자체가 아니다.
   *
   * 그 위에 **핀에서 핀으로 그은 선**(`goalWires`)을 얹는다. 차례가 이미 그린 선이면 같은 id 라
   * 한 번만 그려지고, 행을 건너뛰어 이은 선은 그것대로 남는다. 양 끝이 지금 목록에 있는 선만 그린다.
   */
  const edges = useMemo<Edge[]>(() => {
    const byId = new Map(steps.map((s) => [s.id, s] as const));
    /** 한 쌍을 잇는 선 하나 — 색·굵기 규약(⑱)은 두 원천이 **같은 자리**에서 받아 간다. */
    const link = (sourceId: string, targetId: string): Edge => {
      const to = byId.get(targetId);
      const running = to?.status === 'in_progress';
      const kindColor = to?.kind ? visualKinds[to.kind]?.color : undefined;
      return {
        id: `${sourceId}->${targetId}`,
        source: sourceId,
        target: targetId,
        animated: running,
        // ⑱ — 굵기·점선은 화면 좌표로 못 박는다(줌과 무관하게 같은 굵기 — STAGE_EDGE 주석).
        style: {
          stroke: running ? (kindColor ?? KIND_NEUTRAL) : STAGE_EDGE.COLOR,
          strokeWidth: running ? STAGE_EDGE.WIDTH_RUNNING : STAGE_EDGE.WIDTH,
          strokeLinecap: 'round',
          vectorEffect: 'non-scaling-stroke',
        },
        // ⑱ — 선 둘레의 **보이지 않는 20px 띠**(React Flow 기본 `interactionWidth`)를 없앤다.
        //   이 무대의 선은 몸통을 고를 것이 아닌데(선 메뉴 ❌), 그 띠가 포인터를 먼저 먹어
        //   선 근처 우클릭이 노드 메뉴를 못 열고 조용히 삼켜졌다(캔버스도 같은 이유로 0 이다).
        //   ⑳ 뒤로 잡을 수 있는 것은 선의 **끝**(`reconnectRadius` 원)뿐이다 — 몸통은 여전히 0.
        interactionWidth: 0,
      };
    };

    const es: Edge[] = [];
    const seen = new Set<string>();
    // ⑰(a) — 밑바탕: 행 단위 팬아웃·팬인(판정은 `rowWires` 한 곳 — 끊기 손잡이가 보는 것과 **같은 목록**이라야
    //   "끊을 수 있는 선"과 "그려지는 선"이 갈리지 않는다). ㉖(h)-3 — 사용자가 끊은 자리는 뺀다.
    for (const w of rowWires(currentRows())) {
      if (isCut(cuts, w.source, w.target)) continue;
      const id = `${w.source}->${w.target}`;
      if (seen.has(id)) continue;
      seen.add(id);
      es.push(link(w.source, w.target));
    }
    // ㉖(c) — 그 위에 그은 선. 차례가 이미 그린 것은 건너뛴다(같은 id 가 둘이면 React Flow 가 경고한다).
    for (const wire of drawableWires(wires, byId.keys(), cuts)) {
      const id = `${wire.source}->${wire.target}`;
      if (seen.has(id)) continue;
      seen.add(id);
      es.push(link(wire.source, wire.target));
    }
    return es;
    // 선은 **자리를 보지 않는다**(차례와 그은·끊은 목록에서만 나온다) — 끄는 동안 다시 지을 이유가 없다(⑳(f)).
  }, [steps, wires, cuts, currentRows, visualKinds]);

  const focusPos = useMemo(
    () => (selectedStepId ? positions.get(selectedStepId) ?? null : null),
    [positions, selectedStepId],
  );

  const menuStepIndex = useMemo(
    () => (menu?.stepId ? steps.findIndex((s) => s.id === menu.stepId) : -1),
    [menu, steps],
  );
  const menuStep = menuStepIndex >= 0 ? steps[menuStepIndex] ?? null : null;

  const onPickKind = useCallback((key: string | null) => {
    if (!activeSessionId || !menu?.stepId) return;
    void setGoalStepKind({ agentId, subAgentId: activeSessionId, stepId: menu.stepId, kind: key });
  }, [activeSessionId, agentId, menu, setGoalStepKind]);

  const onAddAction = useCallback((card: GoalActionCard) => {
    if (menu) insertStep(card.payload, { x: menu.flowX, y: menu.flowY }, card.kind);
  }, [menu, insertStep]);

  const onAddKindStep = useCallback((card: VisualKindCard) => {
    if (menu) insertStep(card.label, { x: menu.flowX, y: menu.flowY }, card.key);
  }, [menu, insertStep]);

  // ⑰(d) — 설치 스킬은 `/이름`(세션이 그 슬래시를 그대로 푼다), 두뇌 스킬은 이름 그대로(서버가 그 이름을
  //   가진 절차를 그 턴의 스킬 선택에 함께 싣는다). 같은 이름의 종류 카드가 있으면 그 그림을 빌린다.
  const onAddSkill = useCallback((skill: AvailableSkill) => {
    if (menu) insertStep(`/${skill.name}`, { x: menu.flowX, y: menu.flowY }, visualKinds[skill.name] ? skill.name : undefined);
  }, [menu, insertStep, visualKinds]);

  const onAddAutoGoalSkill = useCallback((skill: AutoGoalSkillSummary) => {
    if (menu) insertStep(skill.name, { x: menu.flowX, y: menu.flowY });
  }, [menu, insertStep]);

  if (!activeSessionId) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-[12px] text-gray-500">{t('ide.goal.pickSession')}</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        // ⑳(g) — 잰 치수를 받는 창구. 이걸 안 받으면 손잡이 치수가 지워져 **선이 사라진다**(위 훅 주석).
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        onInit={(inst) => { rfRef.current = inst; }}
        // ⑫(d)·⑭(d) — 노드를 끌 수 있다. 놓은 자리는 남고 차례는 세로가 정한다.
        //   끄는 동안에는 카메라 추종을 끈다 — 내 손이 미끄러지는 것을 막는 것도 (j) 의 규칙이다.
        nodesDraggable
        nodeDragThreshold={STAGE_DRAG.THRESHOLD}
        onNodeDragStart={() => onUserMove()}
        // ⑳(f) — 끄는 내내 오는 좌표. 이 핸들러가 없으면 controlled 모드의 좌표는 버려진다(`dragPos` 주석).
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        // ⑳ — 핀에서 핀으로 선을 끈다. 놓은 자리가 차례를 정하던 종전 손짓은 없다 —
        //   차례는 이 선으로만 바뀐다. 그려진 선의 끝(작은 원)을 잡아 옮겨 꽂아도 같은 문이다.
        nodesConnectable={canEdit}
        onConnect={onConnect}
        edgesReconnectable={canEdit}
        onReconnect={onReconnect}
        // ㉖(e) — 선 끝을 빈 자리에 놓으면 **끊긴다**(다른 단계에 놓으면 종전대로 옮겨 꽂기).
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        reconnectRadius={STAGE_WIRE.RECONNECT_RADIUS}
        connectionRadius={STAGE_WIRE.CONNECT_RADIUS}
        isValidConnection={isValidConnection}
        // 끌고 가는 선 — 놓이면 그려질 선과 같은 색·굵기, 점선으로 "아직 안 꽂혔다". 굵기·점선은 화면 좌표(⑱).
        connectionLineStyle={{
          stroke: STAGE_EDGE.COLOR,
          strokeWidth: STAGE_EDGE.WIDTH,
          strokeDasharray: STAGE_WIRE.DASH,
          strokeLinecap: 'round',
          vectorEffect: 'non-scaling-stroke',
        }}
        elementsSelectable
        // ⑭(e) — 우클릭은 통째로 메뉴에 준다. 팬은 왼쪽·가운데 버튼이다(캔버스와 같은 손짓 —
        //   `contextmenu` 가 나는 시점이 OS 마다 달라 "우클릭 끌기=팬"은 세 OS 에서 다른 손짓이 된다).
        panOnDrag={[0, 1]}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        // ⑱ — 선 위에서 누른 우클릭도 빈 자리와 같이 취급한다. 선은 이 무대에서 고르는 것이
        //   아니라서(위 `interactionWidth: 0`), 그 위라고 메뉴가 안 열리면 고장으로 읽힌다.
        onEdgeContextMenu={(event) => onPaneContextMenu(event)}
        // ⑪(j) — `event` 가 있으면 **손으로** 움직인 것이다. `setCenter` 같은 프로그램 이동은
        //   `null` 로 오므로 추종이 자기가 옮긴 화면 때문에 꺼지는 일이 없다.
        onMoveStart={(event) => { if (event) onUserMove(); }}
      >
        <Background color="#374151" gap={16} />
        {/* 기본 <Controls> 는 흰 사각 버튼이라 이 어두운 지도 위에서 혼자 뜬다 —
            캔버스와 같은 손잡이를 쓴다(`canvasControlKit`). 아래 진행 레일 위로 올려 세운다. */}
        <CanvasZoomControls className="!mb-8" />
        <StageCamera focusId={selectedStepId} focusPos={focusPos} follow={follow} />
      </ReactFlow>

      {/* ⑭(c) — 우클릭을 모르는 사람을 위한 손잡이 하나. 같은 메뉴를 같은 규약으로 연다. */}
      {canEdit && (
        <button
          type="button"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            openMenuAt(r.left, r.bottom + 4);
          }}
          title={t('ide.stage.menu.title')}
          aria-label={t('ide.stage.menu.title')}
          className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded border border-gray-700 bg-gray-900/90 px-2 py-1 text-[12px] text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t('ide.stage.menu.title')}
        </button>
      )}

      {/* ⑪(m)·⑭(c) — 빈 캔버스도 캔버스다. 흐름 템플릿은 이제 우클릭 메뉴 안에 있으므로
          여기서는 **어디를 눌러야 하는지**만 말한다(한 줄씩 스무 번 치게 하지 않는다는 규칙은 그대로). */}
      {steps.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <p className="max-w-[18rem] text-center text-[12px] leading-relaxed text-gray-500">
            {t('ide.goalMap.empty')}
            <br />
            <span className="text-gray-600">{t('ide.stage.menu.emptyHint')}</span>
          </p>
        </div>
      )}

      {menu && (
        <StageCanvasMenu
          anchor={menu}
          step={menuStep}
          stepIndex={menuStepIndex}
          kinds={visualKinds}
          actions={goalActions}
          skills={readySkills}
          autoGoalSkills={autoGoalSkills}
          canEdit={canEdit}
          onAddStep={() => askAndInsert({ x: menu.flowX, y: menu.flowY })}
          onAddAction={onAddAction}
          onApplyFlow={applyFlow}
          onAddKindStep={onAddKindStep}
          onAddSkill={onAddSkill}
          onAddAutoGoalSkill={onAddAutoGoalSkill}
          onSetKind={onPickKind}
          onFocusStep={onSelectStep}
          onToggleParallel={onToggleParallel}
          onClearWires={onClearWires}
          // ㉖(h)-3 — 그은 선뿐 아니라 **차례가 그린 선**도 끊을 수 있으므로 칸의 조건도 그 둘이다.
          //   양쪽 핀 중 한쪽이라도 아직 끊을 것이 남아 있으면 선다(전부 끊긴 단계에서는 서지 않는다).
          stepHasWires={!!menu.stepId && (
            canBreakAt(currentRows(), wires, menu.stepId, 'in', cuts)
            || canBreakAt(currentRows(), wires, menu.stepId, 'out', cuts)
          )}
          onBreakPin={onBreakPin}
          // ㉖(h) — 끊을 것이 없는 핀에서는 칸을 세우지 않는다(눌러도 아무 일 없는 칸 ❌).
          canBreakPin={!!menu.stepId && !!menu.pinSide && canBreakAt(currentRows(), wires, menu.stepId, menu.pinSide, cuts)}
          onDeleteStep={onDeleteStep}
          onPinKind={(key, pinned) => { void setVisualKindPinned(key, pinned); }}
          onTrashKind={(key, trashed) => { void setVisualKindTrashed(key, trashed); }}
          onPinAction={(id, pinned) => { void setGoalActionPinned(id, pinned); }}
          onAutoLayout={onAutoLayout}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
