import { describe, expect, it } from 'vitest';
import { canvasViewKey, CanvasViewMemory, type CanvasViewSnapshot } from './canvasViewMemory.js';

const A = canvasViewKey('/projects/alpha', null, null)!;
const B = canvasViewKey('/projects/beta', null, null)!;
const VIEW_A = { x: 120, y: -60, zoom: 0.7 };
const VIEW_B = { x: -300, y: 240, zoom: 1.4 };

function nodes(x: number, y: number): { id: string; position: { x: number; y: number } }[] {
  return [{ id: '__trash__', position: { x, y } }];
}

describe('canvasViewKey', () => {
  it('프로젝트가 없으면 저장할 뷰도 없다', () => {
    expect(canvasViewKey(null, null, null)).toBeNull();
    expect(canvasViewKey(null, 'folder', 'trash')).toBeNull();
  });

  it('프로젝트 경로·폴더·내부 뷰를 서로 구분하고 경로 대소문자를 보존한다', () => {
    const keys = [
      canvasViewKey('/projects/alpha', null, null),
      canvasViewKey('/projects/Alpha', null, null),
      canvasViewKey('/other/alpha', null, null),
      canvasViewKey('/projects/alpha', 'folder', null),
      canvasViewKey('/other/alpha', 'folder', null),
      canvasViewKey('/projects/alpha', null, 'trash'),
      canvasViewKey('/projects/alpha', 'trash', null),
      canvasViewKey('/projects/alpha|folder', null, null),
      canvasViewKey('/projects/alpha', 'folder|null', null),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(JSON.parse(canvasViewKey('/projects/alpha', 'folder', 'trash')!))
      .toEqual(['/projects/alpha', 'folder', 'trash']);
  });
});

describe('CanvasViewMemory', () => {
  it('프로젝트를 떠나면 폴더의 옛 배치도 버리되 카메라는 보존한다', () => {
    const memory = new CanvasViewMemory(new Map());
    const folder = canvasViewKey('/projects/alpha', 'folder', null)!;
    memory.enter(A, null, []);
    memory.settle(A);
    memory.enter(folder, VIEW_A, nodes(10, 20));
    memory.settle(folder);
    memory.enter(B, VIEW_B, nodes(30, 40));
    memory.clearPositions();
    expect(memory.read(A)).toEqual({ viewport: VIEW_A, positions: new Map() });
    expect(memory.read(folder)).toEqual({ viewport: VIEW_B, positions: new Map() });
  });

  it('A → B → A에서 각 프로젝트의 카메라와 배치를 되찾는다', () => {
    const memory = new CanvasViewMemory(new Map());
    expect(memory.key).toBeNull();
    expect(memory.settled).toBe(false);
    expect(memory.enter(A, null, [])).toBeUndefined();
    memory.settle(A);
    expect(memory.enter(B, VIEW_A, nodes(10, 20))).toBeUndefined();
    memory.settle(B);
    expect(memory.enter(A, VIEW_B, nodes(30, 40))).toEqual({
      viewport: VIEW_A, positions: new Map([['__trash__', { x: 10, y: 20 }]]),
    });
    expect(memory.read(B)).toEqual({
      viewport: VIEW_B, positions: new Map([['__trash__', { x: 30, y: 40 }]]),
    });
    expect(memory.settled).toBe(false);
  });

  it('B가 로딩 중이면 화면에 남아 있는 A의 카메라를 B에 저장하지 않는다', () => {
    const memory = new CanvasViewMemory(new Map());
    memory.enter(A, null, []);
    memory.settle(A);
    memory.enter(B, VIEW_A, nodes(10, 20));
    memory.remember(VIEW_A, nodes(10, 20));
    memory.settle(A); // 늦게 도착한 이전 뷰의 완료도 현재 뷰를 확정하지 않는다.
    expect(memory.settled).toBe(false);
    expect(memory.enter(A, VIEW_A, nodes(10, 20))?.viewport).toEqual(VIEW_A);
    expect(memory.read(B)).toBeUndefined();
  });

  it('복원 대기 중 떠나도 B의 기존 저장본을 덮어쓰지 않는다', () => {
    const saved: CanvasViewSnapshot = { viewport: VIEW_B, positions: new Map() };
    const memory = new CanvasViewMemory(new Map([[B, saved]]));
    expect(memory.enter(B, VIEW_A, nodes(10, 20))?.viewport).toEqual(VIEW_B);
    memory.leave(VIEW_A, nodes(10, 20));
    expect(memory.read(B)).toEqual(saved);
    expect(memory.key).toBeNull();
    expect(memory.settled).toBe(false);
  });

  it('같은 뷰의 실시간 갱신은 확정 상태나 저장본을 바꾸지 않는다', () => {
    const memory = new CanvasViewMemory(new Map());
    memory.enter(A, null, []);
    memory.settle(A);
    memory.remember(VIEW_A, nodes(10, 20));
    expect(memory.enter(A, VIEW_B, nodes(30, 40))?.viewport).toEqual(VIEW_A);
    expect(memory.settled).toBe(true);
    expect(memory.read(A)?.positions.get('__trash__')).toEqual({ x: 10, y: 20 });
  });

  it('프리뷰 탭으로 언마운트한 뒤 새 인스턴스도 같은 창의 기억을 복원한다', () => {
    const cache = new Map<string, CanvasViewSnapshot>();
    const first = new CanvasViewMemory(cache);
    first.enter(A, null, []);
    first.settle(A);
    first.leave(VIEW_A, nodes(10, 20));
    const remounted = new CanvasViewMemory(cache);
    expect(remounted.enter(A, null, [])).toEqual({
      viewport: VIEW_A, positions: new Map([['__trash__', { x: 10, y: 20 }]]),
    });
    expect(remounted.settled).toBe(false);
  });

  it('프로젝트가 없는 화면은 저장하지 않고 떠나는 프로젝트만 기억한다', () => {
    const cache = new Map<string, CanvasViewSnapshot>();
    const memory = new CanvasViewMemory(cache);
    memory.enter(A, null, []);
    memory.settle(A);
    expect(memory.enter(null, VIEW_A, nodes(10, 20))).toBeUndefined();
    memory.settle(null);
    memory.remember(VIEW_B, nodes(30, 40));
    expect(memory.settled).toBe(false);
    expect(cache.size).toBe(1);
    expect(memory.enter(A, VIEW_B, [])?.viewport).toEqual(VIEW_A);
  });

  it('카메라 참조가 없으면 기존 저장본을 보존한다', () => {
    const memory = new CanvasViewMemory(new Map());
    memory.enter(A, null, []);
    memory.settle(A);
    memory.remember(VIEW_A, nodes(10, 20));
    memory.remember(undefined, nodes(30, 40));
    memory.leave(null, []);
    expect(memory.read(A)?.viewport).toEqual(VIEW_A);
    expect(memory.read(A)?.positions.get('__trash__')).toEqual({ x: 10, y: 20 });
  });

  it('저장 입력과 복원 출력의 좌표 변경이 기억에 번지지 않는다', () => {
    const memory = new CanvasViewMemory(new Map());
    const viewport = { ...VIEW_A };
    const liveNodes = nodes(10, 20);
    memory.enter(A, null, []);
    memory.settle(A);
    memory.remember(viewport, liveNodes);
    viewport.zoom = 2;
    liveNodes[0]!.position.x = 999;
    const restored = memory.read(A)!;
    expect(restored.viewport).toEqual(VIEW_A);
    expect(restored.positions.get('__trash__')).toEqual({ x: 10, y: 20 });
    restored.viewport.x = 999;
    restored.positions.get('__trash__')!.y = 999;
    restored.positions.set('new', { x: 0, y: 0 });
    expect(memory.read(A)).toEqual({
      viewport: VIEW_A, positions: new Map([['__trash__', { x: 10, y: 20 }]]),
    });
  });
});
