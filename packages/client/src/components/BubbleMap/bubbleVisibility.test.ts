import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { BubbleData, BubbleType } from '@vibisual/shared';
import { applyBubbleVisibilityToEdges, applyBubbleVisibilityToNodes, hiddenActivityBubbleIds } from './bubbleVisibility.js';

function node(id: string, bubbleType: BubbleType, extra: Partial<Node> = {}): Node {
  return { id, type: 'bubble', position: { x: 12, y: 34 }, data: { bubbleType }, ...extra };
}
function agent(id: string, bubblesHidden = false): Pick<BubbleData, 'id' | 'bubbleType' | 'bubblesHidden'> {
  return { id, bubbleType: 'agent', bubblesHidden };
}
function edge(source: string, target: string, extra: Partial<Edge> = {}): Edge {
  return { id: `${source}-${target}`, source, target, type: 'curved', ...extra };
}

describe('activity bubble visibility', () => {
  // §5.1 #2-1 (B) — 묶음 버블(화면 전용)과 그 구성은 한 무리로 숨는다. 원 둘레의 묶음에는 활동선이 닿지 않는다
  //   (에이전트 선은 중심 파일로 옮겨 간다) — 구성에서 거슬러 이어 빈 묶음이 홀로 남지 않게.
  it('hides a bundle bubble together with its members, whether it sits on a folder or on the ring', () => {
    const satNodes = [node('folder', 'internal_folder'), node('sat-bundle-hub', 'bundle'), node('sat-hub', 'file'), node('sat-moon', 'file')];
    const satEdges = [edge('a', 'folder'), edge('folder', 'sat-bundle-hub', { id: 'sat-edge-bundle-hub' }),
      edge('sat-hub', 'sat-bundle-hub', { id: 'sat-edge-hub' }), edge('sat-bundle-hub', 'sat-moon', { id: 'sat-edge-moon' })];
    expect([...hiddenActivityBubbleIds(satNodes, satEdges, [agent('a', true)])].sort())
      .toEqual(['folder', 'sat-bundle-hub', 'sat-hub', 'sat-moon']);
    const ringNodes = [node('bundle-hub', 'bundle'), node('sat-hub', 'file'), node('sat-moon', 'file')];
    const ringEdges = [edge('a', 'sat-hub'), edge('bundle-hub', 'sat-hub', { id: 'sat-edge-hub' }),
      edge('bundle-hub', 'sat-moon', { id: 'sat-edge-moon' })];
    expect([...hiddenActivityBubbleIds(ringNodes, ringEdges, [agent('a', true)])].sort())
      .toEqual(['bundle-hub', 'sat-hub', 'sat-moon']);
  });

  it('hides read/write activity and descendant satellites but retains navigation and user-created nodes', () => {
    const nodes = [node('a', 'agent'), node('folder', 'internal_folder'), node('domain', 'domain'),
      node('sat-file', 'file'), node('root', 'root'), node('back', 'back'), node('worktree', 'worktree'),
      node('other', 'agent'), node('pipeline', 'pipeline'), node('app', 'video', { type: 'appNode' }),
      node('manual', 'iframe', { data: { bubbleType: 'iframe', customCreated: true } })];
    const edges = nodes.slice(1).filter((n) => n.id !== 'sat-file').map((n) => edge(n.id, 'a'));
    edges.push(edge('folder', 'sat-file', { id: 'sat-edge-file' }));
    expect([...hiddenActivityBubbleIds(nodes, edges, [agent('a', true), agent('other')])].sort())
      .toEqual(['domain', 'folder', 'sat-file']);
  });

  it('keeps shared activity visible while any owner shows bubbles, then hides it when all owners hide', () => {
    const nodes = [node('folder', 'external_folder'), node('sat-file', 'file')];
    const edges = [edge('a', 'folder'), edge('folder', 'b'), edge('folder', 'sat-file', { id: 'sat-edge-file' })];
    expect(hiddenActivityBubbleIds(nodes, edges, [agent('a', true), agent('b')]).size).toBe(0);
    expect([...hiddenActivityBubbleIds(nodes, edges, [agent('a', true), agent('b', true)])])
      .toEqual(['folder', 'sat-file']);
  });

  it('uses all raw satellite owners even after the layout retained only one satellite edge', () => {
    const nodes = [node('sat-file', 'file')];
    const edges = [edge('a', 'sat-file', { id: 'sat-edge-file' })];
    const satellite = { id: 'file', bubbleType: 'file' as const };
    const satellites = { a: [satellite], b: [satellite] };
    expect(hiddenActivityBubbleIds(nodes, edges, [agent('a', true), agent('b')], satellites).size).toBe(0);
    expect([...hiddenActivityBubbleIds(nodes, edges, [agent('a', true), agent('b', true)], satellites)])
      .toEqual(['sat-file']);
  });

  it('inherits both parent fields, including cycles, without making a shared child reveal its parent', () => {
    const nodes = [node('folder', 'internal_folder'),
      node('child', 'file', { parentId: 'folder' }),
      node('grandchild', 'file', { data: { bubbleType: 'file', parentId: 'child' } }),
      node('shared', 'file', { parentId: 'folder', data: { bubbleType: 'file', activeAgentIds: ['b'] } }),
      node('cycle1', 'file', { parentId: 'cycle2', data: { bubbleType: 'file', parentId: 'grandchild' } }),
      node('cycle2', 'file', { parentId: 'cycle1' })];
    expect([...hiddenActivityBubbleIds(nodes, [edge('a', 'folder')], [agent('a', true), agent('b')])])
      .toEqual(['folder', 'child', 'grandchild', 'cycle1', 'cycle2']);
  });

  it('does not use task, reference, or play owner edges as activity ownership', () => {
    const nodes = [node('file', 'file'), node('unowned', 'file')];
    for (const extra of [{ type: 'taskEdge' }, { type: 'refLink' }, { id: 'play-owner-preview' }]) {
      expect(hiddenActivityBubbleIds(nodes, [edge('a', 'file', extra)], [agent('a', true)]).size).toBe(0);
    }
  });

  it('stops ownership at navigation and other agents even if they have satellite descendants', () => {
    const nodes = [node('root', 'root'), node('b', 'agent'), node('child', 'file', { parentId: 'root' }),
      node('other-child', 'file', { parentId: 'b' })];
    expect(hiddenActivityBubbleIds(nodes, [edge('a', 'root'), edge('a', 'b')], [agent('a', true), agent('b')]).size)
      .toBe(0);
  });
});

describe('render-only projection', () => {
  it('preserves source graph and coordinates, restores original flags, and hides all incident edge kinds', () => {
    const nodes = [node('file', 'file', { hidden: false }), node('a', 'agent'), node('already-hidden', 'file', { hidden: true })];
    const edges = [edge('a', 'file'), edge('file', 'a', { type: 'taskEdge' }), edge('a', 'already-hidden', { hidden: true })];
    const snapshot = JSON.stringify({ nodes, edges });
    const hidden = new Set(['file']);
    const shownNodes = applyBubbleVisibilityToNodes(nodes, hidden);
    const shownEdges = applyBubbleVisibilityToEdges(edges, hidden);
    expect(shownNodes[0]?.hidden).toBe(true);
    expect(shownNodes[0]?.position).toBe(nodes[0]?.position);
    expect(shownNodes[1]).toBe(nodes[1]);
    expect(shownEdges.every((e) => e.hidden)).toBe(true);
    expect(JSON.stringify({ nodes, edges })).toBe(snapshot);
    expect(applyBubbleVisibilityToNodes(nodes, new Set())).toBe(nodes);
    expect(applyBubbleVisibilityToEdges(edges, new Set())).toBe(edges);
    expect(nodes[0]?.hidden).toBe(false);
    expect(nodes[2]?.hidden).toBe(true);
  });

  it('reuses arrays when the hidden IDs do not affect them or already-hidden elements need no change', () => {
    const nodes = [node('file', 'file', { hidden: true })];
    const edges = [edge('a', 'file', { hidden: true })];
    for (const hidden of [new Set(['missing']), new Set(['file'])]) {
      expect(applyBubbleVisibilityToNodes(nodes, hidden)).toBe(nodes);
      expect(applyBubbleVisibilityToEdges(edges, hidden)).toBe(edges);
    }
  });

  it('removes hidden nodes and edges from native selection immediately, without changing source selections', () => {
    const nodes = [node('file', 'file', { selected: true }), node('a', 'agent', { selected: true })];
    const edges = [edge('a', 'file', { hidden: true, selected: true })];
    const hidden = new Set(['file']);
    expect(applyBubbleVisibilityToNodes(nodes, hidden).map((n) => n.selected)).toEqual([false, true]);
    expect(applyBubbleVisibilityToEdges(edges, hidden)[0]?.selected).toBe(false);
    expect(nodes[0]?.selected).toBe(true);
    expect(edges[0]?.selected).toBe(true);
  });
});
