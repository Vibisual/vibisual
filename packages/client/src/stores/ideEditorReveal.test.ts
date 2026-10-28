import { beforeEach, describe, expect, it } from 'vitest';
import type { SubAgent } from '@vibisual/shared';
import { useGraphStore, type IDEEditorFile } from './graphStore.js';

/**
 * §5.5 #17-27 ⑬ (g) — 줄을 든 열기 요청(`ideEditorReveal`): ⓐ 요청이 안 서 첫 줄에서 열린다 ⓑ 남은 요청에 나중에 옛 줄로 끌려간다
 * ⓒ 늦은 처리가 새 요청까지 지워 두 번째 클릭이 먹통 — 셋을 막는다.
 */

const PROJECT = 'project';
const AGENT = 'agent';
const store = (): ReturnType<typeof useGraphStore.getState> => useGraphStore.getState();
const sub = (id: string): SubAgent => ({
  id, sessionId: `session-${id}`, label: id, parentAgentId: AGENT, status: 'idle', createdAt: 0, lastActivityAt: 0,
});
const file = (relPath: string): IDEEditorFile => ({
  relPath, absPath: `/repo/${relPath}`, name: relPath.split('/').pop() ?? relPath,
});

beforeEach(() => {
  useGraphStore.setState({
    activeProject: PROJECT, ideOverlays: {}, closedIDEEditorTabs: [], idePaneSeq: 0, ideSplits: {},
    nodeMap: {}, agentConfigs: {}, agentProjects: {}, selectedSubByAgent: {}, defaultSubAgents: {},
    subAgents: { [AGENT]: [sub('a')] },
    ideEditorReveal: null,
  });
  store().openIDEOverlay(AGENT);
});

describe('openIDEEditorFile — 줄 범위를 실으면 그 창에 요청이 선다', () => {
  it('요청과 탭 전환이 함께 선다(편집창은 둘을 한 번에 본다)', () => {
    store().openIDEEditorFile(file('Source/Risk/X.h'), PROJECT, { start: 806, end: 807 });
    expect(store().ideEditorReveal).toMatchObject({ paneKey: PROJECT, relPath: 'Source/Risk/X.h', start: 806, end: 807 });
    expect(store().ideOverlays[PROJECT]!.activeEditorPath).toBe('Source/Risk/X.h');
  });

  it('같은 링크를 다시 눌러도 신원이 달라 한 번 더 데려간다', () => {
    store().openIDEEditorFile(file('src/a.ts'), PROJECT, { start: 3, end: 3 });
    const first = store().ideEditorReveal!.at;
    store().openIDEEditorFile(file('src/a.ts'), PROJECT, { start: 3, end: 3 });
    expect(store().ideEditorReveal!.at).toBeGreaterThan(first);
  });

  it('줄 없이 열면 요청을 세우지 않는다(종전 열기 그대로)', () => {
    store().openIDEEditorFile(file('src/a.ts'), PROJECT);
    expect(store().ideEditorReveal).toBeNull();
    expect(store().ideOverlays[PROJECT]!.activeEditorPath).toBe('src/a.ts');
  });

  it('창이 없으면 아무것도 세우지 않는다', () => {
    store().openIDEEditorFile(file('src/a.ts'), 'no-such-pane', { start: 3, end: 3 });
    expect(store().ideEditorReveal).toBeNull();
  });
});

describe('처리 전 요청은 낡으면 버린다', () => {
  it('같은 창에서 줄 없이 다른 파일을 열면 버린다 — 돌아왔을 때 옛 줄로 끌려가지 않게', () => {
    store().openIDEEditorFile(file('src/a.ts'), PROJECT, { start: 3, end: 3 });
    store().openIDEEditorFile(file('src/b.ts'), PROJECT);
    expect(store().ideEditorReveal).toBeNull();
  });

  it('다른 창의 요청은 이 창의 열기가 건드리지 않는다', () => {
    useGraphStore.setState({ ideEditorReveal: { paneKey: 'other-pane', relPath: 'x.ts', start: 1, end: 1, at: 5 } });
    store().openIDEEditorFile(file('src/b.ts'), PROJECT);
    expect(store().ideEditorReveal).toMatchObject({ paneKey: 'other-pane', at: 5 });
  });
});

describe('clearIdeEditorReveal — 신원이 맞을 때만 비운다', () => {
  it('그 사이 새로 들어온 요청은 남는다', () => {
    store().openIDEEditorFile(file('src/a.ts'), PROJECT, { start: 3, end: 3 });
    const first = store().ideEditorReveal!.at;
    store().openIDEEditorFile(file('src/a.ts'), PROJECT, { start: 9, end: 9 });
    store().clearIdeEditorReveal(first);
    expect(store().ideEditorReveal).toMatchObject({ start: 9, end: 9 });
    store().clearIdeEditorReveal(store().ideEditorReveal!.at);
    expect(store().ideEditorReveal).toBeNull();
  });
});
