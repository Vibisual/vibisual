/**
 * §5.1 #2-1 (G) ②③④ — 화면 속 미리보기 상한 · 움직이는 동안 굽지 않기. 시각과 일정은 주입해 결정적으로 잰다.
 */
import { describe, expect, it } from 'vitest';
import { PREVIEW_POLICY } from '@vibisual/shared';

import { createPreviewBudget } from './previewBudget.js';

function harness() {
  let t = 1_000;
  const timers: Array<{ at: number; fn: () => void }> = [];
  const queued: Array<() => void> = [];
  const budget = createPreviewBudget({
    now: () => t,
    schedule: (fn) => { queued.push(fn); },
    later: (fn, ms) => { timers.push({ at: t + ms, fn }); },
  });
  const flush = (): void => { while (queued.length) queued.shift()!(); };
  const advance = (ms: number): void => {
    t += ms;
    for (const timer of [...timers]) {
      if (timer.at <= t) {
        timers.splice(timers.indexOf(timer), 1);
        timer.fn();
      }
    }
  };
  return { budget, flush, advance };
}

describe('previewBudget — 화면 기준 · 한눈 기준', () => {
  it('작게 보이는 자리는 고르지 않고, 크게 보이는 것부터 상한까지 고른다', () => {
    const { budget, flush } = harness();
    for (let i = 0; i < PREVIEW_POLICY.maxOnScreen + 6; i += 1) budget.upsert(`n${i}`, 40 + i);
    budget.upsert('tiny', 10);
    flush();
    expect(budget.granted().size).toBe(PREVIEW_POLICY.maxOnScreen);
    expect(budget.isGranted(`n${PREVIEW_POLICY.maxOnScreen + 5}`)).toBe(true);
    expect(budget.isGranted('n0')).toBe(false);
    expect(budget.isGranted('tiny')).toBe(false);
  });

  it('구슬은 제 크기에 맞춘 문턱이다(배율 1 에서 보인다) · 큰 자리와 같은 상한을 나눠 쓴다', () => {
    const { budget, flush } = harness();
    budget.upsert('bead', 20, { small: true });
    flush();
    expect(budget.isGranted('bead')).toBe(true);
    budget.setZoom(0.5);
    flush();
    expect(budget.isGranted('bead')).toBe(false);
  });

  it('움직이는 동안은 고른 것을 바꾸지 않고, 멈추면 그 줌으로 다시 고른다', () => {
    const { budget, flush } = harness();
    budget.upsert('a', 60);
    flush();
    expect(budget.isGranted('a')).toBe(true);
    budget.setMoving(true, 0.3);
    budget.upsert('b', 200);
    flush();
    expect(budget.isGranted('a')).toBe(true);
    expect(budget.isGranted('b')).toBe(false);
    budget.setMoving(false, 0.3);
    flush();
    expect(budget.isGranted('a')).toBe(false); // 60 × 0.3 = 18px < 28
    expect(budget.isGranted('b')).toBe(true); // 200 × 0.3 = 60px
  });

  it('줌 경계에서 깜빡이지 않는다 — 그리던 것은 낮은 문턱, 새로 켜는 것은 높은 문턱', () => {
    const { budget, flush } = harness();
    budget.upsert('a', 100);
    budget.setZoom(0.31); // 31px — 켜는 문턱(34) 아래
    flush();
    expect(budget.isGranted('a')).toBe(false);
    budget.setZoom(0.4); // 40px — 켠다
    flush();
    expect(budget.isGranted('a')).toBe(true);
    budget.setZoom(0.31); // 31px — 그리던 것은 28 까지 둔다
    flush();
    expect(budget.isGranted('a')).toBe(true);
  });

  it('구독자에게 바뀐 것만 알린다 · 떠난 자리는 빠진다', () => {
    const { budget, flush } = harness();
    let calls = 0;
    budget.subscribe('a', () => { calls += 1; });
    budget.upsert('a', 60);
    flush();
    expect(calls).toBe(1);
    budget.upsert('b', 60);
    flush();
    expect(calls).toBe(1);
    budget.remove('a');
    flush();
    expect(budget.isGranted('a')).toBe(false);
  });
});

describe('previewBudget — 시각 기준(④)', () => {
  it('움직이는 동안 · 멈춘 직후에는 한가하지 않고, 지나면 한가해지며 기다리던 쪽을 부른다', () => {
    const { budget, advance } = harness();
    expect(budget.isIdle()).toBe(true);
    let woke = 0;
    budget.onIdle(() => { woke += 1; });
    budget.setMoving(true);
    expect(budget.isIdle()).toBe(false);
    budget.setMoving(false);
    expect(budget.isIdle()).toBe(false);
    advance(PREVIEW_POLICY.idleAfterMotionMs);
    expect(budget.isIdle()).toBe(true);
    expect(woke).toBe(1);
  });
});
