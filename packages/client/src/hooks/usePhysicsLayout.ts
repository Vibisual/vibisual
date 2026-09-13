import { useEffect, useRef, useCallback } from 'react';
import type { Node } from '@xyflow/react';
import { LAYOUT_BOUNDS_DEFAULT, LAYOUT_CENTER_X, LAYOUT_CENTER_Y, SATELLITE_ORBIT_GAP } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';
import { isCanvasCovered, subscribeCanvasCovered } from '../stores/canvasVisibility.js';
import {
  MAGNET_GAP,
  collidable,
  extentOf,
  gapBetween,
  massOf,
  separation,
  separationResponse,
  type PhysicsGroup,
} from './physicsGeometry.js';
import {
  PHYSICS_STEP_MS,
  SPRING_APPROACH_PER_STEP,
  clampElapsed,
  drainSteps,
  isAtRest,
  nextQuietSteps,
} from './physicsStep.js';

export type { PhysicsGroup } from './physicsGeometry.js';

/**
 * flowNodes(useNodesState) 밖에 있는 store 기반 요소를 물리에 태우기 위한 입력.
 * 좌표는 화면과 같은 **좌상단** 기준(폭·높이 포함), 이동 결과는 `onExternalMove` 로 되돌려 준다.
 */
export interface ExternalPhysicsNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: 'circle' | 'rect';
  group: PhysicsGroup;
  /** false 면 밀리지 않는 고정 장애물(위치를 되돌려 줄 곳이 없는 요소). */
  movable: boolean;
  /** 이 요소가 움직일 때 같은 변위로 데려갈 바디들(코멘트 박스 멤버). */
  carryIds?: string[];
}

export interface PhysicsMove {
  id: string;
  /** 좌상단 좌표(화면/스토어와 같은 기준). */
  x: number;
  y: number;
}

interface PhysicsBody {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 원형 바디의 반경. 사각 바디에서는 halfW/halfH 를 쓴다. */
  radius: number;
  halfW: number;
  halfH: number;
  shape: 'circle' | 'rect';
  group: PhysicsGroup;
  parentId: string | null;
  offsetX: number;
  offsetY: number;
  /** 유저가 드래그 중인지 */
  dragging: boolean;
  /** React Flow 가 DOM 실측을 마쳤는지(§4 v3.71 — 화면 밖 컬링 노드는 실측 전이라 반경이 기본값). */
  measured: boolean;
  /** flowNodes 밖(store 기반) 요소인지 — 이동을 콜백으로 내보낸다. */
  external: boolean;
  /** 물리로 밀 수 있는지(고정 장애물은 false). */
  movable: boolean;
  /** 함께 끌고 갈 바디 id(코멘트 박스 멤버). */
  carryIds: string[] | null;
  /** 이번 걸음을 시작한 자리 — 걸음이 끝난 뒤 "얼마나 움직였나"를 재는 기준(정지 판정·렌더 통지). */
  stepX: number;
  stepY: number;
}

const REPULSION_STRENGTH = 800;
const REPULSION_RANGE = 120;
const DAMPING = 0.88;
const MAX_VELOCITY = 4;
/**
 * 부모 버블이 사각 바운딩 박스를 벗어나려 하면 경계에서 클램프 + 약한 안쪽 반발.
 * 박스 크기는 graphStore.layoutBoundsHalfWidth/Height (사용자 조절 가능, §3.3),
 * 중심은 LAYOUT_CENTER_X/Y. 위성은 부모 스프링이 끌어당기므로 직접 클램프하지 않는다.
 */
const BOUNDS_BOUNCE = 0.4;
/** 좌표를 화면(노드/스토어)에 반영하는 최소 변위 — 서브픽셀 떨림으로 리렌더하지 않기 위함. */
const MIN_DISPLACEMENT = 0.5;

/**
 * §4 v3.71 가시성 LOD — "덮임"(IDE 최대화·모달 등 전면 오버레이)을 `document.hidden` 과 **동급**으로
 * 취급한다. 종전엔 같은 창 안에서 캔버스가 완전히 가려져도 `document.hidden` 은 false 라 물리가 계속
 * 돌았다 — 보이지도 않는 버블을 30fps 로 밀고 `setNodes` 로 리렌더까지 시켰다.
 */
function isCanvasUnseen(): boolean {
  return (typeof document !== 'undefined' && document.hidden) || isCanvasCovered();
}

export interface PhysicsHandlers {
  onSatelliteDrag: (id: string, x: number, y: number) => void;
  onSatelliteDragStop: (id: string) => void;
  /** 뷰 전환 시 물리 일시 정지 → 바디 리셋 */
  pauseAndReset: () => void;
  /**
   * §5.4 #33 — 지정한 시간 동안 물리를 재운다. 좌표를 **우리가 직접 몰아가는** 동안(정리 이동)
   * 물리가 같은 프레임에 반발력을 얹으면 가는 길이 흔들린다. 바디는 그대로 두므로 시간이 지나면
   * 그 자리에서 자연스럽게 이어 간다(`pauseAndReset` 과 달리 잔여 속도도 건드리지 않는다).
   */
  pauseFor: (ms: number) => void;
  /** 물리 엔진 깨우기 (드래그 등 사용자 인터랙션 시) */
  wake: () => void;
}

export function usePhysicsLayout(
  nodes: Node[],
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>,
  satelliteEdges: Array<{ source: string; target: string }>,
  onSleep?: () => void,
  /**
   * true면 위성 없이도 물리 틱이 돌면서 일반 버블끼리 반발력·경계 클램프가 적용된다.
   * 캔버스(`BubbleMap`)는 항상 true 를 넘긴다 — 위성 유무는 버블 물리의 조건이 아니다.
   */
  forceRun: boolean = false,
  /** flowNodes 밖(store 기반)의 사각 요소들 — 캡처·앱·플레이·코멘트 박스. */
  externalNodes: ExternalPhysicsNode[] = [],
  /** 위 요소들이 물리로 움직였을 때 좌상단 좌표를 되돌려 주는 콜백(한 틱에 1회, 배열). */
  onExternalMove?: (moves: PhysicsMove[]) => void,
): PhysicsHandlers {
  const bodiesRef = useRef<Map<string, PhysicsBody>>(new Map());
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  /** 아직 걸음으로 못 바꾼 잔여 시간(ms). 이것을 버리면 걸음 간격이 들쭉날쭉해진다(§physicsStep). */
  const stepDebtRef = useRef(0);
  /** 마지막 화면 반영 이후 쌓인 이동량(px). 렌더 문턱을 넘을 때만 `setNodes` 를 부른다. */
  const pendingMoveRef = useRef(0);
  const parentMap = useRef<Map<string, string>>(new Map());
  const pausedUntilRef = useRef(0);
  /** 자동 슬립: 정지 상태 연속 프레임 카운터 */
  const quietFramesRef = useRef(0);
  /** 슬립 상태 — 속도 수렴 시 true, 드래그 시 false */
  const sleepingRef = useRef(false);
  /**
   * 외부(store) 요소에 우리가 마지막으로 내보낸 중심 좌표. 스토어 → 노드 → 이 훅으로 되돌아오는
   * 값이 우리가 쓴 값과 같으면 바디 위치를 다시 덮지 않는다(왕복 지연 때문에 속도가 매 프레임
   * 초기화되어 밀림이 끊기는 것을 막는다). 다른 주체(드래그·서버 스냅샷)가 옮겼을 때만 받아들인다.
   */
  const lastEmittedRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const onExternalMoveRef = useRef(onExternalMove);
  useEffect(() => { onExternalMoveRef.current = onExternalMove; }, [onExternalMove]);

  /** 최신 tick 참조 — rAF 루프가 tick 정체성 변화에 재시작 없이 항상 최신 로직을 부르게 한다. */
  const tickRef = useRef<() => void>(() => {});

  // rAF 루프를 "필요할 때만" 돌린다(모바일 발열 억제 — §4 v3.39). 종전엔 루프가 항상 30fps 로
  // 돌며 tick 이 슬립 판정만 했는데, 상시 rAF 가 폰 GPU/컴포지터를 재우지 못해 발열의 주원인이었다.
  // 이제 슬립 수렴 또는 백그라운드(document.hidden = 앱 최소화·탭 전환·폰 화면 꺼짐)면 루프 자체를
  // 멈추고, wake()·가시성 복귀에서 ensureRunning 이 재점화한다. 시각 동작은 불변(tick 은 원래도
  // 슬립 시 조기 return 이라 안 움직였다) — CPU/발열만 준다. 데스크톱도 idle 시 이득.
  const ensureRunning = useCallback((): void => {
    if (rafRef.current != null) return;
    if (isCanvasUnseen()) return;
    // 재점화는 언제나 시계 0 에서 — 멈춰 있던 시간이 첫 프레임에 한꺼번에 밀려들지 않게.
    lastFrameRef.current = 0;
    stepDebtRef.current = 0;
    const loop = (ts: number): void => {
      if (sleepingRef.current || isCanvasUnseen()) {
        rafRef.current = null; // 다음 wake/visibilitychange/덮임해제 에서 ensureRunning 이 재점화
        lastFrameRef.current = 0;
        stepDebtRef.current = 0;
        return;
      }
      // 걸음 간격을 **시뮬레이션 시간**으로 고정한다. 잔여를 버리던 종전 방식은 60Hz 화면에서
      // 33ms·50ms 가 번갈아 나와(초당 걸음도 30→24) 버블이 끊겨 움직였다 — `physicsStep` 주석.
      const elapsed = clampElapsed(lastFrameRef.current, ts);
      lastFrameRef.current = ts;
      const plan = drainSteps(stepDebtRef.current + elapsed);
      stepDebtRef.current = plan.rest;
      for (let i = 0; i < plan.steps; i++) {
        if (sleepingRef.current) break;
        tickRef.current();
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  // 활성 프로젝트의 사각 바운딩 박스(half-size). 미설정이면 기본값. RAF 루프가
  // 항상 최신값을 보도록 ref 로 옮긴다.
  const activeBounds = useGraphStore((s) => {
    const proj = s.activeProject;
    return proj ? s.layoutBoundsByProject[proj] : undefined;
  });
  const hwInit = activeBounds?.hw ?? LAYOUT_BOUNDS_DEFAULT.hw;
  const hhInit = activeBounds?.hh ?? LAYOUT_BOUNDS_DEFAULT.hh;
  const boundsRef = useRef({ hw: hwInit, hh: hhInit });
  useEffect(() => {
    boundsRef.current = { hw: hwInit, hh: hhInit };
    // 박스가 줄어 버블이 박스 밖에 갇혀있을 수 있으니 슬립 깨움
    sleepingRef.current = false;
    quietFramesRef.current = 0;
    ensureRunning();
  }, [hwInit, hhInit, ensureRunning]);

  useEffect(() => {
    parentMap.current.clear();
    for (const e of satelliteEdges) {
      parentMap.current.set(e.target, e.source);
    }
  }, [satelliteEdges]);

  useEffect(() => {
    const existing = bodiesRef.current;
    const newBodies = new Map<string, PhysicsBody>();
    // §4 v3.71 — 뷰포트 밖 노드 컬링(onlyRenderVisibleElements)을 켠 뒤로는, 화면 밖 버블이 DOM 에
    //   마운트된 적이 없어 measured 가 비어 있다(반경이 기본값 35 로 남는다). 그 버블이 화면에 들어와
    //   처음 실측되는 순간 반경이 실제 크기로 점프하므로, 잠들어 있던 엔진을 깨워 겹침을 정리한다.
    //   깨우는 조건은 "미실측 → 실측" 전이뿐 — 활동에 따른 크기 전이(매 프레임 폭 변화)로는 깨지 않아
    //   상시 rAF 로 되돌아가지 않는다.
    let measuredArrived = false;
    // 활동으로 반경이 커진 바디들. 크기 전이 **자체**로는 깨우지 않고(상시 rAF 회귀 방지 — §4 v3.71),
    // 커진 결과 실제로 이웃과 겹쳐 버린 경우에만 아래에서 1회 깨운다.
    const grown: PhysicsBody[] = [];

    for (const node of nodes) {
      const isSat = node.id.startsWith('sat-');
      const pid = parentMap.current.get(node.id) ?? null;
      const measuredW = node.measured?.width;
      const w = (measuredW ?? node.width ?? 70);
      const r = w / 2;
      const cx = node.position.x + r;
      const cy = node.position.y + r;

      const old = existing.get(node.id);
      const isPaused = Date.now() < pausedUntilRef.current;
      if (old) {
        if (!old.measured && measuredW != null) measuredArrived = true;
        old.measured = measuredW != null;
        const prevRadius = old.radius;
        old.radius = r;
        old.halfW = r;
        old.halfH = r;
        if (r > prevRadius + 0.5) grown.push(old);
        old.parentId = pid;
        // 비위성은 항상 동기화, 위성은 pause 중일 때만 동기화 (캐시 복원 반영)
        if (!isSat || isPaused) {
          // 위치가 실제로 변했을 때만 동기화 (데이터만 갱신 시 속도 보존 → 떨림 방지)
          const posMoved = Math.abs(old.x - cx) > 0.5 || Math.abs(old.y - cy) > 0.5;
          if (posMoved) {
            old.x = cx;
            old.y = cy;
            old.vx = 0;
            old.vy = 0;
          }
          if (isSat && pid) {
            const parentNode = nodes.find((n) => n.id === pid);
            if (parentNode) {
              const pw = (parentNode.measured?.width ?? parentNode.width ?? 70);
              const pr = pw / 2;
              old.offsetX = cx - (parentNode.position.x + pr);
              old.offsetY = cy - (parentNode.position.y + pr);
            }
          }
        }
        newBodies.set(node.id, old);
      } else {
        let offsetX = 0;
        let offsetY = 0;
        if (isSat && pid) {
          const parentNode = nodes.find((n) => n.id === pid);
          if (parentNode) {
            const pw = (parentNode.measured?.width ?? parentNode.width ?? 70);
            const pr = pw / 2;
            offsetX = cx - (parentNode.position.x + pr);
            offsetY = cy - (parentNode.position.y + pr);
          }
        }
        newBodies.set(node.id, {
          id: node.id,
          x: cx, y: cy,
          vx: 0, vy: 0,
          radius: r,
          halfW: r, halfH: r,
          shape: 'circle',
          group: 'bubble',
          parentId: pid,
          offsetX, offsetY,
          dragging: false,
          measured: measuredW != null,
          external: false,
          movable: true,
          carryIds: null,
          stepX: cx, stepY: cy,
        });
      }
    }

    // store 기반 사각 요소(캡처·앱·플레이·코멘트 박스) — 좌상단+크기로 들어와 중심 기준 바디가 된다.
    for (const ext of externalNodes) {
      if (!(ext.width > 0) || !(ext.height > 0)) continue;
      const halfW = ext.width / 2;
      const halfH = ext.height / 2;
      const cx = ext.x + halfW;
      const cy = ext.y + halfH;
      const old = existing.get(ext.id);
      if (old) {
        const prevExtent = extentOf(old);
        old.halfW = halfW;
        old.halfH = halfH;
        old.radius = ext.shape === 'circle' ? halfW : Math.max(halfW, halfH);
        old.shape = ext.shape;
        old.group = ext.group;
        old.movable = ext.movable;
        old.carryIds = ext.carryIds ?? null;
        old.measured = true;
        old.external = true;
        old.parentId = null;
        if (extentOf(old) > prevExtent + 0.5) grown.push(old);
        // 우리가 방금 내보낸 좌표가 되돌아온 것이면 무시 — 그 외(드래그·서버 스냅샷)만 받아들인다.
        const emitted = lastEmittedRef.current.get(ext.id);
        const isEcho = emitted != null && Math.abs(emitted.x - cx) < 1.5 && Math.abs(emitted.y - cy) < 1.5;
        const posMoved = Math.abs(old.x - cx) > 0.5 || Math.abs(old.y - cy) > 0.5;
        if (posMoved && !isEcho) {
          old.x = cx;
          old.y = cy;
          old.vx = 0;
          old.vy = 0;
          lastEmittedRef.current.delete(ext.id);
        }
        newBodies.set(ext.id, old);
      } else {
        newBodies.set(ext.id, {
          id: ext.id,
          x: cx, y: cy,
          vx: 0, vy: 0,
          radius: ext.shape === 'circle' ? halfW : Math.max(halfW, halfH),
          halfW, halfH,
          shape: ext.shape,
          group: ext.group,
          parentId: null,
          offsetX: 0, offsetY: 0,
          dragging: false,
          measured: true,
          external: true,
          movable: ext.movable,
          carryIds: ext.carryIds ?? null,
          stepX: cx, stepY: cy,
        });
      }
    }

    // 사라진 요소의 잔여 기록 정리
    for (const id of Array.from(lastEmittedRef.current.keys())) {
      if (!newBodies.has(id)) lastEmittedRef.current.delete(id);
    }

    bodiesRef.current = newBodies;
    // 커진 바디가 이웃을 파고들었는지 1회 검사 — 겹쳤을 때만 깨운다(겹침이 없으면 잠든 채로 둔다).
    let grownIntoOverlap = false;
    if (grown.length > 0) {
      const allBodies = Array.from(newBodies.values());
      for (const g of grown) {
        for (const other of allBodies) {
          if (other === g || !collidable(g, other)) continue;
          if (separation(g, other, gapBetween(g, other))) { grownIntoOverlap = true; break; }
        }
        if (grownIntoOverlap) break;
      }
    }
    if (measuredArrived || grownIntoOverlap) {
      sleepingRef.current = false;
      quietFramesRef.current = 0;
      ensureRunning();
    }
  }, [nodes, externalNodes, ensureRunning]);

  /** 드래그 중 — 마우스에 고정, 물리 엔진이 안 건드림 */
  const onSatelliteDrag = useCallback((id: string, x: number, y: number) => {
    sleepingRef.current = false;
    quietFramesRef.current = 0;
    ensureRunning();
    const body = bodiesRef.current.get(id);
    if (!body) return;
    body.x = x + body.halfW;
    body.y = y + body.halfH;
    body.vx = 0;
    body.vy = 0;
    body.dragging = true;
    lastEmittedRef.current.delete(id);
  }, [ensureRunning]);

  /** 드래그 끝 — 놓은 방향 유지, 거리는 원래 궤도로 복귀 */
  const onSatelliteDragStop = useCallback((id: string) => {
    const body = bodiesRef.current.get(id);
    if (!body) return;
    body.dragging = false;
    // 릴리즈 순간 잔여 속도 초기화. 안 하면 드래그 중 누적된 반발·스프링이
    // 릴리즈 직후 한 방향으로 계속 밀어버린다.
    body.vx = 0;
    body.vy = 0;
    if (body.parentId) {
      const parent = bodiesRef.current.get(body.parentId);
      if (parent) {
        const dx = body.x - parent.x;
        const dy = body.y - parent.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        // 원래 궤도 반경 = 부모 반경 + 위성 반경 + 간격. **§5.4 #33 정리 배치가 같은 값을 쓴다** —
        // 두 곳이 따로 들면 정리한 궤도를 이 스프링이 조금씩 당겨 스스로 풀어 버린다.
        const orbitR = parent.radius + body.radius + SATELLITE_ORBIT_GAP;
        // 방향은 유지, 거리만 궤도로
        body.offsetX = (dx / dist) * orbitR;
        body.offsetY = (dy / dist) * orbitR;
      }
    }
  }, []);

  const tick = useCallback(() => {
    if (sleepingRef.current) return;
    if (Date.now() < pausedUntilRef.current) return; // 정리 이동 중 — 잠들면 안 된다(재개할 손이 없다)

    /** 밀 것이 없다 = 조용한 걸음. 세지 않으면 빈 캔버스에서 rAF 가 영영 안 꺼진다. */
    const idleStep = (): void => {
      quietFramesRef.current = nextQuietSteps(0, quietFramesRef.current);
      if (isAtRest(quietFramesRef.current)) {
        sleepingRef.current = true;
        onSleep?.();
      }
    };

    const bodies = bodiesRef.current;
    if (bodies.size === 0) { idleStep(); return; }

    const all = Array.from(bodies.values());
    const satellites = all.filter((b) => b.parentId !== null);
    if (satellites.length === 0 && (!forceRun || all.length < 2)) { idleStep(); return; }

    // 이번 걸음을 시작한 자리를 남긴다 — 걸음이 끝나면 "실제로 얼마나 움직였나"를 여기서 잰다.
    //   ① 정지 판정(속도 합 ❌ — 스프링은 속도를 거치지 않고 좌표를 직접 옮기므로 속도로는 안 보인다)
    //   ② 화면 반영 여부. 코멘트 박스가 멤버를 데려갈 변위도 같은 기준을 쓴다(별도 스냅샷 ❌).
    for (const body of all) {
      body.stepX = body.x;
      body.stepY = body.y;
    }
    const carriers = all.filter((b) => b.carryIds != null && b.carryIds.length > 0 && b.movable && !b.dragging);

    // 부모로의 복귀 경로가 막힌 위성 검출 — 이 위성들은 이번 프레임 완전 정지.
    // 조건: 다른 버블 B가 (1) 부모와 이미 최소거리로 붙어 있고(=더 밀 공간 없음)
    // (2) sat과 parent 사이에 끼어 있고 (3) sat과 충돌권 내에 있음.
    // 차단된 위성은 스프링·반발력 전부 적용 안 함 → 평형점에서 안 떨림.
    // 다음 프레임에 블로커가 비키면(혹은 위치가 바뀌면) 차단 해제되어 자연스럽게 복귀 재개.
    const frozenSatIds = new Set<string>();
    for (const sat of satellites) {
      if (sat.dragging) continue;
      const parent = bodies.get(sat.parentId!);
      if (!parent) continue;
      const sx = sat.x - parent.x;
      const sy = sat.y - parent.y;
      const satToParent = Math.sqrt(sx * sx + sy * sy) || 1;
      for (const b of all) {
        if (b === sat || b === parent) continue;
        const bpx = b.x - parent.x;
        const bpy = b.y - parent.y;
        const bpDist = Math.sqrt(bpx * bpx + bpy * bpy) || 0.1;
        const bpMin = parent.radius + extentOf(b) + MAGNET_GAP;
        if (bpDist > bpMin + 1) continue;
        if (bpDist >= satToParent) continue;
        const sbx = b.x - sat.x;
        const sby = b.y - sat.y;
        const sbDist = Math.sqrt(sbx * sbx + sby * sby) || 0.1;
        const sbMin = sat.radius + extentOf(b) + MAGNET_GAP;
        if (sbDist <= sbMin + 6) { frozenSatIds.add(sat.id); break; }
      }
    }

    // 스프링 암 복귀 (드래그 중·차단된 위성 제외)
    for (const sat of satellites) {
      if (sat.dragging) continue;
      if (frozenSatIds.has(sat.id)) {
        sat.vx = 0;
        sat.vy = 0;
        continue;
      }
      const parent = bodies.get(sat.parentId!);
      if (!parent) continue;

      const targetX = parent.x + sat.offsetX;
      const targetY = parent.y + sat.offsetY;
      const dx = targetX - sat.x;
      const dy = targetY - sat.y;

      // 남은 거리의 **일정 비율**로 좁힌다(지수 감쇠). 종전 `거리² × 0.00005` 는 멀리서 25%씩
      // 순간이동하다 가까이서 걸음당 0.4px 로 기어, 마지막 20px 이 렌더 문턱에 걸려 툭툭 끊겼다.
      sat.x += dx * SPRING_APPROACH_PER_STEP;
      sat.y += dy * SPRING_APPROACH_PER_STEP;

      // 무작위 흔들림(jitter) 폐기 — 완전히 겹친 쌍의 대칭을 깨려고 **모든 위성을 상시로 떨게**
      // 하던 값이다. 캔버스 전체가 미세하게 진동했고, 그 진동이 정지 판정까지 막아 rAF 가 영영
      // 안 꺼졌다. 대칭 깨기는 `physicsGeometry.separation` 이 정해진 축으로 결정론적으로 한다.
    }

    // 자석 반발 — 균일 공간 해시 그리드로 O(N²) → O(N) 최적화.
    // 셀 크기는 두 바디가 상호작용할 수 있는 최대 거리 이상이어야 인접 3×3 셀만
    // 확인해도 누락 0 보장. 상호작용 최대 거리 = max(REPULSION_RANGE,
    // 최대치수*2 + MAGNET_GAP). 버블 크기가 가변(NODE_MAX_SIZE까지)이고 사각 창은
    // 그보다 훨씬 크므로 하드코딩 대신 이번 tick 의 실제 최대 치수로 동적 산출 —
    // 큰 요소 쌍 겹침 보정 누락(겹쳐도 안 밀려남) 방지.
    let maxExtent = 0;
    for (const body of all) {
      const ext = extentOf(body);
      if (ext > maxExtent) maxExtent = ext;
    }
    const CELL_SIZE = Math.max(REPULSION_RANGE, maxExtent * 2 + MAGNET_GAP);
    const grid = new Map<string, PhysicsBody[]>();
    for (const body of all) {
      const cx = Math.floor(body.x / CELL_SIZE);
      const cy = Math.floor(body.y / CELL_SIZE);
      const key = `${cx},${cy}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(body);
      else grid.set(key, [body]);
    }

    // 각 바디에 대해 자기 셀 + 인접 8셀의 바디들과만 쌍 처리.
    // 쌍 중복 방지: a.id < b.id 인 경우만 처리 → 각 무순서쌍 정확히 1회.
    for (const a of all) {
      const acx = Math.floor(a.x / CELL_SIZE);
      const acy = Math.floor(a.y / CELL_SIZE);
      for (let dcx = -1; dcx <= 1; dcx++) {
        for (let dcy = -1; dcy <= 1; dcy++) {
          const bucket = grid.get(`${acx + dcx},${acy + dcy}`);
          if (!bucket) continue;
          for (const b of bucket) {
            // 쌍 중복 방지: 사전순 소→대 방향으로만 처리
            if (a.id >= b.id) continue;
            if (!collidable(a, b)) continue;

            // 부모는 자기 위성한테 안 밀림 (단, 유저가 위성 잡고 밀면 밀림)
            const aIsParentOfB = b.parentId === a.id && !b.dragging;
            const bIsParentOfA = a.parentId === b.id && !a.dragging;

            const aFrozen = frozenSatIds.has(a.id);
            const bFrozen = frozenSatIds.has(b.id);
            const aMovable = !a.dragging && !aIsParentOfB && !aFrozen && a.movable;
            const bMovable = !b.dragging && !bIsParentOfA && !bFrozen && b.movable;
            if (!aMovable && !bMovable) continue;

            // 사각 요소가 낀 쌍은 간격 0 — 캡처 버블 이어 붙이기(§5.9 자석 스냅)로 딱 붙여 놓은
            // 변이 물리로 다시 벌어지면 안 된다. 원형 버블끼리만 MAGNET_GAP 만큼 띄운다.
            const sep = separation(a, b, gapBetween(a, b));

            if (sep) {
              // 깊이를 누가 얼마나 나눠 물러나고 얼마나 되튀는지는 `separationResponse` 한 곳이 정한다
              // — 한쪽만 움직일 수 있으면 그쪽이 전부, 위성은 부모 아닌 바디에게 전부 양보, 물러나지
              // 않는 쪽은 되튐도 없다. 그 셋 중 하나라도 어기면 매 걸음의 잔여 변위가 상대에게만
              // 쌓여 지도가 한 방향으로 영원히 흐른다(그 근거는 저쪽 주석에 있다).
              const res = separationResponse(a, b, sep, aMovable, bMovable);
              if (aMovable) { a.x += sep.nx * res.aPush; a.y += sep.ny * res.aPush; a.vx += sep.nx * res.aBounce; a.vy += sep.ny * res.aBounce; }
              if (bMovable) { b.x -= sep.nx * res.bPush; b.y -= sep.ny * res.bPush; b.vx -= sep.nx * res.bBounce; b.vy -= sep.ny * res.bBounce; }
            } else if (a.shape === 'circle' && b.shape === 'circle') {
              // 근거리 반발은 원형 버블 사이에서만 — 사각 창까지 서로 밀어내면 사용자가 붙여 둔
              // 배치가 이유 없이 흩어진다(겹칠 때만 정리).
              const dx = a.x - b.x;
              const dy = a.y - b.y;
              const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
              if (dist < REPULSION_RANGE) {
                const nx = dx / dist;
                const ny = dy / dist;
                // 사정거리 끝에서 0 이 되게 깎는다. 종전엔 `1/d²` 를 120px 에서 **뚝 끊어** 그 선을
                // 넘나드는 버블이 밀렸다 안 밀렸다 하며 툭 튀었다(경계에서의 힘 불연속).
                const force = (REPULSION_STRENGTH / (dist * dist)) * (1 - dist / REPULSION_RANGE);
                // 밀어내기는 **대칭**이다. 종전엔 b 만 절반(×0.5)을 받아 쌍의 무게중심이 매 걸음
                // a 쪽으로 밀려났는데, a·b 를 가르는 기준이 노드 id 순서라 캔버스가 **id 가 작은
                // 쪽으로 계속 흘렀다**(사용자가 옮겨 놓은 자리가 스스로 흐트러지던 원인).
                if (aMovable) { a.vx += nx * force; a.vy += ny * force; }
                if (bMovable) { b.vx -= nx * force; b.vy -= ny * force; }
              }
            }
          }
        }
      }
    }

    // 속도 적용 — 위성은 가볍고, 버블/사각 창은 무겁지만 밀리긴 함
    for (const body of all) {
      if (body.dragging || !body.movable) continue;
      const mass = massOf(body);
      body.vx /= mass;
      body.vy /= mass;
      body.vx *= DAMPING;
      body.vy *= DAMPING;
      const speed = Math.sqrt(body.vx * body.vx + body.vy * body.vy);
      if (speed > MAX_VELOCITY) {
        body.vx = (body.vx / speed) * MAX_VELOCITY;
        body.vy = (body.vy / speed) * MAX_VELOCITY;
      }
      if (Math.abs(body.vx) > 0.01 || Math.abs(body.vy) > 0.01) {
        body.x += body.vx;
        body.y += body.vy;
      }

      // 사각 바운딩 가드 — 버블·사각 창이 박스 밖으로 나가려 하면 경계에서 클램프 + 안쪽으로 약한 반발.
      // 위성은 부모 스프링이 끌어당기므로 직접 클램프 ❌.
      if (body.parentId == null) {
        const { hw, hh } = boundsRef.current;
        const minX = LAYOUT_CENTER_X - hw + body.halfW;
        const maxX = LAYOUT_CENTER_X + hw - body.halfW;
        const minY = LAYOUT_CENTER_Y - hh + body.halfH;
        const maxY = LAYOUT_CENTER_Y + hh - body.halfH;
        // 박스보다 큰 요소(대형 iframe 등)는 클램프가 서로 상충하므로 건너뛴다.
        if (minX <= maxX) {
          if (body.x < minX) { body.x = minX; if (body.vx < 0) body.vx = -body.vx * BOUNDS_BOUNCE; }
          else if (body.x > maxX) { body.x = maxX; if (body.vx > 0) body.vx = -body.vx * BOUNDS_BOUNCE; }
        }
        if (minY <= maxY) {
          if (body.y < minY) { body.y = minY; if (body.vy < 0) body.vy = -body.vy * BOUNDS_BOUNCE; }
          else if (body.y > maxY) { body.y = maxY; if (body.vy > 0) body.vy = -body.vy * BOUNDS_BOUNCE; }
        }
      }
    }

    // 코멘트 박스가 움직인 만큼 멤버 버블도 같은 변위로 데려간다 — 안 그러면 그룹이 어긋나고
    // 다음 멤버십 재계산에서 자식이 통째로 빠져 버린다.
    for (const carrier of carriers) {
      const dx = carrier.x - carrier.stepX;
      const dy = carrier.y - carrier.stepY;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
      for (const childId of carrier.carryIds ?? []) {
        const child = bodies.get(childId);
        if (!child || child.dragging || !child.movable) continue;
        child.x += dx;
        child.y += dy;
      }
    }

    // 이번 걸음에 **가장 많이 움직인 바디**가 얼마나 갔나. 정지 판정과 화면 반영이 같은 값을 본다.
    //   종전에는 속도의 **합**으로 정지를 판정해서, 바디가 많을수록 합이 커져 전부 사실상 멈춰
    //   있어도 잠들지 못했다(=상시 rAF). 그리고 스프링은 속도를 거치지 않고 좌표를 직접 옮기므로
    //   속도로 재면 스프링 복귀가 통째로 "안 움직인 것"이 되어 화면에도 안 그려졌다.
    let maxMove = 0;
    for (const body of all) {
      if (body.dragging) continue;
      const moved = Math.hypot(body.x - body.stepX, body.y - body.stepY);
      if (moved > maxMove) maxMove = moved;
    }

    quietFramesRef.current = nextQuietSteps(maxMove, quietFramesRef.current);
    if (isAtRest(quietFramesRef.current)) {
      sleepingRef.current = true;
      onSleep?.();
    }

    // 화면 반영은 **쌓인 이동량**이 렌더 문턱을 넘을 때. 걸음마다 조금씩만 가는 느린 복귀도
    // 몇 걸음이 모이면 반드시 그려진다(걸음 단위로만 재면 문턱 아래 이동이 영영 안 그려진다).
    pendingMoveRef.current += maxMove;
    const changed = pendingMoveRef.current >= MIN_DISPLACEMENT;
    if (changed) pendingMoveRef.current = 0;

    if (changed) {
      // setNodes 내부에서 실제 변화 있는 노드만 교체 (서브픽셀 떨림 → setNodes 호출 자체 최소화)
      setNodes((prev) => {
        let anyMoved = false;
        const next = prev.map((node) => {
          const body = bodies.get(node.id);
          if (!body || body.dragging || body.external) return node;
          const nx = body.x - body.halfW;
          const ny = body.y - body.halfH;
          if (Math.abs(node.position.x - nx) < MIN_DISPLACEMENT && Math.abs(node.position.y - ny) < MIN_DISPLACEMENT) return node;
          anyMoved = true;
          return { ...node, position: { x: nx, y: ny } };
        });
        return anyMoved ? next : prev;
      });

      // store 기반 요소는 노드 배열이 아니라 콜백으로 좌표를 되돌려 준다(한 틱에 한 번).
      const emit = onExternalMoveRef.current;
      if (emit) {
        const moves: PhysicsMove[] = [];
        for (const body of all) {
          if (!body.external || body.dragging || !body.movable) continue;
          const nx = body.x - body.halfW;
          const ny = body.y - body.halfH;
          const prev = lastEmittedRef.current.get(body.id);
          if (prev && Math.abs(prev.x - body.x) < MIN_DISPLACEMENT && Math.abs(prev.y - body.y) < MIN_DISPLACEMENT) continue;
          lastEmittedRef.current.set(body.id, { x: body.x, y: body.y });
          moves.push({ id: body.id, x: nx, y: ny });
        }
        if (moves.length > 0) emit(moves);
      }
    }
  }, [setNodes, onSleep, forceRun]);

  // 최신 tick 을 ref 에 보관 — ensureRunning 의 루프가 재시작 없이 이 참조를 통해 최신 tick 을 부른다.
  useEffect(() => { tickRef.current = tick; }, [tick]);

  useEffect(() => {
    ensureRunning();
    // 백그라운드로 갔다가(폰 화면 꺼짐·탭 전환·앱 최소화) 돌아오면 루프 재점화.
    const onVisibility = (): void => { if (!document.hidden) ensureRunning(); };
    document.addEventListener('visibilitychange', onVisibility);
    // §4 v3.71 — 덮개가 걷히면(IDE 닫힘·축소) 즉시 재점화. 이 구독이 없으면 멈춘 루프를 깨울 사건이
    //   드래그 같은 사용자 조작뿐이라, 덮여 있는 동안 쌓인 배치가 화면에 반영되지 않는다.
    const unsubCover = subscribeCanvasCovered((nowCovered) => { if (!nowCovered) ensureRunning(); });
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      unsubCover();
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [ensureRunning]);

  const pauseAndReset = useCallback(() => {
    // 바디 유지, tick만 정지 → 재개 후 캐시된 노드 위치 기준으로 자연스럽게 시작
    pausedUntilRef.current = Date.now() + 400;
    quietFramesRef.current = 0;
    sleepingRef.current = false;
    lastEmittedRef.current.clear();
    ensureRunning();
  }, [ensureRunning]);

  const pauseFor = useCallback((ms: number) => {
    // 이미 더 긴 정지가 걸려 있으면 줄이지 않는다 — 짧은 호출이 긴 정지를 깨우면 안 된다.
    pausedUntilRef.current = Math.max(pausedUntilRef.current, Date.now() + ms);
    quietFramesRef.current = 0;
  }, []);

  const wake = useCallback(() => {
    sleepingRef.current = false;
    quietFramesRef.current = 0;
    ensureRunning();
  }, [ensureRunning]);

  return { onSatelliteDrag, onSatelliteDragStop, pauseAndReset, pauseFor, wake };
}
