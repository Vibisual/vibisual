import type { XYPosition } from '@xyflow/react';

/** 카메라와 그 카메라가 보던 배치를 함께 복원한다. 서버의 노드 상태는 보관하지 않는다. */
export interface CanvasViewSnapshot {
  viewport: { x: number; y: number; zoom: number };
  positions: Map<string, XYPosition>;
}

type CanvasViewport = CanvasViewSnapshot['viewport'];
interface PositionedNode { id: string; position: XYPosition }

// 창마다 독립된 모듈 메모리. 프리뷰/stub 탭으로 BubbleMap이 언마운트되어도 보던 자리는 남는다.
const windowViewCache = new Map<string, CanvasViewSnapshot>();

/** 경로 대소문자와 세 축을 그대로 보존한다. 구분자가 들어 있는 경로도 서로 충돌하지 않는다. */
export function canvasViewKey(projectId: string | null, folderId: string | null, interiorKind: string | null): string | null {
  return projectId === null ? null : JSON.stringify([projectId, folderId, interiorKind]);
}

function copySnapshot(snapshot: CanvasViewSnapshot): CanvasViewSnapshot {
  return {
    viewport: { ...snapshot.viewport },
    positions: new Map([...snapshot.positions].map(([id, position]) => [id, { ...position }])),
  };
}

/**
 * 복원을 마친 뷰만 저장한다. B의 데이터를 기다리는 동안 화면에 남은 A의 카메라는 B의 것이 아니다.
 * 호출부는 카메라 복원/최초 정렬이 실제로 끝난 뒤 settle을 부른다.
 */
export class CanvasViewMemory {
  private currentKey: string | null = null;
  private isSettled = false;

  constructor(private readonly cache: Map<string, CanvasViewSnapshot> = windowViewCache) {}

  get key(): string | null { return this.currentKey; }
  get settled(): boolean { return this.isSettled; }

  read(key: string | null): CanvasViewSnapshot | undefined {
    const saved = key === null ? undefined : this.cache.get(key);
    return saved ? copySnapshot(saved) : undefined;
  }

  /** Other projects can change while away; retain cameras, but re-read their server layouts. */
  clearPositions(): void {
    for (const saved of this.cache.values()) saved.positions.clear();
  }

  enter(key: string | null, viewport: CanvasViewport | null | undefined, nodes: readonly PositionedNode[]): CanvasViewSnapshot | undefined {
    if (key === this.currentKey) return this.read(key);
    this.remember(viewport, nodes);
    this.currentKey = key;
    this.isSettled = false;
    return this.read(key);
  }

  remember(viewport: CanvasViewport | null | undefined, nodes: readonly PositionedNode[]): void {
    if (!this.isSettled || this.currentKey === null || !viewport) return;
    this.cache.set(this.currentKey, {
      viewport: { ...viewport },
      positions: new Map(nodes.map((node) => [node.id, { ...node.position }])),
    });
  }

  settle(key: string | null): void {
    if (key !== null && key === this.currentKey) this.isSettled = true;
  }

  leave(viewport: CanvasViewport | null | undefined, nodes: readonly PositionedNode[]): void {
    this.remember(viewport, nodes);
    this.currentKey = null;
    this.isSettled = false;
  }
}
