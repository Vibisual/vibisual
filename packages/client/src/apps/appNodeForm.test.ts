import { describe, expect, it } from 'vitest';
import { APP_NODE_RESIZE } from '@vibisual/shared';

import {
  appNodeForm,
  appNodeResizeBounds,
  appNodeSize,
  centerKeepingMove,
  formChangeMove,
  hasUserSize,
  resetSizeMove,
} from './appNodeForm.js';

/**
 * §5.4 #36 (F) — 앱 노드의 형태(명패 ↔ 화면)는 저장값이 아니라 파생이다. 그리는 쪽과 옮기는 쪽(잇기·끊기의
 * 가운데 지키기)이 같은 판정을 써야 해서 한 벌로 묶었다 — 두 벌이 되면 노드가 한쪽 판정으로만 커진다.
 */
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

/**
 * §5.4 #36 (G) — 크기는 사용자가 바꾸고 **형태에 붙는다**. 정한 형태가 지금 형태와 같을 때만 저장값을 믿는다 —
 * 정한 적 없는 옛 버블(200×200·240×150 이 저장된 것)이 갑자기 커지면 안 된다.
 */
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
