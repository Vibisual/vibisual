import { describe, it, expect } from 'vitest';
import {
  MAX_FRAME_ELAPSED_MS,
  MAX_STEPS_PER_FRAME,
  PHYSICS_STEP_MS,
  REST_MOVE_PX,
  REST_STEPS,
  SPRING_APPROACH_PER_STEP,
  clampElapsed,
  drainSteps,
  isAtRest,
  nextQuietSteps,
} from './physicsStep.js';

describe('drainSteps — 남는 시간을 버리지 않는다', () => {
  it('한 걸음이 안 찼으면 밟지 않고 통째로 넘긴다', () => {
    const plan = drainSteps(16.67);
    expect(plan.steps).toBe(0);
    expect(plan.rest).toBeCloseTo(16.67, 5);
  });

  it('60Hz 화면에서 걸음이 정확히 두 프레임마다 규칙적으로 떨어진다 (33/50 번갈이 소멸)', () => {
    // 종전 `ts - last >= FRAME_MS` 방식은 잔여를 버려 33ms·50ms 가 번갈아 나왔다.
    const frame = 1000 / 60;
    let pending = 0;
    const stepFrames: number[] = [];
    for (let f = 1; f <= 60; f++) {
      const plan = drainSteps(pending + frame);
      pending = plan.rest;
      if (plan.steps > 0) stepFrames.push(f);
    }
    // 1초(60프레임)에 정확히 30걸음.
    expect(stepFrames.length).toBe(30);
    // 걸음 사이 간격이 전부 2프레임 — 들쭉날쭉한 3프레임 공백이 없다.
    const gaps = stepFrames.slice(1).map((f, i) => f - (stepFrames[i] ?? 0));
    expect(new Set(gaps)).toEqual(new Set([2]));
  });

  it('75Hz 처럼 나누어떨어지지 않는 주사율에서도 초당 걸음 수는 그대로다', () => {
    const frame = 1000 / 75;
    let pending = 0;
    let steps = 0;
    for (let f = 0; f < 75; f++) {
      const plan = drainSteps(pending + frame);
      pending = plan.rest;
      steps += plan.steps;
    }
    expect(steps).toBe(30);
  });

  it('밀린 시간이 상한을 넘으면 따라잡지 않고 버린다 (죽음의 나선 방지)', () => {
    const plan = drainSteps(5000);
    expect(plan.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(plan.rest).toBe(0);
  });

  it('음수·NaN 은 걸음 0', () => {
    expect(drainSteps(-5)).toEqual({ steps: 0, rest: 0 });
    expect(drainSteps(Number.NaN)).toEqual({ steps: 0, rest: 0 });
  });
});

describe('clampElapsed — 돌아온 프레임이 한꺼번에 몰아치지 않게', () => {
  it('첫 프레임은 한 걸음치로 본다', () => {
    expect(clampElapsed(0, 12345)).toBe(PHYSICS_STEP_MS);
  });

  it('평범한 간격은 그대로', () => {
    expect(clampElapsed(1000, 1016.67)).toBeCloseTo(16.67, 5);
  });

  it('탭이 멎었다 돌아온 긴 공백은 잘라 낸다', () => {
    expect(clampElapsed(1000, 9000)).toBe(MAX_FRAME_ELAPSED_MS);
  });

  it('시간이 거꾸로 가면 0', () => {
    expect(clampElapsed(1000, 900)).toBe(0);
  });
});

describe('스프링 복귀 — 거리와 무관하게 같은 결로 좁힌다', () => {
  it('남은 거리의 일정 비율이라 멀든 가깝든 시상수가 같다', () => {
    const stepsToHalf = (dist: number): number => {
      let d = dist;
      let n = 0;
      while (d > dist / 2) { d -= d * SPRING_APPROACH_PER_STEP; n++; }
      return n;
    };
    expect(stepsToHalf(400)).toBe(stepsToHalf(20));
  });

  it('0.5초(15걸음)면 사실상 도착한다 — 남은 거리 5% 안팎', () => {
    let d = 100;
    for (let i = 0; i < 15; i++) d -= d * SPRING_APPROACH_PER_STEP;
    expect(d).toBeLessThan(6);
  });
});

describe('정지 판정 — 노드 수가 판정을 흔들지 못한다', () => {
  it('한 걸음 최대 이동이 문턱 미만이면 조용한 걸음이 쌓인다', () => {
    let quiet = 0;
    for (let i = 0; i < REST_STEPS; i++) quiet = nextQuietSteps(REST_MOVE_PX / 2, quiet);
    expect(isAtRest(quiet)).toBe(true);
  });

  it('한 번이라도 움직이면 카운터가 0 으로 돌아간다', () => {
    let quiet = 0;
    for (let i = 0; i < REST_STEPS - 1; i++) quiet = nextQuietSteps(0, quiet);
    quiet = nextQuietSteps(3, quiet);
    expect(quiet).toBe(0);
    expect(isAtRest(quiet)).toBe(false);
  });

  it('바디가 아무리 많아도 각자가 멎어 있으면 잠든다 (합산 판정이었을 때의 회귀)', () => {
    // 종전엔 "속도의 합 < 0.1" 이라 미동 0.03 짜리 바디 20개면 0.6 → 영영 못 잠들었다.
    const perBody = 0.03;
    const maxMove = perBody; // 합이 아니라 최댓값을 본다
    let quiet = 0;
    for (let i = 0; i < REST_STEPS; i++) quiet = nextQuietSteps(maxMove, quiet);
    expect(isAtRest(quiet)).toBe(true);
  });
});
