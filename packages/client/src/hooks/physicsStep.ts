/**
 * 캔버스 물리의 **시간 축** — 이번 프레임에 몇 걸음을 밟을 것인가, 한 걸음에 목표로 얼마나
 * 다가갈 것인가, 언제 "다 멎었다"고 볼 것인가.
 *
 * `physicsGeometry` 가 공간(무엇이 무엇과 부딪히나)을 맡듯 이쪽은 시간을 맡는다. 떼어 낸 이유도
 * 같다 — 시간·좌표 계산은 UI 없이 검증하는 편이 정확하다(`floatingWindowGeom` 선례).
 *
 * ## 왜 누산기(accumulator)인가
 *
 * 종전 루프는 `if (ts - last >= FRAME_MS) { last = ts; tick(); }` 로 rAF 를 걸렀다. 60Hz 화면에서
 * rAF 는 16.67ms 마다 오는데 이 식은 **남는 시간을 버린다**. 그래서 33.33ms 문턱을 아슬아슬하게
 * 못 넘긴 프레임이 통째로 밀려 걸음 간격이 `33ms · 50ms · 33ms · 50ms` 로 번갈아 나오고(초당
 * 걸음 수도 30 이 아니라 24 안팎으로 내려앉는다), 눈에는 이것이 **"버블이 끊겨 움직인다"** 로
 * 보인다. 남는 시간을 누산기에 남기면 걸음 간격이 시뮬레이션 시간 기준으로 정확히 고정되고,
 * 주사율(60·75·120·144Hz)이 달라도 초당 걸음 수가 같다.
 *
 * **걸음 길이는 30Hz 그대로 둔다.** 반발 세기·감쇠·질량은 전부 "한 걸음당" 값으로 조율돼 있어
 * 걸음 길이를 바꾸면 그 셋을 함께 환산해야 하는데, 질량이 물리적 임펄스 나눗셈이 아니라 **매
 * 걸음 속도를 나누는 형태**라 바디마다 환산 계수가 달라 한 상수로는 보존되지 않는다. 이번에
 * 고치는 것은 걸음의 **간격이 들쭉날쭉하던 것**이지 걸음의 빠르기가 아니다.
 */

/** 물리 한 걸음의 길이(ms). 주사율과 무관한 고정 스텝 — 위 주석의 "걸음 길이는 그대로" 근거. */
export const PHYSICS_STEP_MS = 1000 / 30;

/**
 * 한 프레임에 몰아서 밟을 수 있는 최대 걸음 수. 탭이 잠깐 멎었다 돌아왔을 때 밀린 시간을 전부
 * 따라잡으려 들면 그 프레임 하나가 길어져 화면이 다시 튄다(죽음의 나선). 밀린 몫은 버린다.
 */
export const MAX_STEPS_PER_FRAME = 3;

/** 한 프레임이 인정하는 최대 경과 시간(ms). 이보다 긴 공백은 "멈춰 있었다"로 보고 잘라 낸다. */
export const MAX_FRAME_ELAPSED_MS = 250;

export interface StepPlan {
  /** 이번 프레임에 밟을 걸음 수. */
  steps: number;
  /** 다음 프레임으로 넘길 잔여 시간(ms) — 이것을 버리면 걸음 간격이 들쭉날쭉해진다. */
  rest: number;
}

/**
 * 누적된 시간에서 이번 프레임의 걸음 수를 뽑고 남는 시간을 돌려준다.
 * 상한을 넘는 밀린 몫은 **버린다**(잔여도 0 — 다음 프레임이 또 몰아치지 않게).
 */
export function drainSteps(
  pendingMs: number,
  stepMs: number = PHYSICS_STEP_MS,
  maxSteps: number = MAX_STEPS_PER_FRAME,
): StepPlan {
  if (!Number.isFinite(pendingMs) || pendingMs <= 0 || stepMs <= 0) return { steps: 0, rest: 0 };
  const steps = Math.floor(pendingMs / stepMs);
  if (steps >= maxSteps) return { steps: maxSteps, rest: 0 };
  return { steps, rest: pendingMs - steps * stepMs };
}

/**
 * 직전 프레임과의 간격. 첫 프레임(prevTs=0)은 한 걸음치로 보고, 아주 긴 공백은 잘라 낸다.
 * (탭 전환·창 최소화에서 돌아온 프레임의 `ts` 차이는 수 초까지 벌어진다.)
 */
export function clampElapsed(
  prevTs: number,
  ts: number,
  stepMs: number = PHYSICS_STEP_MS,
  maxElapsedMs: number = MAX_FRAME_ELAPSED_MS,
): number {
  if (prevTs <= 0) return stepMs;
  const elapsed = ts - prevTs;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  return Math.min(elapsed, maxElapsedMs);
}

/**
 * 위성이 한 걸음에 궤도 자리로 **남은 거리의 몇 할**을 좁히는가(지수 감쇠 복귀).
 *
 * 종전 식은 `min(거리² × 0.00005, 0.25)` 라 **거리에 따라 속도가 100배 넘게 달라졌다** —
 * 멀리서는 한 걸음에 25%씩 순간이동하다가, 20px 안쪽에 들어오면 걸음당 0.4px 로 기어 렌더
 * 문턱(`MIN_DISPLACEMENT`)에도 못 미쳐 **몇 걸음에 한 번씩 툭툭 끊겨** 도착했다. 남은 거리의
 * 일정 비율로 좁히면 감속 곡선이 한 가지라 처음부터 끝까지 같은 결로 미끄러진다
 * (시상수 ≈ 168ms — 0.5초면 사실상 도착).
 */
export const SPRING_APPROACH_PER_STEP = 0.18;

/**
 * 한 걸음에 이만큼도 못 움직인 프레임은 "멎었다"로 센다(px).
 * 렌더 문턱(0.5px)의 6분의 1 — 화면에 그려지지도 않을 미동이라 잠들어도 잃는 그림이 없다.
 */
export const REST_MOVE_PX = 0.08;

/** 연속 몇 걸음이 조용해야 잠드는가. 30Hz 기준 0.5초 — 종전 15프레임과 같은 실시간. */
export const REST_STEPS = 15;

/**
 * 정지 판정 카운터. **한 걸음에 가장 많이 움직인 바디**로 재는 것이 핵심이다 —
 * 종전에는 전체 속도의 **합**을 임계값 하나(0.1)와 비교해서, 바디가 많을수록 합이 커져
 * *전부 사실상 멈춰 있어도* 영원히 잠들지 못했다(위성 20개면 미동만으로도 0.6 이 넘는다).
 * 합이 아니라 최댓값이면 노드 수가 판정을 흔들지 못한다.
 */
export function nextQuietSteps(maxMovePx: number, quietSteps: number): number {
  return maxMovePx < REST_MOVE_PX ? quietSteps + 1 : 0;
}

/** 조용한 걸음이 충분히 이어졌나(=rAF 루프를 끌 때가 됐나). */
export function isAtRest(quietSteps: number, restSteps: number = REST_STEPS): boolean {
  return quietSteps >= restSteps;
}
