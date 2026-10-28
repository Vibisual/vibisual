import { describe, it, expect } from 'vitest';

/**
 * §5.5 #17-17 ⑱ — 무대 흐름 선이 React Flow 기본값을 쓰지 않는가: 굵기 1px 흐름 좌표는 `fitView` 축소에서 사라지고,
 * `interactionWidth` 20px 띠는 선 근처 우클릭을 먹는다. `node:fs` 대신 glob(클라 tsconfig 에 Node 타입 없음).
 */

const sources = import.meta.glob('./IDEGoalMapView.tsx', { query: '?raw', import: 'default', eager: true });
const view = Object.values(sources as Record<string, string>)[0] ?? '';

describe('무대 흐름 선 — 줌이 걸려도 보인다', () => {
  it('무대 뷰 소스를 읽어 왔다', () => {
    expect(view.length).toBeGreaterThan(0);
  });

  it('굵기를 화면 좌표로 못 박는다 (non-scaling-stroke)', () => {
    expect(view).toMatch(/vectorEffect:\s*'non-scaling-stroke'/);
  });

  it('React Flow 기본 굵기에 기대지 않는다 — 선 색·굵기를 직접 준다', () => {
    expect(view).toMatch(/STAGE_EDGE\s*=\s*\{/);
    expect(view).toMatch(/strokeWidth:\s*running\s*\?\s*STAGE_EDGE\.WIDTH_RUNNING\s*:\s*STAGE_EDGE\.WIDTH/);
  });

  it('선 둘레의 보이지 않는 20px 띠를 없앤다', () => {
    expect(view).toMatch(/interactionWidth:\s*0/);
  });

  it('선 위 우클릭도 빈 자리와 같은 메뉴를 연다', () => {
    expect(view).toMatch(/onEdgeContextMenu=/);
  });
});
