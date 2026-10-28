import { beforeEach, describe, expect, it } from 'vitest';
import type { BubbleData } from '@vibisual/shared';

import {
  useGraphStore,
  selectIDEPane,
  selectPaneProjectName,
  selectPaneProjectPath,
} from './graphStore.js';

/**
 * §5.7 #26 — **워크트리 안에서 만든 버블은 워크트리 안에서만 돈다.** IDE 창의 두 뜻을 가른다: ① 어느 탭에 그려지나(슬롯 주소 — 부모,
 * 드릴다운해도 `activeProject` 는 부모) ② 무슨 트리를 다루나(탐색기 뿌리·실행 구성·cwd·중단점 키 — 워크트리). ①을 ②로 쓰면 부모 트리에서 돈다.
 */

const PARENT = 'demo-app';
const PARENT_PATH = 'C:/work/demo-app';
const WT = 'wt-20260827';
const WT_PATH = 'C:/work/demo-app/.claude/worktrees/wt-20260827';

const WT_AGENT = 'agent-wt';
const PARENT_AGENT = 'agent-parent';
/** 워크트리 버블을 띄운 창의 슬롯 — 부모 탭에 매달려 있다(`openIDEOverlay` 규약). */
const PANE = PARENT;

function agentNode(id: string): BubbleData {
  return { id, label: id, bubbleType: 'agent', path: id, status: 'idle', activity: 0 };
}

function reset(): void {
  useGraphStore.setState({
    activeProject: PARENT,
    nodeMap: { [WT_AGENT]: agentNode(WT_AGENT), [PARENT_AGENT]: agentNode(PARENT_AGENT) },
    projects: {
      [PARENT]: { name: PARENT, path: PARENT_PATH },
      [WT]: { name: WT, path: WT_PATH, parentProjectPath: PARENT_PATH, worktreeName: WT },
    },
    stubProjects: {},
    agentProjects: { [WT_AGENT]: WT, [PARENT_AGENT]: PARENT },
    ideOverlays: {},
    idePaneSeq: 0,
    subAgents: {},
    agentConfigs: {},
    selectedSubByAgent: {},
    defaultSubAgents: {},
  });
}

describe('워크트리 버블 IDE 는 워크트리 트리를 본다 (§5.7 #26)', () => {
  beforeEach(reset);

  it('창은 부모 탭 슬롯에 서지만, 다루는 트리는 워크트리다', () => {
    useGraphStore.getState().openIDEOverlay(WT_AGENT, { pane: 'new' });
    const s = useGraphStore.getState();

    // ① 슬롯은 부모 — 워크트리로 드릴다운해도 창이 보여야 하므로 이 값은 바뀌면 안 된다.
    expect(selectIDEPane(s, PANE).projectId).toBe(PARENT);
    // ② 내용은 워크트리 — 탐색기 뿌리·실행 cwd·실행 구성 스캔이 전부 이 경로를 쓴다.
    expect(selectPaneProjectName(s, PANE)).toBe(WT);
    expect(selectPaneProjectPath(s, PANE)).toBe(WT_PATH);
  });

  it('워크트리가 아닌 버블은 종전대로 활성 프로젝트를 본다', () => {
    useGraphStore.getState().openIDEOverlay(PARENT_AGENT, { pane: 'new' });
    const s = useGraphStore.getState();
    expect(selectPaneProjectName(s, PANE)).toBe(PARENT);
    expect(selectPaneProjectPath(s, PANE)).toBe(PARENT_PATH);
  });

  it('소속 프로젝트를 아직 모르면(스냅샷 공백) 슬롯으로 떨어져 화면이 비지 않는다', () => {
    useGraphStore.getState().openIDEOverlay(WT_AGENT, { pane: 'new' });
    useGraphStore.setState({ agentProjects: {} });
    const s = useGraphStore.getState();
    expect(selectPaneProjectName(s, PANE)).toBe(PARENT);
    expect(selectPaneProjectPath(s, PANE)).toBe(PARENT_PATH);
  });

  it('이름만 있고 경로를 모르는 프로젝트는 채택하지 않는다 — 뿌리 없는 빈 탐색기 방지', () => {
    useGraphStore.getState().openIDEOverlay(WT_AGENT, { pane: 'new' });
    useGraphStore.setState({ agentProjects: { [WT_AGENT]: '사라진-워크트리' } });
    const s = useGraphStore.getState();
    expect(selectPaneProjectPath(s, PANE)).toBe(PARENT_PATH);
  });

  it('stub 프로젝트(아직 hydrate 전)의 워크트리도 경로를 찾는다', () => {
    useGraphStore.getState().openIDEOverlay(WT_AGENT, { pane: 'new' });
    useGraphStore.setState({
      projects: { [PARENT]: { name: PARENT, path: PARENT_PATH } },
      stubProjects: {
        [WT]: {
          project: { name: WT, path: WT_PATH, parentProjectPath: PARENT_PATH, worktreeName: WT },
          lastSavedAt: 0,
          createdAt: 0,
          checkpointPath: `${WT_PATH}/.vibisual/save/checkpoint.json`,
          isHydrated: false,
        },
      },
    });
    expect(selectPaneProjectPath(useGraphStore.getState(), PANE)).toBe(WT_PATH);
  });
});
