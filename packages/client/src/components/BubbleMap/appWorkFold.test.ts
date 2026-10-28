/** §5.4 #36 (I) — 접기: 남도 쓰는 작업 폴더는 남고, 초점 에이전트 혼자 읽은 문서는 접히고, 작업 위성은 접히지 않는다. */
import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { BubbleData } from '@vibisual/shared';

import { EMPTY_APP_WORK_PLAN, type AppWorkPlan } from '../../utils/appWorkView.js';
import { EMPTY_APP_WORK_FOLD, appWorkFoldOf, decorateAppWorkNodes } from './appWorkFold.js';

const A = 'agent-474628602';
const B = 'agent-1353363285';
const APP = 'app-mvdp00r7-k74xi';

function bubble(id: string, bubbleType: BubbleData['bubbleType'], label = id, extra: Record<string, unknown> = {}): Node {
  return { id, type: 'bubble', position: { x: 0, y: 0 }, data: { id, label, bubbleType, path: label, status: 'idle', activity: 1, ...extra } };
}

const nodes: Node[] = [
  bubble(A, 'agent', 'Vibi3D builder'),
  bubble(B, 'agent', 'Dokkaebi builder'),
  bubble('folder-artifacts', 'internal_folder', 'artifacts'),
  bubble('folder-docs', 'internal_folder', 'docs'),
  bubble('sat-file-brief', 'file', 'brief.md'),
  bubble('sat-file-scene', 'file', 'scene-work.mjs', { _seatAngle: -Math.PI / 2 }),
  bubble('sat-file-preview', 'file', 'preview.tsx'),
  bubble('domain-three', 'domain', 'threejs.org'),
  bubble('folder-b-notes', 'internal_folder', 'b-notes'),
  { id: APP, type: 'appNode', position: { x: 0, y: 0 }, data: { appBubbleId: APP } },
];
const edges: Array<Pick<Edge, 'id' | 'source' | 'target' | 'type'>> = [
  { id: 'e1', source: A, target: 'folder-artifacts' },
  { id: 'e2', source: B, target: 'folder-artifacts' },
  { id: 'e3', source: 'folder-docs', target: A },
  { id: 'e4', source: 'domain-three', target: A },
  { id: 'e5', source: B, target: 'folder-b-notes' },
  { id: 'sat-edge-file-scene', source: APP, target: 'sat-file-scene' },
];
const satellites: Record<string, Array<Pick<BubbleData, 'id' | 'bubbleType'>>> = {
  'folder-artifacts': [{ id: 'file-scene', bubbleType: 'file' }, { id: 'file-preview', bubbleType: 'file' }],
  'folder-docs': [{ id: 'file-brief', bubbleType: 'file' }],
};
const agents = [
  { id: A, bubbleType: 'agent' as const },
  { id: B, bubbleType: 'agent' as const },
];

const plan: AppWorkPlan = {
  focusByAgent: new Map([[A, [APP]]]),
  hubs: new Map(),
  keepIds: new Set(['file-scene', 'sat-file-scene']),
  hiddenWorkIds: new Set(['sat-file-old']),
};

describe('appWorkFoldOf — 접기', () => {
  it('초점 에이전트 혼자의 활동 버블은 접히고 · 작업 위성 · 남이 쓰는 폴더 · 남의 파일은 남는다', () => {
    const fold = appWorkFoldOf(nodes, edges, agents, satellites, plan);
    expect(fold.hidden.has('folder-docs')).toBe(true);
    expect(fold.hidden.has('sat-file-brief')).toBe(true);
    expect(fold.hidden.has('domain-three')).toBe(true);
    expect(fold.hidden.has('sat-file-scene')).toBe(false); // 작업 위성
    expect(fold.hidden.has('folder-artifacts')).toBe(false); // 도깨비 작업도 쓰는 폴더
    expect(fold.hidden.has('sat-file-preview')).toBe(false); // 남의 파일
    expect(fold.hidden.has('folder-b-notes')).toBe(false); // 남만 쓰는 폴더
    expect(fold.hidden.has('sat-file-old')).toBe(true); // 넘침·연속 번호의 나머지
    expect(fold.hidden.has(APP)).toBe(false);
    expect(fold.hidden.has(A)).toBe(false);
  });

  it('접힌 개수는 화면에 있던 것만 세고 이름을 남긴다 · 초점이 없으면 아무것도 접지 않는다', () => {
    const fold = appWorkFoldOf(nodes, edges, agents, satellites, plan);
    const mine = fold.byAgent.get(A);
    expect(mine?.count).toBe(3);
    expect(mine?.names).toEqual(['brief.md', 'docs', 'threejs.org']);
    expect(appWorkFoldOf(nodes, edges, agents, satellites, EMPTY_APP_WORK_PLAN).hidden.size).toBe(0);
  });

  it('[버블 숨기기]로 이미 숨긴 것은 접힌 개수에 넣지 않는다 · 남이 숨겨 이 에이전트만 보여 주던 것은 넣는다', () => {
    const fold = appWorkFoldOf(nodes, edges, [{ ...agents[0]!, bubblesHidden: false }, { ...agents[1]!, bubblesHidden: true }], satellites, plan);
    const names = fold.byAgent.get(A)?.names ?? [];
    expect(names).not.toContain('b-notes'); // 도깨비 작업이 숨긴 제 폴더 — 이 에이전트가 말할 몫이 아니다
    expect(fold.hidden.has('folder-b-notes')).toBe(false); // 숨김은 ①-1 이 맡는다
    // 공유 폴더는 이 에이전트가 보여 주던 것 — 접으면 실제로 사라지니 센다(안의 남의 파일도 같이).
    expect(names).toEqual(['artifacts', 'brief.md', 'docs', 'preview.tsx', 'threejs.org']);
  });
});

describe('decorateAppWorkNodes — 그리는 사본의 표시 값', () => {
  const withHub: AppWorkPlan = {
    ...plan,
    hubs: new Map([[APP, {
      app: { id: APP, name: 'Vibi3D', glow: '#B9A8E0', exts: ['.glb'], kind: 'model', linkedAgentIds: [A], results: [] },
      work: [{ fileId: 'file-scene', path: 'C:/w/artifacts/scene-work.mjs', role: 'code', writes: 3, script: false, last: 1 }],
      overflow: [{ fileId: 'file-old', path: 'C:/w/artifacts/old.mjs', role: 'code', writes: 1, script: false, last: 0 }],
      meta: new Map(),
    }]]),
  };
  const withoutOverflow: AppWorkPlan = {
    ...withHub,
    hubs: new Map([[APP, { ...withHub.hubs.get(APP)!, overflow: [] }]]),
  };

  it('에이전트에는 접힌 개수 점, 앱 노드에는 궤도 · 넘침 — 같은 값이면 같은 사본', () => {
    const fold = appWorkFoldOf(nodes, edges, agents, satellites, plan);
    const once = decorateAppWorkNodes(nodes, withHub, fold, edges);
    const agent = once.find((n) => n.id === A)!;
    expect((agent.data as Record<string, unknown>)['_appWorkFolded']).toMatchObject({ count: 3 });
    const app = once.find((n) => n.id === APP)!;
    expect((app.data as Record<string, unknown>)['appWorkOrbit']).toMatchObject({ moons: 1, overflow: 1, overflowNames: ['old.mjs'], ring: '#B9A8E0' });
    const twice = decorateAppWorkNodes(nodes, withHub, fold, edges);
    expect(twice.find((n) => n.id === A)).toBe(agent);
    expect(twice.find((n) => n.id === APP)).toBe(app);
    expect(decorateAppWorkNodes(nodes, EMPTY_APP_WORK_PLAN, appWorkFoldOf(nodes, edges, agents, satellites, EMPTY_APP_WORK_PLAN), edges)).toBe(nodes);
  });

  it.each(['missing', 'hidden', 'despawning', 'unseated', 'disconnected'] as const)(
    '작업 파일이 %s 상태면 빈 궤도를 만들지 않는다',
    (state) => {
      const shown = nodes.flatMap((node) => {
        if (node.id !== 'sat-file-scene') return [node];
        if (state === 'missing') return [];
        return [{
          ...node,
          hidden: state === 'hidden',
          data: { ...node.data, _despawning: state === 'despawning', _seatAngle: state === 'unseated' ? undefined : -Math.PI / 2 },
        }];
      });
      const out = decorateAppWorkNodes(shown, withoutOverflow, EMPTY_APP_WORK_FOLD, state === 'disconnected' ? [] : edges);
      expect(out.find((node) => node.id === APP)?.data['appWorkOrbit']).toBeUndefined();
      expect(out).toBe(shown);
    },
  );

  it('위성이 사라지면 같은 원본 앱 노드의 캐시된 궤도도 내려간다', () => {
    const visible = decorateAppWorkNodes(nodes, withoutOverflow, EMPTY_APP_WORK_FOLD, edges);
    expect(visible.find((node) => node.id === APP)?.data['appWorkOrbit']).toMatchObject({ moons: 1 });
    const absent = nodes.filter((node) => node.id !== 'sat-file-scene');
    const hidden = decorateAppWorkNodes(absent, withoutOverflow, EMPTY_APP_WORK_FOLD, edges);
    expect(hidden.find((node) => node.id === APP)?.data['appWorkOrbit']).toBeUndefined();
  });

  it('결과 파일만 있어도 실제 위쪽 위성이면 센다 · 읽기 방향과 숨긴 선도 같은 소속이다', () => {
    const resultsOnly: AppWorkPlan = {
      ...withoutOverflow,
      hubs: new Map([[APP, { ...withoutOverflow.hubs.get(APP)!, work: [], meta: new Map() }]]),
    };
    const readEdges = [
      { id: 'sat-read', source: 'sat-file-scene', target: APP, hidden: true },
      { id: 'duplicate', source: APP, target: 'sat-file-scene' },
    ];
    const out = decorateAppWorkNodes(nodes, resultsOnly, EMPTY_APP_WORK_FOLD, readEdges);
    expect(out.find((node) => node.id === APP)?.data['appWorkOrbit']).toMatchObject({ moons: 1, overflow: 0 });
  });

  it('이름과 색이 같은 다른 앱의 위성을 내 궤도로 세지 않는다', () => {
    const otherId = 'app-other-model';
    const hub = withoutOverflow.hubs.get(APP)!;
    const twoApps: AppWorkPlan = {
      ...withoutOverflow,
      hubs: new Map([...withoutOverflow.hubs, [otherId, { ...hub, app: { ...hub.app, id: otherId } }]]),
    };
    const shown = [...nodes, { id: otherId, type: 'appNode', position: { x: 0, y: 0 }, data: { appBubbleId: otherId } }];
    const out = decorateAppWorkNodes(shown, twoApps, EMPTY_APP_WORK_FOLD, [{ id: 'other-link', source: otherId, target: 'sat-file-scene' }]);
    expect(out.find((node) => node.id === APP)?.data['appWorkOrbit']).toBeUndefined();
    expect(out.find((node) => node.id === otherId)?.data['appWorkOrbit']).toMatchObject({ moons: 1 });
  });

  it('위성이 없어도 넘침 점의 개수와 이름은 남는다', () => {
    const absent = nodes.filter((node) => node.id !== 'sat-file-scene');
    const out = decorateAppWorkNodes(absent, withHub, EMPTY_APP_WORK_FOLD, edges);
    expect(out.find((node) => node.id === APP)?.data['appWorkOrbit']).toMatchObject({
      moons: 0, overflow: 1, overflowNames: ['old.mjs'],
    });
  });
});
