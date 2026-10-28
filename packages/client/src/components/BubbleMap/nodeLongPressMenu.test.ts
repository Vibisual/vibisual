import { describe, expect, it } from 'vitest';
import {
  NODE_LONG_PRESS_GHOST_MS,
  NODE_LONG_PRESS_GHOST_RADIUS,
  isNodeLongPressGhost,
  isNodeLongPressTarget,
} from './nodeLongPressMenu.js';

/**
 * 길게 누르기(= 우클릭 메뉴) 판정 회귀 — 메뉴를 가진 자리에서만 열고 제 손짓이 있는 자리(입력칸·`nodrag`·끌리는 노드)에선 열지 않는다.
 * 뗀 뒤 흉내 마우스 이벤트는 그 자리 근처·잠깐만 삼킨다(넓으면 다음 탭이 먹히고, 안 삼키면 메뉴 첫 줄이 눌린다).
 */

interface FakeEl {
  tag?: string;
  classes?: string[];
  attrs?: Record<string, string>;
}

/** 이 파일의 선택자 문법(태그 · `.a.b` · `[k="v"]` · `[k]:not([k="false"])`)만 흉내 내는 최소 matcher. */
function matches(el: FakeEl, raw: string): boolean {
  const sel = raw.trim();
  const notFalse = /^\[([\w-]+)\]:not\(\[\1="false"\]\)$/.exec(sel);
  if (notFalse) {
    const v = el.attrs?.[notFalse[1]!];
    return v !== undefined && v !== 'false';
  }
  const attr = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel);
  if (attr) return el.attrs?.[attr[1]!] === attr[2];
  if (sel.startsWith('.')) return sel.slice(1).split('.').every((c) => el.classes?.includes(c) ?? false);
  return el.tag === sel;
}

/** 안쪽(대상)부터 바깥 조상 순서의 사슬로 만든 가짜 대상 — `closest` 는 가장 가까운 일치 조상을 돌려준다. */
function targetInside(...chain: FakeEl[]) {
  return {
    closest(selector: string): unknown {
      const parts = selector.split(',');
      return chain.find((el) => parts.some((p) => matches(el, p))) ?? null;
    },
  };
}

const NODE: FakeEl = { classes: ['react-flow__node', 'react-flow__node-bubble', 'draggable'] };
const FLOW: FakeEl = { classes: ['react-flow'] };

describe('isNodeLongPressTarget — 메뉴를 가진 자리에서만', () => {
  it('버블 몸통·노드 안 어디든 길게 누르면 연다', () => {
    expect(isNodeLongPressTarget(targetInside({ classes: ['bubble-body'] }, NODE, FLOW))).toBe(true);
    expect(isNodeLongPressTarget(targetInside({ tag: 'span' }, { tag: 'button' }, NODE, FLOW))).toBe(true);
  });

  it('여럿을 고른 묶음 상자 위에서도 연다(묶음 메뉴)', () => {
    expect(isNodeLongPressTarget(targetInside({ classes: ['react-flow__nodesselection-rect'] }, { classes: ['react-flow__nodesselection'] }, FLOW))).toBe(true);
  });

  it('빈 캔버스·캔버스 밖은 이 길이 아니다(빈 곳은 생성 메뉴 길이 따로 있다)', () => {
    expect(isNodeLongPressTarget(targetInside({ classes: ['react-flow__pane'] }, FLOW))).toBe(false);
    expect(isNodeLongPressTarget(targetInside({ classes: ['ide-stream-body'] }))).toBe(false);
  });
});

describe('isNodeLongPressTarget — 제 손짓이 있는 자리는 건드리지 않는다', () => {
  it('입력칸·글 편집 자리에서는 글자 고르기가 먼저다', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isNodeLongPressTarget(targetInside({ tag }, NODE, FLOW))).toBe(false);
    }
    expect(isNodeLongPressTarget(targetInside({ tag: 'div', attrs: { contenteditable: 'true' } }, NODE, FLOW))).toBe(false);
    // 편집을 끈 칸은 보통 자리다.
    expect(isNodeLongPressTarget(targetInside({ tag: 'div', attrs: { contenteditable: 'false' } }, NODE, FLOW))).toBe(true);
  });

  it('nodrag(슬라이더·재생 위치·위성 손잡이) 위에서는 열지 않는다', () => {
    expect(isNodeLongPressTarget(targetInside({ classes: ['nodrag', 'nopan'] }, NODE, FLOW))).toBe(false);
  });

  it('원격 조작 중인 캡처 표면은 원격 PC 의 손짓이다', () => {
    expect(isNodeLongPressTarget(targetInside({ tag: 'video' }, { attrs: { 'data-capture-control': 'on' } }, NODE, FLOW))).toBe(false);
    expect(isNodeLongPressTarget(targetInside({ tag: 'video' }, { attrs: { 'data-capture-control': 'off' } }, NODE, FLOW))).toBe(true);
  });

  it('이미 끌리고 있는 노드에서 멈칫해도 메뉴를 부르지 않는다', () => {
    const dragging: FakeEl = { classes: ['react-flow__node', 'draggable', 'dragging'] };
    expect(isNodeLongPressTarget(targetInside({ classes: ['bubble-body'] }, dragging, FLOW))).toBe(false);
  });

  it('판정할 수 없는 대상이면 열지 않는다', () => {
    expect(isNodeLongPressTarget(null)).toBe(false);
    expect(isNodeLongPressTarget(undefined)).toBe(false);
    expect(isNodeLongPressTarget({})).toBe(false);
  });
});

describe('isNodeLongPressGhost — 흉내 마우스 이벤트는 그 자리 근처·잠깐만', () => {
  const guard = { x: 100, y: 200, until: 1_000 + NODE_LONG_PRESS_GHOST_MS };

  it('뗀 자리 근처의 이벤트는 삼킨다', () => {
    expect(isNodeLongPressGhost(guard, 100, 200, 1_000)).toBe(true);
    expect(isNodeLongPressGhost(guard, 100 + NODE_LONG_PRESS_GHOST_RADIUS, 200, 1_100)).toBe(true);
  });

  it('멀리서 온 이벤트·시한이 지난 이벤트는 그대로 둔다', () => {
    expect(isNodeLongPressGhost(guard, 100 + NODE_LONG_PRESS_GHOST_RADIUS + 1, 200, 1_000)).toBe(false);
    expect(isNodeLongPressGhost(guard, 100, 200, guard.until + 1)).toBe(false);
    expect(isNodeLongPressGhost(null, 100, 200, 1_000)).toBe(false);
  });
});
