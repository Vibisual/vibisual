/**
 * §5.5 #17-17 ⑳(g) — **선이 사라지지 않는다**를 두 겹으로 못 박는다.
 *
 * ① 잰 치수를 모으고 실어 주는 순수 함수들(`useMeasuredFlowNodes` 의 속).
 * ② 규약 집행 — React Flow 에 파생 노드 배열을 넘기는 **모든** 캔버스가 잰 치수를 도로 받는다.
 *
 * 왜 규약까지 두나: 이 결함은 타입에도 빌드에도 걸리지 않는다. `onNodesChange` 를 안 달아도
 * 컴파일은 초록이고 노드도 멀쩡히 그려진다 — **선만** 조용히 빠진다. 실제로 무대 지도와 디버그
 * 패널 두 곳이 같은 모양으로 빠져 있었고, 새 캔버스를 만들 때마다 다시 빠질 자리다.
 * 클라 테스트에는 DOM 이 없으므로 렌더가 아니라 **소스 글자**를 본다.
 */

import { describe, expect, it } from 'vitest';
import type { Node, NodeChange } from '@xyflow/react';
import { collectMeasured, pruneMeasured, withMeasured, type MeasuredSizes } from './useMeasuredFlowNodes.js';

function dim(id: string, width: number, height: number): NodeChange {
  return { id, type: 'dimensions', dimensions: { width, height } } as NodeChange;
}

function node(id: string, extra: Partial<Node> = {}): Node {
  return { id, position: { x: 0, y: 0 }, data: {}, ...extra } as Node;
}

describe('⑳(g) 잰 치수를 모은다', () => {
  it('`dimensions` 변경을 표에 담는다', () => {
    const next = collectMeasured({}, [dim('a', 210, 64), dim('b', 100, 100)]);
    expect(next).toEqual({ a: { width: 210, height: 64 }, b: { width: 100, height: 100 } });
  });

  it('바뀐 것이 없으면 **같은 표**를 돌려준다 — 프레임마다 새 객체를 만들면 그만큼 헛되이 다시 그린다', () => {
    const prev: MeasuredSizes = { a: { width: 210, height: 64 } };
    expect(collectMeasured(prev, [dim('a', 210, 64)])).toBe(prev);
    expect(collectMeasured(prev, [])).toBe(prev);
  });

  it('치수 아닌 변경은 보지 않는다', () => {
    const prev: MeasuredSizes = {};
    const changes = [{ id: 'a', type: 'position', position: { x: 1, y: 2 } }] as NodeChange[];
    expect(collectMeasured(prev, changes)).toBe(prev);
  });

  it('말이 안 되는 치수는 버린다 — 0·음수·NaN 이 들어가면 그 노드의 선 좌표가 통째로 깨진다', () => {
    const prev: MeasuredSizes = {};
    expect(collectMeasured(prev, [dim('a', 0, 64)])).toBe(prev);
    expect(collectMeasured(prev, [dim('a', 210, -1)])).toBe(prev);
    expect(collectMeasured(prev, [dim('a', Number.NaN, 64)])).toBe(prev);
    expect(collectMeasured(prev, [{ id: 'a', type: 'dimensions' } as NodeChange])).toBe(prev);
  });
});

describe('⑳(g) 사라진 노드의 치수는 버린다', () => {
  it('지금 없는 id 를 떨군다 — 키 개수에 상한이 없으면 그것만으로 용량 결함이 된다', () => {
    const prev: MeasuredSizes = { a: { width: 1, height: 1 }, b: { width: 2, height: 2 } };
    expect(pruneMeasured(prev, ['a'])).toEqual({ a: { width: 1, height: 1 } });
  });

  it('전부 살아 있으면 같은 표를 돌려준다(헛렌더 ❌)', () => {
    const prev: MeasuredSizes = { a: { width: 1, height: 1 } };
    expect(pruneMeasured(prev, ['a', 'b'])).toBe(prev);
  });
});

describe('⑳(g) 노드에 치수를 실어 준다', () => {
  it('잰 값이 먼저, 없으면 기본 치수', () => {
    const out = withMeasured([node('a'), node('b')], { a: { width: 210, height: 64 } }, { width: 9, height: 9 });
    expect(out[0]?.measured).toEqual({ width: 210, height: 64 });
    expect(out[1]?.measured).toEqual({ width: 9, height: 9 });
  });

  it('잰 값도 기본값도 없으면 그대로 둔다 — 첫 측정 전에는 실을 것이 없다', () => {
    const input = [node('a')];
    const out = withMeasured(input, {});
    expect(out[0]).toBe(input[0]);
  });

  it('이미 실려 있으면 건드리지 않는다 — 부르는 쪽이 실었으면 그쪽이 진실이다', () => {
    const input = [node('a', { measured: { width: 5, height: 5 } })];
    const out = withMeasured(input, { a: { width: 210, height: 64 } });
    expect(out[0]).toBe(input[0]);
  });
});

/**
 * 규약 집행 — `nodes` 를 넘기면서 선도 그리는 캔버스는 **잰 치수를 도로 받아야** 한다.
 * `edges={[]}`(선을 안 그리는 캔버스)는 잃을 선이 없으므로 예외다.
 */
const tsxSources = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true });

function canvases(): { path: string; text: string }[] {
  return Object.entries(tsxSources as Record<string, string>)
    .map(([key, text]) => ({ path: key.replace(/^\.\.\//u, 'src/'), text }))
    .filter(({ path, text }) => !/[.]test[.]tsx?$/u.test(path) && text.includes('<ReactFlow') && /nodes=\{/u.test(text))
    .sort((a, b) => a.path.localeCompare(b.path));
}

describe('⑳(g) 모든 캔버스가 잰 치수를 도로 받는다', () => {
  const found = canvases();

  it('캔버스를 찾았다 — 못 찾으면 이 규약은 아무것도 지키지 못한다', () => {
    expect(found.length).toBeGreaterThan(0);
  });

  for (const { path, text } of found) {
    it(`${path} — 치수 왕복이 닫혀 있다`, () => {
      const drawsEdges = !/edges=\{\[\]\}/u.test(text);
      if (!drawsEdges) return;
      const closed = text.includes('onNodesChange') || text.includes('useNodesState');
      expect(
        closed,
        `${path}: <ReactFlow> 가 nodes 를 받으면서 onNodesChange 를 안 받는다 — `
        + '새 노드 객체가 갈 때마다 손잡이 치수가 지워져 이 캔버스의 **선이 사라진다**. '
        + 'useMeasuredFlowNodes 를 쓰거나 useNodesState 로 바꿔라.',
      ).toBe(true);
    });
  }
});
