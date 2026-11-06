import { describe, expect, it } from 'vitest';
import { APP_CANVAS_FACE, APP_NODE_RESIZE } from '@vibisual/shared';

import {
  appNodeForm,
  appNodeResizeBounds,
  appNodeSize,
  aspectLockedResize,
  centerKeepingMove,
  formChangeMove,
  hasUserSize,
  normalizeStageAspect,
  resetSizeMove,
  sameStageAspect,
  stageAspectMove,
  stageFitSize,
} from './appNodeForm.js';
import { SCREEN_CHROME } from './screenChrome.js';

/** §5.4 #36 (F) — 형태는 파생이고 그리는 쪽·옮기는 쪽(가운데 지키기)이 한 판정을 쓴다(두 벌이면 한쪽 판정으로만 커진다). */
const APP = { defaultSize: { width: 80, height: 50 }, screenSize: { width: 208, height: 130 } } as const;

describe('§5.4 #36 (F) 형태 판정', () => {
  it('이어졌거나 결과를 담았으면 화면, 둘 다 아니면 명패', () => {
    expect(appNodeForm({})).toBe('nameplate');
    expect(appNodeForm({ linkedAgentIds: [] })).toBe('nameplate');
    expect(appNodeForm({ file: '' })).toBe('nameplate');
    expect(appNodeForm({ linkedAgentIds: ['agent-1'] })).toBe('screen');
    expect(appNodeForm({ file: 'out/a.png' })).toBe('screen'); // 줄이 끊겨도 결과가 있으면 화면이다
  });

  it('크기는 앱 선언이 곧 값 — 미등록 앱은 저장값', () => {
    const stored = { width: 200, height: 200 };
    expect(appNodeSize(APP, 'nameplate', stored)).toEqual(APP.defaultSize);
    expect(appNodeSize(APP, 'screen', stored)).toEqual(APP.screenSize);
    expect(appNodeSize(undefined, 'screen', stored)).toEqual(stored);
  });
});

describe('§5.4 #36 (F) 형태가 바뀌면 가운데를 지킨다', () => {
  it('크기가 같으면 옮기지 않는다', () => {
    expect(centerKeepingMove({ x: 5, y: 7 }, APP.defaultSize, APP.defaultSize)).toBeNull();
  });

  it('명패 → 화면: 좌상단이 커진 만큼의 절반씩 왼쪽 위로', () => {
    const at = centerKeepingMove({ x: 100, y: 100 }, APP.defaultSize, APP.screenSize);
    expect(at).toEqual({ x: 100 - (208 - 80) / 2, y: 100 - (130 - 50) / 2 });
    // 가운데가 같다.
    expect(at!.x + 208 / 2).toBe(100 + 80 / 2);
    expect(at!.y + 130 / 2).toBe(100 + 50 / 2);
  });

  it('빈 명패에 이으면 옮기고, 이미 화면이면(다른 줄이 있거나 결과가 있으면) 그대로', () => {
    const plate = { x: 0, y: 0, width: 80, height: 50 };
    expect(formChangeMove(APP, plate, { linkedAgentIds: ['a'] })).toEqual({ x: -64, y: -40 });
    expect(formChangeMove(APP, { ...plate, linkedAgentIds: ['b'] }, { linkedAgentIds: ['b', 'a'] })).toBeNull();
    expect(formChangeMove(APP, { ...plate, file: 'x.png' }, { file: 'x.png', linkedAgentIds: ['a'] })).toBeNull();
  });

  it('결과 없는 화면의 마지막 줄을 끊으면 명패로 — 가운데로 돌아온다', () => {
    const screen = { x: -64, y: -40, width: 208, height: 130, linkedAgentIds: ['a'] };
    expect(formChangeMove(APP, screen, { linkedAgentIds: [] })).toEqual({ x: 0, y: 0 });
    // 결과가 남아 있으면 줄을 다 끊어도 화면이다.
    expect(formChangeMove(APP, { ...screen, file: 'x.png' }, { linkedAgentIds: [], file: 'x.png' })).toBeNull();
  });

  it('미등록 앱은 저장값 크기라 형태가 바뀌어도 옮기지 않는다', () => {
    expect(formChangeMove(undefined, { x: 0, y: 0, width: 80, height: 50 }, { linkedAgentIds: ['a'] })).toBeNull();
  });
});

/** §5.4 #36 (G) — 정한 형태가 지금 형태와 같을 때만 저장 크기를 믿는다(옛 버블의 200×200·240×150 이 갑자기 커지면 안 된다). */
describe('§5.4 #36 (G) 크기 조절', () => {
  it('정한 형태가 같으면 저장값, 다르거나 없으면 선언값', () => {
    expect(appNodeSize(APP, 'screen', { width: 320, height: 200, sizedForm: 'screen' })).toEqual({ width: 320, height: 200 });
    expect(appNodeSize(APP, 'nameplate', { width: 320, height: 200, sizedForm: 'screen' })).toEqual(APP.defaultSize);
    expect(appNodeSize(APP, 'screen', { width: 240, height: 150 })).toEqual(APP.screenSize); // 옛 저장값은 믿지 않는다
  });

  it('저장값은 그 형태의 한도로 자른다', () => {
    const big = appNodeSize(APP, 'screen', { width: 99_999, height: 1, sizedForm: 'screen' });
    expect(big).toEqual({ width: APP_NODE_RESIZE.maxWidth, height: APP_NODE_RESIZE.screenMinHeight });
    const tiny = appNodeSize(APP, 'nameplate', { width: 1, height: 1, sizedForm: 'nameplate' });
    expect(tiny).toEqual({ width: APP_NODE_RESIZE.nameplateMinWidth, height: APP_NODE_RESIZE.nameplateMinHeight });
  });

  it('화면의 하한은 머리줄·결과·조작줄이 들어갈 만큼 — 명패보다 크다', () => {
    const screen = appNodeResizeBounds('screen');
    const plate = appNodeResizeBounds('nameplate');
    expect(screen.minWidth).toBeGreaterThan(plate.minWidth);
    expect(screen.minHeight).toBeGreaterThan(plate.minHeight);
    // 선언된 화면 크기가 하한 안쪽이어야 [기본 크기로] 가 하한에 잘리지 않는다.
    expect(APP.screenSize.width).toBeGreaterThanOrEqual(screen.minWidth);
    expect(APP.screenSize.height).toBeGreaterThanOrEqual(screen.minHeight);
  });

  it('형태가 바뀌어도 정한 크기는 남는다 — 가운데 지키기는 실제로 그려지던 크기 기준', () => {
    const sized = { x: 0, y: 0, width: 400, height: 250, sizedForm: 'screen' as const, linkedAgentIds: ['a'] };
    // 결과 없는 화면의 마지막 줄을 끊으면 명패(선언 80×50)로 — 400×250 의 가운데를 지킨다.
    expect(formChangeMove(APP, sized, { linkedAgentIds: [] })).toEqual({ x: (400 - 80) / 2, y: (250 - 50) / 2 });
  });

  it('[기본 크기로] — 정한 크기가 있을 때만, 가운데를 지키며 선언 크기로', () => {
    const sized = { x: 10, y: 20, width: 400, height: 250, sizedForm: 'screen' as const, file: 'out/a.mp4' };
    expect(hasUserSize(sized)).toBe(true);
    expect(resetSizeMove(APP, sized)).toEqual({ x: 10 + (400 - 208) / 2, y: 20 + (250 - 130) / 2 });
    // 다른 형태에서 정한 크기는 지금 형태의 "정한 크기"가 아니다.
    expect(hasUserSize({ ...sized, sizedForm: 'nameplate' })).toBe(false);
    expect(resetSizeMove(APP, { ...sized, sizedForm: 'nameplate' })).toBeNull();
    expect(resetSizeMove(undefined, sized)).toBeNull();
  });
});

/** §5.4 #36 (J) ① — 결과 칸 비율 = 문서 판형. 결과 칸 면적은 `stageArea`, 머리줄·조작줄·테두리는 비율 밖이다. */
describe('§5.4 #36 (J) ① 판형 맞춤', () => {
  const screen = appNodeResizeBounds('screen');
  const stageOf = (s: { width: number; height: number }): { w: number; h: number } => ({
    w: s.width - SCREEN_CHROME.width,
    h: s.height - SCREEN_CHROME.height,
  });

  it('16:9 의 기본 크기는 결과 칸 240×135 + 머리줄·조작줄', () => {
    const size = stageFitSize(16 / 9, screen);
    expect(stageOf(size)).toEqual({ w: 240, h: 135 });
    expect(size).toEqual({ width: 240 + SCREEN_CHROME.width, height: 135 + SCREEN_CHROME.height });
  });

  it('비율이 달라도 결과 칸 면적은 같다(한도 안이면) — 1:1 은 180×180', () => {
    const size = stageFitSize(1, screen);
    expect(stageOf(size)).toEqual({ w: 180, h: 180 });
    expect(stageOf(size).w * stageOf(size).h).toBe(APP_CANVAS_FACE.stageArea);
  });

  it('하한 폭에 걸리면 폭을 하한에 두고 비율로 높이를 계산한다(9:16)', () => {
    const size = stageFitSize(9 / 16, screen);
    expect(size.width).toBe(screen.minWidth);
    const stage = stageOf(size);
    expect(stage.w / stage.h).toBeCloseTo(9 / 16, 2);
  });

  it('상한에 걸리면 그 변을 상한에 두고 맞은편을 다시 계산한다', () => {
    const tall = stageFitSize(0.25, screen, APP_NODE_RESIZE.maxWidth);
    expect(tall.height).toBe(screen.maxHeight);
    expect(stageOf(tall).w / stageOf(tall).h).toBeCloseTo(0.25, 2);
    const wide = stageFitSize(4, screen, 99_999);
    expect(wide.width).toBe(screen.maxWidth);
    expect(stageOf(wide).w / stageOf(wide).h).toBeCloseTo(4, 1); // 정수 px 로 반올림한 만큼만 어긋난다
  });

  it('비율이 있는 화면은 그 비율로 짓고, 정한 크기는 폭만 지킨다 — 명패는 비율을 보지 않는다', () => {
    expect(appNodeSize(APP, 'screen', { width: 1, height: 1, stageAspect: 16 / 9 })).toEqual(stageFitSize(16 / 9, screen));
    const sized = appNodeSize(APP, 'screen', { width: 402, height: 999, sizedForm: 'screen', stageAspect: 16 / 9 });
    expect(sized.width).toBe(402);
    expect(stageOf(sized)).toEqual({ w: 400, h: 225 });
    expect(appNodeSize(APP, 'nameplate', { width: 1, height: 1, stageAspect: 16 / 9 })).toEqual(APP.defaultSize);
    // 못 쓰는 비율은 없는 것과 같다 — 종전 선언 크기.
    expect(appNodeSize(APP, 'screen', { width: 1, height: 1, stageAspect: Number.NaN })).toEqual(APP.screenSize);
  });

  it('비율은 상·하한으로 자르고, 아주 가까운 두 비율은 같은 것으로 본다', () => {
    expect(normalizeStageAspect(100)).toBe(APP_CANVAS_FACE.stageAspectMax);
    expect(normalizeStageAspect(0.001)).toBe(APP_CANVAS_FACE.stageAspectMin);
    expect(normalizeStageAspect(-1)).toBeNull();
    expect(normalizeStageAspect('1')).toBeNull();
    expect(sameStageAspect(16 / 9, 16 / 9 + APP_CANVAS_FACE.stageAspectEpsilon / 2)).toBe(true);
    expect(sameStageAspect(16 / 9, 9 / 16)).toBe(false);
    expect(sameStageAspect(undefined, null)).toBe(true);
    expect(sameStageAspect(1, undefined)).toBe(false);
  });

  it('비율이 바뀌면 가운데를 지킨다(크기가 그대로면 옮기지 않는다)', () => {
    const b = { x: 100, y: 100, width: 208, height: 130, ref: 'doc-1' };
    const at = stageAspectMove(APP, b, 9 / 16);
    const to = stageFitSize(9 / 16, screen);
    expect(at).toEqual({ x: 100 + (208 - to.width) / 2, y: 100 + (130 - to.height) / 2 });
    const settled = { ...b, ...at!, stageAspect: 9 / 16 };
    expect(stageAspectMove(APP, settled, 9 / 16)).toBeNull();
    // 명패에서는 비율이 크기를 바꾸지 않는다.
    expect(stageAspectMove(APP, { x: 0, y: 0, width: 80, height: 50 }, 9 / 16)).toBeNull();
  });
});

/** §5.4 #36 (J) ① — 크기 조절은 폭에서 높이를 계산해 결과 칸 비율을 지킨다(손잡이가 옮긴 변의 맞은편은 그대로). */
describe('§5.4 #36 (J) ① 비율을 지키는 크기 조절', () => {
  const screen = appNodeResizeBounds('screen');
  const aspect = 16 / 9;
  const start = { x: 0, y: 0, ...stageFitSize(aspect, screen) };
  const stageRatio = (r: { width: number; height: number }): number =>
    (r.width - SCREEN_CHROME.width) / (r.height - SCREEN_CHROME.height);

  it('오른쪽 변을 끌면 폭에서 높이를 — 위·왼쪽은 그대로', () => {
    const out = aspectLockedResize(start, { ...start, width: 402 }, aspect, screen);
    expect(out).toMatchObject({ x: 0, y: 0, width: 402 });
    expect(stageRatio(out)).toBeCloseTo(aspect, 2);
  });

  it('아래 변만 끌면 높이에서 폭을', () => {
    const out = aspectLockedResize(start, { ...start, height: 273 }, aspect, screen);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.height).toBe(273);
    expect(stageRatio(out)).toBeCloseTo(aspect, 2);
  });

  it('왼쪽 위 모서리는 오른쪽 아래 가장자리를 지킨다', () => {
    const proposed = { x: -100, y: -40, width: start.width + 100, height: start.height + 40 };
    const out = aspectLockedResize(start, proposed, aspect, screen);
    expect(out.x + out.width).toBe(start.x + start.width);
    expect(out.y + out.height).toBe(start.y + start.height);
    expect(stageRatio(out)).toBeCloseTo(aspect, 2);
  });

  it('한도 밖으로 끌어도 한도 안이다', () => {
    const tiny = aspectLockedResize(start, { ...start, width: 10 }, aspect, screen);
    expect(tiny.width).toBeGreaterThanOrEqual(screen.minWidth);
    expect(tiny.height).toBeGreaterThanOrEqual(screen.minHeight);
    const huge = aspectLockedResize(start, { ...start, width: 99_999 }, aspect, screen);
    expect(huge.width).toBeLessThanOrEqual(screen.maxWidth);
    expect(huge.height).toBeLessThanOrEqual(screen.maxHeight);
  });
});
