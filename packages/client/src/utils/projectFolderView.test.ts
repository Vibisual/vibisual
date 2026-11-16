/**
 * §5.1 #2-3 — 프로젝트 폴더 버블. 메인 원 둘레의 루트 구성(최상위 파일 · 루트 묶음)이 둘 이상이면 폴더 하나로 접고,
 * 위성은 폴더 위성 규칙(문서는 최근 것부터 상한까지 · 미리보기·묶음은 상한 밖), 선은 에이전트 쌍마다 하나다.
 */
import { describe, expect, it } from 'vitest';
import type { ActivityEdge, BubbleData } from '@vibisual/shared';
import { DEFAULT_MAX_SATELLITES } from '@vibisual/shared';

import {
  PROJECT_FOLDER_NODE_ID,
  collapseProjectFolderEdges,
  groupProjectFolder,
  isProjectRootMember,
  projectFolderBubbleOf,
  projectFolderInteriorEdges,
} from './projectFolderView.js';

function file(id: string, extra: Partial<BubbleData> = {}): BubbleData {
  return { id, label: id, bubbleType: 'file', path: id, status: 'idle', activity: 1, ...extra };
}

function folder(id: string): BubbleData {
  return { id, label: id, bubbleType: 'internal_folder', path: id, status: 'idle', activity: 3, childCount: 2 };
}

function edge(id: string, source: string, target: string, timestamp: number, isActive = false): ActivityEdge {
  return { id, source, target, label: '', timestamp, isActive };
}

function pfOf(files: BubbleData[]): BubbleData {
  return projectFolderBubbleOf({ label: 'vibisual', absolutePath: '/repo', files })!;
}

describe('projectFolderBubbleOf — 폴더 버블 모양', () => {
  it('내부 폴더 모양이고 수·활동·상태는 루트 파일 전부로 잰다', () => {
    const pf = pfOf([
      file('a.md', { activity: 2, readCount: 3, lastActivity: 10 }),
      file('b.md', { activity: 4, writeCount: 1, lastActivity: 30, status: 'active' }),
    ]);
    expect(pf).toMatchObject({
      id: PROJECT_FOLDER_NODE_ID, label: 'vibisual', bubbleType: 'internal_folder', absolutePath: '/repo',
      status: 'active', activity: 6, childCount: 2, readCount: 3, writeCount: 1, lastActivity: 30,
      maxSatellites: DEFAULT_MAX_SATELLITES,
    });
  });

  it('위성 상한은 서버 루트 노드 설정을 따른다 · 파일이 없으면 null', () => {
    expect(projectFolderBubbleOf({ label: 'p', root: { maxSatellites: 5 }, files: [file('a')] })?.maxSatellites).toBe(5);
    expect(projectFolderBubbleOf({ label: 'p', files: [] })).toBeNull();
  });
});

describe('isProjectRootMember — 루트 구성만', () => {
  it('최상위 파일과 루트 묶음만 구성이다 — 폴더·다른 묶음은 아니다', () => {
    expect(isProjectRootMember(file('a.md'))).toBe(true);
    expect(isProjectRootMember({ id: 'bundle-radial-x', bubbleType: 'bundle' })).toBe(true);
    expect(isProjectRootMember({ id: 'sat-bundle-docs-x', bubbleType: 'bundle' })).toBe(false);
    expect(isProjectRootMember(folder('docs'))).toBe(false);
  });
});

describe('groupProjectFolder — 둘부터 접는다', () => {
  const base = { satInfos: [], bundled: new Map<string, string>(), heat: undefined };

  it('루트 구성이 하나면 접지 않는다 — 다른 폴더 버블은 세지 않는다', () => {
    const radial = [folder('docs'), folder('src'), file('README.md')];
    expect(groupProjectFolder({ ...base, folder: pfOf([file('README.md')]), radial, radialBefore: radial })).toBeNull();
  });

  it('둘 이상이면 첫 구성 자리에 폴더 하나 — 다른 폴더 버블은 그대로', () => {
    const radial = [folder('docs'), file('README.md', { lastActivity: 1 }), folder('src'), file('NOTICE', { lastActivity: 2 })];
    const pf = pfOf(radial.filter((b) => b.bubbleType === 'file'));
    const g = groupProjectFolder({ ...base, folder: pf, radial, radialBefore: radial })!;
    expect(g.radial.map((b) => b.id)).toEqual(['docs', PROJECT_FOLDER_NODE_ID, 'src']);
    expect([...g.memberOf.keys()].sort()).toEqual(['NOTICE', 'README.md']);
    expect(g.satInfos.map((s) => [s.bubble.id, s.parentId])).toEqual([
      ['sat-NOTICE', PROJECT_FOLDER_NODE_ID],
      ['sat-README.md', PROJECT_FOLDER_NODE_ID],
    ]);
  });

  it('문서 위성은 최근 것부터 상한까지, 미리보기는 상한 밖이다', () => {
    const radial = [
      file('a.md', { lastActivity: 1 }), file('b.md', { lastActivity: 2 }), file('c.md', { lastActivity: 3 }),
      file('shot.png', { lastActivity: 0 }),
    ];
    const g = groupProjectFolder({ ...base, folder: pfOf(radial), radial, radialBefore: radial })!;
    const ids = g.satInfos.map((s) => s.bubble.id);
    expect(ids).toContain('sat-c.md');
    expect(ids).toContain('sat-b.md');
    expect(ids).not.toContain('sat-a.md');
    expect(ids).toContain('sat-shot.png');
    // 거느릴 수 = 문서 상한 + 미리보기 수(문서와 미리보기가 첫 고리 칸을 나눠 갖지 않게).
    expect(g.satInfos.every((s) => s.parentSlots === DEFAULT_MAX_SATELLITES + 1)).toBe(true);
  });

  it('루트 묶음은 위성 자리로 옮겨 서고 제 위성도 따라간다 — 선 방향은 가장 최근 구성의 도구', () => {
    const png1 = file('a.png', { lastActivity: 5, lastTool: 'Read' });
    const png2 = file('b.png', { lastActivity: 9, lastTool: 'Write' });
    const bundle: BubbleData = { id: 'bundle-radial-image', label: 'p', bubbleType: 'bundle', path: '', status: 'idle', activity: 1, lastActivity: 9 };
    const readme = file('README.md', { lastActivity: 1 });
    const moon = {
      bubble: { ...png2, id: 'sat-b.png' }, parentId: bundle.id, parentSize: 60,
      edge: { id: 'sat-edge-b.png', source: bundle.id, target: 'sat-b.png', isActive: false, color: '#fff', sourceRadius: 30, targetRadius: 20 },
      index: 0, total: 1, localRange: { min: 0, max: 0 }, heat: undefined,
    };
    const g = groupProjectFolder({
      folder: pfOf([png1, png2, readme]),
      radial: [bundle, readme],
      radialBefore: [png1, png2, readme],
      satInfos: [moon],
      bundled: new Map([['a.png', bundle.id], ['b.png', bundle.id]]),
      heat: undefined,
    })!;
    const seat = g.satInfos.find((s) => s.bubble.id === 'sat-bundle-radial-image')!;
    expect(seat.parentId).toBe(PROJECT_FOLDER_NODE_ID);
    expect([seat.edge.source, seat.edge.target]).toEqual([PROJECT_FOLDER_NODE_ID, 'sat-bundle-radial-image']);
    const moved = g.satInfos.find((s) => s.bubble.id === 'sat-b.png')!;
    expect(moved.parentId).toBe('sat-bundle-radial-image');
    expect(moved.edge.source).toBe('sat-bundle-radial-image');
  });
});

describe('collapseProjectFolderEdges — 에이전트 쌍마다 선 하나', () => {
  const members = new Set(['README.md', 'NOTICE']);
  const endOf = (id: string): string => (members.has(id) ? PROJECT_FOLDER_NODE_ID : id);

  it('가장 최근 선의 방향 · 하나라도 살아 있으면 산 선 · 다른 선은 그대로', () => {
    const out = collapseProjectFolderEdges([
      edge('e1', 'README.md', 'agent-1', 10, true),
      edge('e2', 'agent-1', 'NOTICE', 20),
      edge('e3', 'agent-1', 'docs', 5),
      edge('e4', 'agent-2', 'README.md', 1),
    ], endOf);
    expect(out.map((e) => [e.id, e.source, e.target, e.isActive])).toEqual([
      [`${PROJECT_FOLDER_NODE_ID}:agent-1`, 'agent-1', PROJECT_FOLDER_NODE_ID, true],
      ['e3', 'agent-1', 'docs', false],
      [`${PROJECT_FOLDER_NODE_ID}:agent-2`, 'agent-2', PROJECT_FOLDER_NODE_ID, false],
    ]);
  });
});

describe('projectFolderInteriorEdges — 폴더 안 선', () => {
  it('읽기는 파일 → 폴더, 그 밖은 폴더 → 파일', () => {
    const out = projectFolderInteriorEdges([file('a.md', { lastTool: 'Read' }), file('b.md', { lastTool: 'Edit', status: 'active' })]);
    expect(out.map((e) => [e.source, e.target, e.isActive])).toEqual([
      ['a.md', PROJECT_FOLDER_NODE_ID, false],
      [PROJECT_FOLDER_NODE_ID, 'b.md', true],
    ]);
  });
});
