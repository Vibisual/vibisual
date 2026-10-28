import { describe, it, expect } from 'vitest';
import { FOREIGN_FLOW_ATTR, isCanvasSurfaceTarget } from './canvasSurface.js';

/** React Flow 안에서 시작한 손짓만 캔버스다 — DOM 상 자식인 창(IDE·보드)의 길게 누르기가 메뉴를 열면 폰에서 글자 선택이 가로채인다. */

/** `closest` 셈법(콤마 후보 중 하나라도 조상)을 클래스 선택자에 한해 흉내 낸다. 속성 선택자는 글자 그대로 조상에 넣는다. */
function targetInside(...ancestorClasses: string[]) {
  const chain = ancestorClasses.map((c) => c.replace(/^\./, ''));
  return {
    closest(selector: string): unknown {
      const wanted = selector.split(',').map((s) => s.trim().replace(/^\./, ''));
      return chain.some((c) => wanted.includes(c)) ? { className: chain[0] } : null;
    },
  };
}

describe('isCanvasSurfaceTarget — 캔버스에서 시작한 손짓만', () => {
  it('빈 캔버스(pane)를 누르면 연다', () => {
    expect(isCanvasSurfaceTarget(targetInside('react-flow__pane', 'react-flow'))).toBe(true);
  });

  it('엣지 층·뷰포트처럼 캔버스 안쪽 어디서든 연다', () => {
    expect(isCanvasSurfaceTarget(targetInside('react-flow__edges', 'react-flow__viewport', 'react-flow'))).toBe(true);
  });

  it('버블(노드) 위에서는 열지 않는다 — 버블은 자기 메뉴가 있다', () => {
    expect(isCanvasSurfaceTarget(targetInside('bubble-body', 'react-flow__node', 'react-flow__pane', 'react-flow'))).toBe(false);
  });

  it('캔버스 조작 패널·미니맵 위에서는 열지 않는다', () => {
    for (const chrome of ['react-flow__controls', 'react-flow__minimap', 'react-flow__panel', 'react-flow__attribution']) {
      expect(isCanvasSurfaceTarget(targetInside(chrome, 'react-flow'))).toBe(false);
    }
  });
});

describe('isCanvasSurfaceTarget — 캔버스를 덮고 선 창들', () => {
  it('IDE 창 본문에서 꾹 눌러도 캔버스 메뉴는 열리지 않는다(글자 선택이 우선)', () => {
    // IDE 창은 fixed 라 화면에서는 캔버스 위지만, DOM 으로는 컨테이너의 자식 — `.react-flow` 밖이다.
    expect(isCanvasSurfaceTarget(targetInside('prose', 'ide-stream-body'))).toBe(false);
  });

  it('모달 IDE 의 백드롭에서도 열리지 않는다', () => {
    expect(isCanvasSurfaceTarget(targetInside('bg-gray-950/95'))).toBe(false);
  });

  it('보드 패널·팝업 등 캔버스 밖 어디서도 열리지 않는다', () => {
    expect(isCanvasSurfaceTarget(targetInside('conti-board-panel'))).toBe(false);
    expect(isCanvasSurfaceTarget(targetInside('task-edge-popup'))).toBe(false);
  });
});

describe('isCanvasSurfaceTarget — 캔버스 버블을 빌려 그린 남의 판(§5.5 #17-50)', () => {
  // IDE 세션 버블 지도는 캔버스 노드를 띄우는 React Flow 다 — 그 판도 `.react-flow` 지만 캔버스가 아니다.
  const foreign = `[${FOREIGN_FLOW_ATTR}]`;

  it('지도의 빈 곳을 우클릭·길게 눌러도 캔버스 만들기 메뉴는 열리지 않는다', () => {
    expect(isCanvasSurfaceTarget(targetInside('react-flow__pane', 'react-flow', foreign, 'ide-stream-body'))).toBe(false);
  });

  it('지도의 선 층에서도 열리지 않는다', () => {
    expect(isCanvasSurfaceTarget(targetInside('react-flow__edges', 'react-flow__viewport', 'react-flow', foreign))).toBe(false);
  });

  it('표식이 없는 캔버스 판은 종전대로 연다', () => {
    expect(isCanvasSurfaceTarget(targetInside('react-flow__pane', 'react-flow'))).toBe(true);
  });
});

describe('isCanvasSurfaceTarget — 판정할 수 없는 대상', () => {
  it('대상이 없거나 closest 가 없으면 열지 않는다(애매하면 안 연다)', () => {
    expect(isCanvasSurfaceTarget(null)).toBe(false);
    expect(isCanvasSurfaceTarget(undefined)).toBe(false);
    expect(isCanvasSurfaceTarget({})).toBe(false);
    expect(isCanvasSurfaceTarget({ closest: 'not a function' })).toBe(false);
  });
});
