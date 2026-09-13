import { describe, it, expect } from 'vitest';

/**
 * §5.5 #17-17 ⑱ — **무대의 흐름 선 규약 집행.**
 *
 * 선에 아무 값도 주지 않으면 React Flow 기본값이 나가는데, 그 기본값은 두 가지가 잘못돼 있다.
 *  ① 굵기 1px 이 **흐름 좌표**라 줌 배율이 곱해진다 — `fitView` 로 배율이 내려간 무대에서
 *     선이 1px 미만이 되어 사실상 사라진다(사용자 지적 "확대 축소 때문인지 선들이 잘 안 보여").
 *  ② 선 둘레에 **보이지 않는 20px 띠**(`interactionWidth` 기본값)가 깔려 포인터를 먼저 먹는다 —
 *     선 근처 우클릭이 노드 메뉴를 못 열고 조용히 삼켜진다.
 *
 * 둘 다 "고쳐 놓으면 눈에 안 보이는" 종류라, 다음 사람이 스타일 객체를 정리하다 지우면 아무도
 * 모른 채 회귀한다. 그래서 소스로 고정한다.
 *
 * `node:fs` 를 쓰지 않는다 — 클라이언트 tsconfig 에 Node 타입이 없다
 * (`canvasControlsContract.test.ts` 와 같은 이유·같은 방식).
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
