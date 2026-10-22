import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppBubble, BubbleData } from '@vibisual/shared';
import { LINK_VIEW } from '@vibisual/shared';
import {
  EMPTY_LINK_VIEW,
  activityEdgeView,
  agentHasAppLinks,
  appNodeShowsLinkedItems,
  applyLinkViewToEdges,
  effectiveLinkLens,
  isActivityEdge,
  linkViewKey,
  linkViewSets,
  refLinkVisible,
} from './linkView.js';
import { refLinkPairs } from './agentCard.js';

/**
 * §5.4 #36 (H) — 연결 보기 판정. ① 켜고 끄기 · ② 보기 전환(기본 "연결된 것 위주") · ③ 구슬 줄을 펴는가.
 * 캔버스 선·위성줄·메뉴·앱 노드가 같은 답을 내야 하므로 판정을 한 벌로 고정한다.
 */

function agent(id: string, extra: Partial<BubbleData> = {}): BubbleData {
  return { id, label: id, bubbleType: 'agent', path: '', status: 'idle', activity: 0, ...extra };
}

function app(id: string, extra: Partial<AppBubble> = {}): AppBubble {
  return { id, projectName: 'proj', appId: 'video', x: 0, y: 0, width: 208, height: 130, createdAt: 1, ...extra };
}

function edge(id: string, source: string, target: string, extra: Partial<Edge> = {}): Edge {
  return { id, source, target, type: 'curved', style: { stroke: '#fff', strokeWidth: 2 }, ...extra };
}

describe('§5.4 #36 (H) ② 보기 — 기본은 연결된 것 위주', () => {
  it('앱 노드가 이어지지 않은 에이전트는 늘 작업 파일이다(위주로 볼 것이 없다)', () => {
    expect(effectiveLinkLens(agent('a'), false)).toBe('files');
    expect(effectiveLinkLens(agent('a', { linkLens: 'files' }), false)).toBe('files');
  });

  it('이어졌으면 기본이 연결된 것 위주이고, 사용자가 바꿨을 때만 작업 파일이다', () => {
    expect(effectiveLinkLens(agent('a'), true)).toBe('linked');
    expect(effectiveLinkLens(agent('a', { linkLens: 'files' }), true)).toBe('files');
    expect(effectiveLinkLens(null, true)).toBe('linked');
  });

  it('연결 버블 판정은 프로젝트를 가린다(§3.5)', () => {
    const bubbles = [app('n1', { linkedAgentIds: ['a'] }), app('n2', { projectName: 'other', linkedAgentIds: ['b'] })];
    expect(agentHasAppLinks(bubbles, 'a', 'proj')).toBe(true);
    expect(agentHasAppLinks(bubbles, 'b', 'proj')).toBe(false);
    expect(agentHasAppLinks(bubbles, 'b', null)).toBe(true);
  });
});

describe('§5.4 #36 (H) 판정 재료', () => {
  const bubbles = [app('n1', { linkedAgentIds: ['linked', 'linkedFiles', 'linkedHidden'] })];
  const agents = [
    agent('plain'),
    agent('hidden', { linksHidden: true }),
    agent('linked'),
    agent('linkedFiles', { linkLens: 'files' }),
    agent('linkedHidden', { linksHidden: true }),
    agent('folder', { bubbleType: 'internal_folder' }),
  ];

  it('끈 에이전트는 감추고, 연결된 것 위주인 에이전트만 흐린다 — 끈 것은 흐릴 목록에 넣지 않는다(① 이 이긴다)', () => {
    const sets = linkViewSets(agents, bubbles, 'proj');
    expect([...sets.hidden].sort()).toEqual(['hidden', 'linkedHidden']);
    expect([...sets.dimmed]).toEqual(['linked']);
  });

  it('바꿀 것이 없으면 같은 빈 재료를 돌려준다(무변화 비교가 참조로 끝난다)', () => {
    expect(linkViewSets([agent('plain')], [], 'proj')).toBe(EMPTY_LINK_VIEW);
    expect(linkViewKey(EMPTY_LINK_VIEW)).toBe('');
  });

  it('지문은 순서에 흔들리지 않고, 상태가 바뀌면 바뀐다', () => {
    const a = linkViewKey(linkViewSets(agents, bubbles, 'proj'));
    const b = linkViewKey(linkViewSets([...agents].reverse(), bubbles, 'proj'));
    expect(a).toBe(b);
    const shown = agents.map((x) => (x.id === 'hidden' ? agent('hidden') : x));
    expect(linkViewKey(linkViewSets(shown, bubbles, 'proj'))).not.toBe(a);
  });
});

describe('§5.4 #36 (H) ①② 활동·위성 선', () => {
  const sets = linkViewSets(
    [agent('hidden', { linksHidden: true }), agent('linked')],
    [app('n1', { linkedAgentIds: ['linked'] })],
    'proj',
  );

  it('에이전트 끝점만 본다 — 감춤이 흐림을 이긴다', () => {
    expect(activityEdgeView('hidden', 'folder', sets)).toBe('hide');
    expect(activityEdgeView('file', 'hidden', sets)).toBe('hide');
    expect(activityEdgeView('linked', 'folder', sets)).toBe('dim');
    expect(activityEdgeView('hidden', 'linked', sets)).toBe('hide');
    expect(activityEdgeView('a', 'b', sets)).toBe('show');
  });

  it('맡는 선은 활동·위성 선(curved)뿐 — Task Edge·플레이 소유 선·위성줄은 건드리지 않는다', () => {
    expect(isActivityEdge({ id: 'e', type: 'curved' })).toBe(true);
    expect(isActivityEdge({ id: 'e', type: undefined })).toBe(true);
    expect(isActivityEdge({ id: 'task-1', type: 'taskEdge' })).toBe(false);
    expect(isActivityEdge({ id: 'ref-a-b', type: 'refLink' })).toBe(false);
    expect(isActivityEdge({ id: 'play-owner-p1', type: undefined })).toBe(false);
  });

  it('감출 선은 목록에서 빼지 않고 hidden 으로 — 폴더 버블의 생존·무리 판정이 그대로 본다', () => {
    const edges = [edge('e1', 'hidden', 'folder'), edge('e2', 'linked', 'folder'), edge('e3', 'x', 'y')];
    const out = applyLinkViewToEdges(edges, sets);
    expect(out).toHaveLength(3);
    expect(out[0]?.hidden).toBe(true);
    expect(out[1]?.hidden).toBeUndefined();
    expect(out[1]?.style?.opacity).toBeCloseTo(LINK_VIEW.dimOpacity);
    expect(out[2]).toBe(edges[2]);
  });

  it('흐림은 원래 불투명도에 곱한다', () => {
    const out = applyLinkViewToEdges([edge('e', 'linked', 'f', { style: { opacity: 0.5 } })], sets);
    expect(out[0]?.style?.opacity).toBeCloseTo(0.5 * LINK_VIEW.dimOpacity);
  });

  it('Task Edge 는 끈 에이전트에 붙어 있어도 그대로다(사용자가 그은 위임)', () => {
    const task = edge('task-1', 'hidden', 'linked', { type: 'taskEdge' });
    expect(applyLinkViewToEdges([task], sets)[0]).toBe(task);
  });

  it('바꿀 것이 없으면 같은 배열을 돌려준다 — React Flow 가 무변화에 다시 그리지 않게', () => {
    const edges = [edge('e3', 'x', 'y')];
    expect(applyLinkViewToEdges(edges, sets)).toBe(edges);
    expect(applyLinkViewToEdges(edges, EMPTY_LINK_VIEW)).toBe(edges);
  });
});

describe('§5.4 #36 (H) ① 위성줄', () => {
  it('양 끝 중 하나라도 끄면 숨는다', () => {
    expect(refLinkVisible('a', app('n'), new Set())).toBe(true);
    expect(refLinkVisible('a', app('n', { linksHidden: true }), new Set())).toBe(false);
    expect(refLinkVisible('a', app('n'), new Set(['a']))).toBe(false);
    expect(refLinkVisible('a', app('n'), undefined)).toBe(true);
  });

  it('refLinkPairs 가 같은 판정을 따른다 — 연결(linkedAgentIds)은 그대로다', () => {
    const bubbles = [
      app('n1', { linkedAgentIds: ['a', 'b'] }),
      app('n2', { linkedAgentIds: ['a'], linksHidden: true }),
    ];
    const visible = new Set(['a', 'b']);
    expect(refLinkPairs(bubbles, visible, 'proj').map((p) => p.id)).toEqual(['ref-a-n1', 'ref-b-n1']);
    expect(refLinkPairs(bubbles, visible, 'proj', new Set(['b'])).map((p) => p.id)).toEqual(['ref-a-n1']);
    expect(bubbles[1]?.linkedAgentIds).toEqual(['a']);
  });
});

describe('§5.4 #36 (H) ③ 구슬 줄을 펴는가', () => {
  it('노드에서 끈 것(①)만 접는다', () => {
    expect(appNodeShowsLinkedItems({ linksHidden: true })).toBe(false);
    expect(appNodeShowsLinkedItems({})).toBe(true);
  });

  it('[버블 전부 보기]에서도 편다 — 이어진 에이전트의 보기는 묻지 않는다(2026-10-21 — "전부"에서 접으면 이름이 거짓이 된다)', () => {
    // 종전에는 이어진 에이전트가 모두 `linkLens: 'files'` 면 접었다. 이제 판정에 에이전트가 들어가지 않는다.
    expect(appNodeShowsLinkedItems({ linksHidden: false })).toBe(true);
    expect(appNodeShowsLinkedItems.length).toBe(1);
  });
});
