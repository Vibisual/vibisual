/**
 * 캔버스 물리의 시간 축 — 이번 프레임에 몇 걸음을 밟나, 한 걸음에 목표로 얼마나 다가가나, 언제 "다 멎었다"고 보나(UI 없이 검증 — `floatingWindowGeom` 선례).
 * 누산기를 쓴다: `if (ts - last >= FRAME_MS) { last = ts; tick(); }` 처럼 거르면 남는 시간을 버려 60Hz 에서 걸음 간격이 33·50ms 로 번갈아(초당 24 안팎) 버블이 끊겨 움직인다.
 * 남는 시간을 누산기에 남기면 간격이 고정되고 주사율(60·75·120·144Hz)이 달라도 초당 걸음 수가 같다.
 * 걸음 길이는 30Hz 그대로 둔다 — 반발 세기·감쇠·질량이 "한 걸음당" 값으로 조율돼 있고, 질량이 매 걸음 속도를 나누는 형태라 바디마다 환산 계수가 달라 한 상수로는 보존되지 않는다.
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
 * 위성이 한 걸음에 궤도 자리로 남은 거리의 몇 할을 좁히는가(지수 감쇠 복귀 — 시상수 ≈ 168ms, 0.5초면 사실상 도착).
 * 거리 제곱식(`min(거리² × 0.00005, 0.25)`)으로 바꾸지 마라 — 속도가 거리에 따라 100배 넘게 달라, 멀리서는 한 걸음에 25%씩 순간이동하고
 * 20px 안쪽에서는 렌더 문턱(`MIN_DISPLACEMENT`) 아래로 기어 툭툭 끊겨 도착한다.
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
 * 정지 판정 카운터 — 한 걸음에 가장 많이 움직인 바디(최댓값)로 잰다. 속도의 합을 임계값과 견주면 바디가 많을수록 합이 커져
 * 사실상 멈춰도 영원히 잠들지 못한다(위성 20개면 미동만으로 0.6 을 넘는다).
 */
export function nextQuietSteps(maxMovePx: number, quietSteps: number): number {
  return maxMovePx < REST_MOVE_PX ? quietSteps + 1 : 0;
}

/** 조용한 걸음이 충분히 이어졌나(=rAF 루프를 끌 때가 됐나). */
export function isAtRest(quietSteps: number, restSteps: number = REST_STEPS): boolean {
  return quietSteps >= restSteps;
}
