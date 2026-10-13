/**
 * canvasMultiSelect.test.ts — §6 "여러 개 고르기도 캔버스 전체가 한 규칙이다"의 회귀 방지.
 *
 * 2026-10-11 사용자 보고: "Shift 를 누르면 전체 선택이 돼야 하는데 안 된다 — 새로 만든 버블(앱·미디어 노드)이
 * 선택이 잘 안 되고, Ctrl 다중 선택도 정상이 아니다." 원인은 넷이었다 — store 노드가 `selectable:false` 라 박스
 * 선택이 건너뛰었고, 박스가 노드를 완전히 감싸야만 골랐고, 버블 위 Shift 누름은 박스 선택 키와 겹쳐 버블에 닿지
 * 않았고, Ctrl 클릭은 무리 잡기로만 쓰였다. 이 파일은 그 규칙의 순수 판정을 못 박는다.
 */
import { describe, expect, it } from 'vitest';
// CSS 원문은 설정 파일이 넘겨 준다 — `?raw` 도 `import.meta.glob` 도 CSS 에서는 빈 문자열이 온다
// (`vitest.config.ts` 의 `vibisual:css-source` 주석).
import indexCss from 'virtual:vibisual-css-source/index';

import {
  applySelectChanges,
  canvasSelectionChanges,
  flowSelectable,
  isCanvasMultiSelectable,
  keepStoreSelectionOnly,
  NAV_BUBBLE_IDS,
  ownedByStoreSelection,
} from './canvasMultiSelect.js';

describe('묶음에 들 수 있는 노드', () => {
  it('노드 종류를 묻지 않는다 — 앱·캡처·플레이 노드도 버블과 같이 든다', () => {
    for (const id of ['agent-1', 'sat-file', 'app-1', 'cap-1', 'play-1__preview']) {
      expect(isCanvasMultiSelectable({ id })).toBe(true);
    }
  });

  it('스스로 빠진 노드(메모 상자·실패 표식)와 뒤로 가기 골격은 들지 않는다', () => {
    expect(isCanvasMultiSelectable({ id: 'box-1', selectable: false })).toBe(false);
    for (const id of NAV_BUBBLE_IDS) expect(isCanvasMultiSelectable({ id })).toBe(false);
  });

  it('React Flow 가 고를 수 있는 것은 박스 선택이 도는 동안뿐이다 — 클릭은 우리 제스처가 고른다', () => {
    expect(flowSelectable({ id: 'agent-1' }, false)).toBe(false);
    expect(flowSelectable({ id: 'agent-1' }, true)).toBe(true);
    expect(flowSelectable({ id: 'box-1', selectable: false }, true)).toBe(false);
    expect(flowSelectable({ id: '__root_back__' }, true)).toBe(false);
  });
});

describe('클릭 한 번이 낳는 변경', () => {
  const nodes = [
    { id: 'a', selected: true },
    { id: 'b', selected: false },
    { id: 'app-1', selected: true },
  ];
  const edges = [{ id: 'e1', selected: true }, { id: 'e2' }];

  it('보통 클릭은 묶음을 그 노드 하나로 바꾼다 — 함께 골라진 선도 내린다', () => {
    const c = canvasSelectionChanges(nodes, edges, 'b', 'replace');
    expect(c.nodes).toEqual([
      { type: 'select', id: 'a', selected: false },
      { type: 'select', id: 'b', selected: true },
      { type: 'select', id: 'app-1', selected: false },
    ]);
    expect(c.edges).toEqual([{ type: 'select', id: 'e1', selected: false }]);
  });

  it('이미 혼자 골라져 있으면 아무것도 바꾸지 않는다(헛 렌더 ❌)', () => {
    const c = canvasSelectionChanges([{ id: 'a', selected: true }, { id: 'b' }], [], 'a', 'replace');
    expect(c).toEqual({ nodes: [], edges: [] });
  });

  it('수식 키 클릭은 그 노드만 뒤집는다 — 다른 것과 선은 그대로다', () => {
    expect(canvasSelectionChanges(nodes, edges, 'b', 'toggle')).toEqual({
      nodes: [{ type: 'select', id: 'b', selected: true }],
      edges: [],
    });
    expect(canvasSelectionChanges(nodes, edges, 'app-1', 'toggle')).toEqual({
      nodes: [{ type: 'select', id: 'app-1', selected: false }],
      edges: [],
    });
  });

  it('화면에 없는 노드의 클릭은 지금 묶음을 비우지 않는다(다른 캔버스·사라진 노드)', () => {
    expect(canvasSelectionChanges(nodes, edges, 'gone', 'replace')).toEqual({ nodes: [], edges: [] });
    expect(canvasSelectionChanges(nodes, edges, 'gone', 'toggle')).toEqual({ nodes: [], edges: [] });
  });
});

describe('store 노드의 묶음 칸', () => {
  it('select 변경을 먹인다 — 바뀐 것이 없으면 같은 집합을 그대로 돌려준다', () => {
    const empty: ReadonlySet<string> = new Set();
    const one = applySelectChanges(empty, [{ id: 'app-1', selected: true }]);
    expect([...one]).toEqual(['app-1']);
    expect(applySelectChanges(one, [{ id: 'app-1', selected: true }, { id: 'cap-1', selected: false }])).toBe(one);
    expect([...applySelectChanges(one, [{ id: 'app-1', selected: false }, { id: 'cap-1', selected: true }])]).toEqual(['cap-1']);
  });

  it('패널 한 칸이 가리키는 노드 — 플레이 표지와 프리뷰는 같은 레코드다', () => {
    expect(ownedByStoreSelection('play-1', 'play-1')).toBe(true);
    expect(ownedByStoreSelection('play-1__preview', 'play-1')).toBe(true);
    expect(ownedByStoreSelection('app-2', 'app-1')).toBe(false);
    expect(ownedByStoreSelection('app-1', null)).toBe(false);
  });

  it('반대편 채널을 내릴 때 방금 패널이 고른 노드만 남긴다(보통 클릭의 두 반쪽이 다른 렌더에 도착해도)', () => {
    const prev: ReadonlySet<string> = new Set(['app-1', 'cap-1', 'play-1__preview']);
    expect([...keepStoreSelectionOnly(prev, 'app-1')]).toEqual(['app-1']);
    expect([...keepStoreSelectionOnly(prev, 'play-1')]).toEqual(['play-1__preview']);
    expect(keepStoreSelectionOnly(prev, null).size).toBe(0);
    const only: ReadonlySet<string> = new Set(['app-1']);
    expect(keepStoreSelectionOnly(only, 'app-1')).toBe(only);
  });
});

/**
 * 배선 가드 — 판정만 맞고 캔버스가 안 부르면 증상은 그대로다. 클라 시험에는 DOM 이 없으므로 소스 원문으로 본다
 * (이 레포의 다른 배선 가드와 같은 방식 — glob 이 비면 헛통과하므로 "읽어 왔다"를 먼저 못 박는다).
 */
describe('캔버스 배선', () => {
  const SOURCES = import.meta.glob<string>(
    [
      '/src/components/BubbleMap/BubbleMap.tsx',
      '/src/components/BubbleMap/SelectionFocusFlow.tsx',
      '/src/components/BubbleMap/useSelectionFocus.ts',
    ],
    { query: '?raw', import: 'default', eager: true },
  );
  const src = (path: string): string => SOURCES[path] ?? '';
  const code = (path: string): string => src(path).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const css = indexCss.replace(/\r\n/g, '\n');

  it('소스를 실제로 읽어 왔다', () => {
    expect(Object.keys(SOURCES)).toHaveLength(3);
    for (const text of Object.values(SOURCES)) expect(text.length).toBeGreaterThan(0);
    expect(css.length, 'index.css 를 못 읽었습니다').toBeGreaterThan(0);
  });

  it('박스 선택은 걸치기만 해도 든다(Partial) — 완전히 감싸야 들던 기본값이 "선택이 잘 안 된다"였다', () => {
    expect(code('/src/components/BubbleMap/BubbleMap.tsx')).toContain('SelectionMode.Partial');
    expect(code('/src/components/BubbleMap/BubbleMap.tsx')).toContain('selectionMode={SELECTION_MODE}');
  });

  it('노드 변경은 store 노드 묶음까지 받는 창구 하나로 흐른다', () => {
    expect(code('/src/components/BubbleMap/BubbleMap.tsx')).toContain('onNodesChange={handleNodesChange}');
  });

  it('React Flow 내장 지우기 키는 꺼져 있다(지우기는 `canvas.deleteSelection` 하나)', () => {
    expect(code('/src/components/BubbleMap/BubbleMap.tsx')).toContain('deleteKeyCode={null}');
  });

  it('버블 위 Shift 클릭은 캔버스 캡처 손잡이가 받는다(박스 선택 키와 겹쳐 버블에 닿지 않는 누름)', () => {
    const c = code('/src/components/BubbleMap/BubbleMap.tsx');
    expect(c).toContain('onPointerDownCapture={handleShiftPressCapture}');
    expect(c).toContain('onPointerMoveCapture={handleShiftMoveCapture}');
    expect(c).toContain('onPointerUpCapture={handleShiftReleaseCapture}');
  });

  it('React Flow 는 박스 선택이 도는 동안만 노드를 고른다', () => {
    expect(code('/src/components/BubbleMap/useSelectionFocus.ts')).toContain('flowSelectable(node, marquee)');
    const flow = code('/src/components/BubbleMap/SelectionFocusFlow.tsx');
    expect(flow).toContain('setMarquee(true)');
    expect(flow).toContain('onSelectionEnd={handleSelectionEnd}');
  });

  it('고른 뒤 버블을 덮던 묶음 상자는 이 캔버스에서 그리지 않는다', () => {
    expect(css).toMatch(/\.vibisual-canvas \.react-flow__nodesselection\s*\{\s*display:\s*none;/);
    // §4 앱 테마 — 캔버스 바탕은 테마 토큰(`canvas.background` → `bg-vb-canvas`)이다. 이 검사가 지키는 것은
    //   위 CSS 규칙이 걸리는 `vibisual-canvas` 클래스가 캔버스에 붙어 있다는 사실이다.
    expect(code('/src/components/BubbleMap/BubbleMap.tsx')).toContain('vibisual-canvas bg-vb-canvas');
  });
});
