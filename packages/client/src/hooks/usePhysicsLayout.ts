import { useEffect, useRef, useCallback } from 'react';
import type { Node } from '@xyflow/react';
import { LAYOUT_CENTER_X, LAYOUT_CENTER_Y } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';

interface PhysicsBody {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  parentId: string | null;
  offsetX: number;
  offsetY: number;
  /** 유저가 드래그 중인지 */
  dragging: boolean;
}

const MAGNET_GAP = 12;
const REPULSION_STRENGTH = 800;
const REPULSION_RANGE = 120;
const DAMPING = 0.88;
const MAX_VELOCITY = 4;
const JITTER = 0.05;
const FPS = 30;
const FRAME_MS = 1000 / FPS;
/** 자동 슬립 판정: 연속 N프레임 동안 총 운동에너지 < 임계값이면 슬립 */
const SLEEP_THRESHOLD = 0.1;
const SLEEP_FRAMES = 15;
/**
 * 부모 버블이 사각 바운딩 박스를 벗어나려 하면 경계에서 클램프 + 약한 안쪽 반발.
 * 박스 크기는 graphStore.layoutBoundsHalfWidth/Height (사용자 조절 가능, §3.3),
 * 중심은 LAYOUT_CENTER_X/Y. 위성은 부모 스프링이 끌어당기므로 직접 클램프하지 않는다.
 */
const BOUNDS_BOUNCE = 0.4;

export interface PhysicsHandlers {
  onSatelliteDrag: (id: string, x: number, y: number) => void;
  onSatelliteDragStop: (id: string) => void;
  /** 뷰 전환 시 물리 일시 정지 → 바디 리셋 */
  pauseAndReset: () => void;
  /** 물리 엔진 깨우기 (드래그 등 사용자 인터랙션 시) */
  wake: () => void;
}

export function usePhysicsLayout(
  nodes: Node[],
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>,
  satelliteEdges: Array<{ source: string; target: string }>,
  onSleep?: () => void,
  /** true면 위성 없이도 물리 틱이 돌면서 일반 버블끼리 반발력이 적용된다. */
  forceRun: boolean = false,
): PhysicsHandlers {
  const bodiesRef = useRef<Map<string, PhysicsBody>>(new Map());
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const parentMap = useRef<Map<string, string>>(new Map());
  const pausedUntilRef = useRef(0);
  /** 자동 슬립: 정지 상태 연속 프레임 카운터 */
  const quietFramesRef = useRef(0);
  /** 슬립 상태 — 속도 수렴 시 true, 드래그 시 false */
  const sleepingRef = useRef(false);

  // 활성 프로젝트의 사각 바운딩 박스(half-size). 미설정이면 기본값. RAF 루프가
  // 항상 최신값을 보도록 ref 로 옮긴다.
  const activeBounds = useGraphStore((s) => {
    const proj = s.activeProject;
    return proj ? s.layoutBoundsByProject[proj] : undefined;
  });
  const hwInit = activeBounds?.hw ?? 1500;
  const hhInit = activeBounds?.hh ?? 1100;
  const boundsRef = useRef({ hw: hwInit, hh: hhInit });
  useEffect(() => {
    boundsRef.current = { hw: hwInit, hh: hhInit };
    // 박스가 줄어 버블이 박스 밖에 갇혀있을 수 있으니 슬립 깨움
    sleepingRef.current = false;
    quietFramesRef.current = 0;
  }, [hwInit, hhInit]);

  useEffect(() => {
    parentMap.current.clear();
    for (const e of satelliteEdges) {
      parentMap.current.set(e.target, e.source);
    }
  }, [satelliteEdges]);

  useEffect(() => {
    const existing = bodiesRef.current;
    const newBodies = new Map<string, PhysicsBody>();

    for (const node of nodes) {
      const isSat = node.id.startsWith('sat-');
      const pid = parentMap.current.get(node.id) ?? null;
      const w = (node.measured?.width ?? node.width ?? 70);
      const r = w / 2;
      const cx = node.position.x + r;
      const cy = node.position.y + r;

      const old = existing.get(node.id);
      const isPaused = Date.now() < pausedUntilRef.current;
      if (old) {
        old.radius = r;
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
          parentId: pid,
          offsetX, offsetY,
          dragging: false,
        });
      }
    }
    bodiesRef.current = newBodies;
  }, [nodes]);

  /** 드래그 중 — 마우스에 고정, 물리 엔진이 안 건드림 */
  const onSatelliteDrag = useCallback((id: string, x: number, y: number) => {
    sleepingRef.current = false;
    quietFramesRef.current = 0;
    const body = bodiesRef.current.get(id);
    if (!body) return;
    body.x = x + body.radius;
    body.y = y + body.radius;
    body.vx = 0;
    body.vy = 0;
    body.dragging = true;
  }, []);

  /** 드래그 끝 — 놓은 방향 유지, 거리는 원래 궤도로 복귀 */
  const onSatelliteDragStop = useCallback((id: string) => {
    const body = bodiesRef.current.get(id);
    if (!body) return;
    body.dragging = false;
    // 릴리즈 순간 잔여 속도 초기화. 안 하면 드래그 중 누적된 반발/스프링/jitter가
    // 릴리즈 직후 한 방향으로 계속 밀어버린다.
    body.vx = 0;
    body.vy = 0;
    if (body.parentId) {
      const parent = bodiesRef.current.get(body.parentId);
      if (parent) {
        const dx = body.x - parent.x;
        const dy = body.y - parent.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        // 원래 궤도 반경 = 부모 반경 + 위성 반경 + 간격
        const orbitR = parent.radius + body.radius + 20;
        // 방향은 유지, 거리만 궤도로
        body.offsetX = (dx / dist) * orbitR;
        body.offsetY = (dy / dist) * orbitR;
      }
    }
  }, []);

  const tick = useCallback(() => {
    if (sleepingRef.current) return;
    if (Date.now() < pausedUntilRef.current) return;
    const bodies = bodiesRef.current;
    if (bodies.size === 0) return;

    const all = Array.from(bodies.values());
    const satellites = all.filter((b) => b.parentId !== null);
    if (satellites.length === 0 && !forceRun) return;
    if (satellites.length === 0 && all.length < 2) return;

    // 부모로의 복귀 경로가 막힌 위성 검출 — 이 위성들은 이번 프레임 완전 정지.
    // 조건: 다른 버블 B가 (1) 부모와 이미 최소거리로 붙어 있고(=더 밀 공간 없음)
    // (2) sat과 parent 사이에 끼어 있고 (3) sat과 충돌권 내에 있음.
    // 차단된 위성은 스프링·지터·반발력 전부 적용 안 함 → 평형점에서 안 떨림.
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
        const bpMin = parent.radius + b.radius + MAGNET_GAP;
        if (bpDist > bpMin + 1) continue;
        if (bpDist >= satToParent) continue;
        const sbx = b.x - sat.x;
        const sby = b.y - sat.y;
        const sbDist = Math.sqrt(sbx * sbx + sby * sby) || 0.1;
        const sbMin = sat.radius + b.radius + MAGNET_GAP;
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
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      const t = Math.min(dist * dist * 0.00005, 0.25);
      sat.x += dx * t;
      sat.y += dy * t;

      sat.vx += (Math.random() - 0.5) * JITTER;
      sat.vy += (Math.random() - 0.5) * JITTER;
    }

    // 자석 반발 — 균일 공간 해시 그리드로 O(N²) → O(N) 최적화.
    // 셀 크기는 두 바디가 상호작용할 수 있는 최대 거리 이상이어야 인접 3×3 셀만
    // 확인해도 누락 0 보장. 상호작용 최대 거리 = max(REPULSION_RANGE,
    // 최대반경*2 + MAGNET_GAP). 버블 크기가 가변(NODE_MAX_SIZE까지)이므로
    // 하드코딩 대신 이번 tick 의 실제 최대 반경으로 동적 산출 — 큰 버블 쌍
    // 겹침 보정 누락(겹쳐도 안 밀려남) 방지.
    let maxRadius = 0;
    for (const body of all) if (body.radius > maxRadius) maxRadius = body.radius;
    const CELL_SIZE = Math.max(REPULSION_RANGE, maxRadius * 2 + MAGNET_GAP);
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

            // 부모는 자기 위성한테 안 밀림 (단, 유저가 위성 잡고 밀면 밀림)
            const aIsParentOfB = b.parentId === a.id && !b.dragging;
            const bIsParentOfA = a.parentId === b.id && !a.dragging;

            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
            const minDist = a.radius + b.radius + MAGNET_GAP;
            const nx = dx / dist;
            const ny = dy / dist;

            const aFrozen = frozenSatIds.has(a.id);
            const bFrozen = frozenSatIds.has(b.id);

            if (dist < minDist) {
              const correction = (minDist - dist) / 2;
              const bounce = Math.max(minDist - dist, 1) * 0.3;
              if (!a.dragging && !aIsParentOfB && !aFrozen) { a.x += nx * correction; a.y += ny * correction; a.vx += nx * bounce; a.vy += ny * bounce; }
              if (!b.dragging && !bIsParentOfA && !bFrozen) { b.x -= nx * correction; b.y -= ny * correction; b.vx -= nx * bounce; b.vy -= ny * bounce; }
            } else if (dist < REPULSION_RANGE) {
              const force = REPULSION_STRENGTH / (dist * dist);
              if (!a.dragging && !aIsParentOfB && !aFrozen) { a.vx += nx * force; a.vy += ny * force; }
              if (!b.dragging && !bIsParentOfA && !bFrozen) { b.vx -= nx * force * 0.5; b.vy -= ny * force * 0.5; }
            }
          }
        }
      }
    }

    // 속도 적용 — 위성은 가볍고, 폴더/에이전트는 무겁지만 밀리긴 함
    let changed = false;
    let totalEnergy = 0;
    for (const body of all) {
      if (body.dragging) continue;
      // 위성=1, 폴더/에이전트=3 (너무 무거우면 반응 없음)
      const mass = body.parentId ? 1 : 3;
      body.vx /= mass;
      body.vy /= mass;
      body.vx *= DAMPING;
      body.vy *= DAMPING;
      const speed = Math.sqrt(body.vx * body.vx + body.vy * body.vy);
      if (speed > MAX_VELOCITY) {
        body.vx = (body.vx / speed) * MAX_VELOCITY;
        body.vy = (body.vy / speed) * MAX_VELOCITY;
      }
      totalEnergy += speed;
      if (Math.abs(body.vx) > 0.01 || Math.abs(body.vy) > 0.01) {
        body.x += body.vx;
        body.y += body.vy;
        changed = true;
      }

      // 사각 바운딩 가드 — 부모 버블이 박스 밖으로 나가려 하면 경계에서 클램프 + 안쪽으로 약한 반발.
      // 위성은 부모 스프링이 끌어당기므로 직접 클램프 ❌.
      if (body.parentId == null) {
        const { hw, hh } = boundsRef.current;
        const minX = LAYOUT_CENTER_X - hw + body.radius;
        const maxX = LAYOUT_CENTER_X + hw - body.radius;
        const minY = LAYOUT_CENTER_Y - hh + body.radius;
        const maxY = LAYOUT_CENTER_Y + hh - body.radius;
        if (body.x < minX) { body.x = minX; if (body.vx < 0) body.vx = -body.vx * BOUNDS_BOUNCE; changed = true; }
        else if (body.x > maxX) { body.x = maxX; if (body.vx > 0) body.vx = -body.vx * BOUNDS_BOUNCE; changed = true; }
        if (body.y < minY) { body.y = minY; if (body.vy < 0) body.vy = -body.vy * BOUNDS_BOUNCE; changed = true; }
        else if (body.y > maxY) { body.y = maxY; if (body.vy > 0) body.vy = -body.vy * BOUNDS_BOUNCE; changed = true; }
      }
    }

    // 자동 슬립: 총 운동에너지가 임계값 이하로 N프레임 연속이면 슬립
    if (totalEnergy < SLEEP_THRESHOLD) {
      quietFramesRef.current += 1;
      if (quietFramesRef.current >= SLEEP_FRAMES) {
        sleepingRef.current = true;
        onSleep?.();
      }
    } else {
      quietFramesRef.current = 0;
    }

    if (changed) {
      // setNodes 내부에서 실제 변화 있는 노드만 교체 (서브픽셀 떨림 → setNodes 호출 자체 최소화)
      const MIN_DISPLACEMENT = 0.5;
      setNodes((prev) => {
        let anyMoved = false;
        const next = prev.map((node) => {
          const body = bodies.get(node.id);
          if (!body || body.dragging) return node;
          const nx = body.x - body.radius;
          const ny = body.y - body.radius;
          if (Math.abs(node.position.x - nx) < MIN_DISPLACEMENT && Math.abs(node.position.y - ny) < MIN_DISPLACEMENT) return node;
          anyMoved = true;
          return { ...node, position: { x: nx, y: ny } };
        });
        return anyMoved ? next : prev;
      });
    }
  }, [setNodes, onSleep, forceRun]);

  useEffect(() => {
    let running = true;
    const loop = (ts: number): void => {
      if (!running) return;
      if (ts - lastFrameRef.current >= FRAME_MS) {
        lastFrameRef.current = ts;
        tick();
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { running = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [tick]);

  const pauseAndReset = useCallback(() => {
    // 바디 유지, tick만 정지 → 재개 후 캐시된 노드 위치 기준으로 자연스럽게 시작
    pausedUntilRef.current = Date.now() + 400;
    quietFramesRef.current = 0;
    sleepingRef.current = false;
  }, []);

  const wake = useCallback(() => {
    sleepingRef.current = false;
    quietFramesRef.current = 0;
  }, []);

  return { onSatelliteDrag, onSatelliteDragStop, pauseAndReset, wake };
}
