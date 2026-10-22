/**
 * §5.1 #2-1 (B) — 원 둘레 묶음에 든 직속 파일의 선(`remapConverted` 의 `bundled`, 2026-10-22).
 *
 * 폴더 안에서 같은 종류 둘 이상의 직속 파일은 묶음 버블 하나가 대신 선다(사용자 지시 "아니 이런게 없다고 … 내가 만들라는 구조에서
 * 이게 뭐냐고"). 그 파일들로 들어오던 선은 묶음으로 옮겨 달되, 구성 수만큼 같은 끝점 선을 겹쳐 그리지 않는다.
 * 위성이 된 파일(`converted`)의 종전 규칙(폴더 쪽 선은 버린다)은 그대로다.
 */
import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';

import { remapConverted } from './useBubbleLayout.js';

function edge(id: string, source: string, target: string, animated = false): Edge {
  return { id, source, target, animated } as Edge;
}

describe('remapConverted — 묶음에 든 직속 파일의 선', () => {
  it('묶음으로 옮겨 달고 같은 끝점은 하나만 — 하나라도 돌면 도는 선을 남긴다', () => {
    const bundled = new Map([['f1', 'bundle-x'], ['f2', 'bundle-x'], ['f3', 'bundle-x']]);
    const out = remapConverted(
      [edge('e1', 'back', 'f1'), edge('e2', 'back', 'f2', true), edge('e3', 'back', 'f3'), edge('e4', 'back', 'other')],
      new Map(),
      'back',
      bundled,
    );
    expect(out.map((e) => [e.id, e.source, e.target, e.animated])).toEqual([
      ['e2', 'back', 'bundle-x', true],
      ['e4', 'back', 'other', false],
    ]);
  });

  it('묶음 쪽 선은 폴더 쪽이어도 버리지 않는다 — 묶음에는 따로 선 위성선이 없다', () => {
    const out = remapConverted([edge('e1', 'back', 'f1')], new Map(), 'back', new Map([['f1', 'bundle-x']]));
    expect(out.map((e) => [e.source, e.target])).toEqual([['back', 'bundle-x']]);
  });

  it('위성이 된 파일(converted)은 종전대로 폴더 쪽 선을 버리고 나머지는 위성으로 옮긴다', () => {
    const out = remapConverted([edge('e1', 'back', 'f1'), edge('e2', 'agent', 'f1')], new Map([['f1', 'sat-f1']]), 'back');
    expect(out.map((e) => [e.id, e.source, e.target])).toEqual([['e2', 'agent', 'sat-f1']]);
  });

  it('옮길 것이 없으면 받은 배열 그대로다', () => {
    const edges = [edge('e1', 'a', 'b')];
    expect(remapConverted(edges, new Map())).toBe(edges);
  });
});
