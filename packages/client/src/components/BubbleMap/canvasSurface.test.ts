import { describe, it, expect } from 'vitest';
import { isCanvasSurfaceTarget } from './canvasSurface.js';

/**
 * 캔버스 생성 메뉴 자리 판정 회귀.
 *
 * 고정하는 약속: **React Flow 안에서 시작한 손짓만** 캔버스로 본다. 화면에서는 캔버스를 덮지만
 * DOM 으로는 컨테이너의 자식인 창들(IDE·보드 패널)에서 시작한 터치가 캔버스 메뉴를 열면,
 * 폰에서 글자를 꾹 눌러 선택하려는 손짓이 매번 메뉴에 가로채인다(사용자 보고).
 */

/**
 * 조상 클래스 목록으로 만든 가짜 대상. `closest` 의 셈법(콤마로 나눈 후보 중 하나라도 조상에
 * 있으면 그 조상)을 클래스 선택자에 한해 그대로 흉내낸다.
 */
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

describe('isCanvasSurfaceTarget — 판정할 수 없는 대상', () => {
  it('대상이 없거나 closest 가 없으면 열지 않는다(애매하면 안 연다)', () => {
    expect(isCanvasSurfaceTarget(null)).toBe(false);
    expect(isCanvasSurfaceTarget(undefined)).toBe(false);
    expect(isCanvasSurfaceTarget({})).toBe(false);
    expect(isCanvasSurfaceTarget({ closest: 'not a function' })).toBe(false);
  });
});
