/**
 * §5.5 #17-17 ⑳(f) — 끄는 동안 노드가 손에 붙는가. React Flow v12 controlled 모드는 좌표를 `onNodeDrag`/`onNodesChange` 로만 흘려
 * 핸들러가 없으면 조용히 버려진다(타입·빌드에 안 걸린다, §5.13 과 같은 함정).
 */

import { describe, expect, it } from 'vitest';

const tsx = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

function stage(): string {
  const src = tsx['./IDEGoalMapView.tsx'];
  if (src === undefined) throw new Error('IDEGoalMapView.tsx 를 못 찾음');
  return src;
}

/** 값 하나가 지어지는 덩어리만 잘라 본다 — 무엇을 보고 다시 짓는지(의존 목록)까지 그 안에 있다. */
function block(src: string, head: string, end: string): string {
  const at = src.indexOf(head);
  expect(at, `${head} 를 못 찾음`).toBeGreaterThan(-1);
  const to = src.indexOf(end, at);
  expect(to, `${head} 의 끝(${end})을 못 찾음`).toBeGreaterThan(at);
  return src.slice(at, to);
}

describe('⑳(f) 끄는 동안의 자리가 곧바로 화면에 앉는다', () => {
  const src = stage();

  it('`<ReactFlow>` 가 `onNodeDrag` 를 받는다 — 이 한 줄이 없으면 좌표는 버려진다', () => {
    expect(src).toContain('onNodeDrag={onNodeDrag}');
  });

  it('핸들러가 매 프레임 좌표를 화면 자리로 앉힌다', () => {
    const handler = block(src, 'const onNodeDrag = useCallback(', 'const onNodeDragStop = useCallback(');
    expect(handler).toContain('setDragPos(');
    expect(handler, '노드가 알려 준 좌표를 그대로 써야 손을 따라온다').toContain('n.position.x');
  });

  it('끌던 자리가 저장 자리·파생 자리를 이긴다 — 도중에 도착한 목록이 손을 되돌리지 못한다', () => {
    const resolve = block(src, 'const positionOf = useCallback(', 'const points = useMemo');
    expect(resolve).toMatch(/dragPos\?\.\[stepId\]\s*\?\?\s*positions\.get\(stepId\)/u);
  });

  it('손을 떼면 화면 자리를 반납하고 저장으로 넘긴다 — 함께 끈 노드도 전부', () => {
    const stop = block(src, 'const onNodeDragStop = useCallback(', 'const applyWire = useCallback(');
    expect(stop, '화면 자리를 안 반납하면 저장 자리와 두 벌이 된다').toContain('setDragPos(null)');
    expect(stop, '하나만 저장하면 나머지는 놓자마자 제자리로 튄다').toMatch(/for \(const n of moved/u);
    expect(stop).toContain('setGoalNodePosition(');
  });

  it('세션이 바뀌면 끌던 자리를 버린다 — 다른 목록의 id 에 옛 좌표가 얹히지 않게', () => {
    expect(src).toMatch(/setDragPos\(null\);\s*\},\s*\[activeSessionId\]\)/u);
  });

  it('끄는 문턱은 상수 표에서 온다(매직넘버 ❌)', () => {
    expect(src).toContain('nodeDragThreshold={STAGE_DRAG.THRESHOLD}');
  });
});

describe('⑳(f) 끄는 동안 다시 지어지는 것은 자리뿐이다', () => {
  const src = stage();

  it('노드 몸통은 자리를 보지 않는다 — `data` 신원이 그대로라야 남의 노드가 안 다시 그려진다', () => {
    const base = block(src, 'const baseNodes = useMemo(', 'const nodes = useMemo');
    expect(base).not.toContain('positionOf');
    expect(base).not.toContain('dragPos');
  });

  it('선은 자리를 보지 않는다 — 차례와 행에서만 나온다', () => {
    const edges = block(src, 'const edges = useMemo', 'const focusPos = useMemo');
    expect(edges).not.toContain('positionOf');
    expect(edges).not.toContain('dragPos');
  });
});
