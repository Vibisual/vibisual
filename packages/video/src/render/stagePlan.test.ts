import { describe, expect, it } from 'vitest';
import { resolveTimeline } from '../resolveTimeline.js';
import type { VideoDoc, VideoItem } from '../types.js';
import { STAGE_WARM_PRIME_OPACITY } from './stageWarm.js';
import { planDurationMs, planKeyframes, planStage, planTransform } from './stagePlan.js';

/**
 * §5.13 (Z) 41-3 — 합성기 예약(순수): 앞 몇 초를 프레임마다 같은 그리기 목록으로 뽑아 상자마다 키프레임을 만든다. 컷은 한 프레임에
 * 걸쳐 녹이지 않고 바로 바뀌고, 곧 보일 컴포지션은 거의 안 보이게 깨워 두며, 크기가 바뀌거나 잘라 보이기가 걸린 상자는 예약하지
 * 않는다(화면 스레드가 맞춘다).
 */

const W = 1080;
const H = 1920;

function doc(items: VideoItem[], transition?: { kind: 'push' | 'wipe' | 'cut'; duration: number }): VideoDoc {
  return {
    schemaVersion: 1, id: 'd', title: 'd', version: 1, size: { width: W, height: H }, fps: 30,
    chapters: [
      { id: 'a', title: 'a', duration: 2, status: 'done' },
      { id: 'b', title: 'b', duration: 2, status: 'done', ...(transition ? { transition } : {}) },
    ],
    tracks: [{ id: 'v', kind: 'visual', items }],
    assets: { comp: { id: 'comp', kind: 'composition', source: { kind: 'file', path: 'c.html' } } },
    createdAt: 0, updatedAt: 0,
  } as unknown as VideoDoc;
}

const inChapter = (id: string, chapter: string, extra: Partial<VideoItem> = {}): VideoItem =>
  ({ id, kind: 'composition', assetId: 'comp', chapterId: chapter, at: { chapter, offset: 0 }, duration: 2, ...extra }) as unknown as VideoItem;

describe('§5.13 (Z) 41-3 planStage — 앞 구간을 프레임마다 뽑는다', () => {
  it('컷: 들어오는 장면은 시작 프레임에서 바로 보이고(한 프레임에 걸쳐 녹이지 않는다) 그 전에는 거의 안 보이게 깨워 둔다', () => {
    const d = doc([inChapter('one', 'a'), inChapter('two', 'b')]);
    const plan = planStage(d, resolveTimeline(d), 1, 3, 30);
    expect(plan.from).toBe(1);
    expect(plan.times).toHaveLength(91);
    const two = plan.items.get('two')!;
    expect(two.firstIndex).toBe(30); // 2.0s = 1s 뒤 30프레임
    expect(two.plannable).toBe(true);
    const keys = planKeyframes(two, { primeBefore: true });
    expect(keys[29]).toMatchObject({ opacity: String(STAGE_WARM_PRIME_OPACITY), easing: 'step-end' });
    expect(keys[30]).toMatchObject({ opacity: '1', easing: 'linear' });
    const one = plan.items.get('one')!;
    expect(one.lastIndex).toBe(29);
    const oneKeys = planKeyframes(one);
    expect(oneKeys[29]).toMatchObject({ opacity: '1', easing: 'step-end' });
    expect(oneKeys[30]!.opacity).toBe('0');
    expect(keys[0]!.offset).toBe(0);
    expect(keys.at(-1)!.offset).toBe(1);
    expect(planDurationMs(plan)).toBeCloseTo(3000, 6);
  });

  it('push 전환은 자리 이동(dx)으로 예약된다 — 상자 자리는 기준에 두고 translate 만 바뀐다', () => {
    const d = doc([inChapter('one', 'a'), inChapter('two', 'b')], { kind: 'push', duration: 0.5 });
    const tl = resolveTimeline(d);
    const start = tl.chapters[1]!.start;
    const plan = planStage(d, tl, Math.floor(start * 30) / 30, 1, 30);
    const two = plan.items.get('two')!;
    expect(two.plannable).toBe(true);
    // 기준 자리 = 처음 보이는 프레임(오른쪽 밖) — 그 뒤는 기준에서 왼쪽으로 옮겨 제자리(문서 x=0)에 선다.
    expect(two.base.x).toBe(two.first.transform.x);
    expect(two.base.x).toBeGreaterThan(W * 0.9);
    expect(two.frames[two.firstIndex]!.dx).toBe(0);
    const settled = two.frames.at(-1)!;
    expect(two.base.x + settled.dx).toBeCloseTo(0, 6);
    // 나가는 장면은 왼쪽으로 밀려 나간다.
    const one = plan.items.get('one')!;
    expect(one.frames[one.lastIndex]!.dx).toBeLessThan(0);
  });

  it('잘라 보이기(wipe)가 걸린 상자는 예약하지 않는다(합성기가 못 돌린다 — 화면 스레드가 맞춘다)', () => {
    const d = doc([inChapter('one', 'a'), inChapter('two', 'b')], { kind: 'wipe', duration: 0.5 });
    const tl = resolveTimeline(d);
    const plan = planStage(d, tl, Math.floor(tl.chapters[1]!.start * 30) / 30, 1, 30);
    expect(plan.items.get('two')!.plannable).toBe(false);
  });

  it('키프레임(배율·이동)은 상자 크기를 바꾸지 않으므로 transform 으로 예약된다', () => {
    const grow: VideoItem = {
      id: 'grow', kind: 'footage', assetId: 'comp', at: 0, duration: 4,
      keyframes: [{ t: 0, scale: 1, dx: 0 }, { t: 4, scale: 2, dx: 400 }],
      transform: { x: 100, y: 200, width: 500, height: 500 },
    } as unknown as VideoItem;
    const d = doc([grow]);
    const item = planStage(d, resolveTimeline(d), 0, 1, 30).items.get('grow')!;
    expect(item.plannable).toBe(true);
    expect(item.base).toEqual({ x: 100, y: 200, width: 500, height: 500 });
    const last = item.frames.at(-1)!;
    expect(last.scale).toBeGreaterThan(1);
    expect(last.dx).toBeGreaterThan(0);
  });

  it('끝 너머는 마지막 장에 머문다(재생이 끝에서 멈추거나 처음으로 돌아갈 때까지 빈 화면이 끼지 않게)', () => {
    const d = doc([inChapter('one', 'a'), inChapter('two', 'b')]);
    const tl = resolveTimeline(d);
    const plan = planStage(d, tl, tl.duration - 0.5, 2, 30);
    const two = plan.items.get('two')!;
    expect(two.frames.at(-1)).not.toBeNull();
  });
});

describe('§5.13 (Z) 41-3 planTransform — 기준 자리에서의 이동 → 가운데 기준 회전·배율', () => {
  it('placeSlot 과 같은 순서로 적고 -0 을 쓰지 않는다', () => {
    expect(planTransform({ dx: 12.34567, dy: -0, rotation: 0, scale: 1 })).toBe('translate(12.346px, 0px) rotate(0deg) scale(1)');
  });
});
