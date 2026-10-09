import { beforeEach, describe, expect, it } from 'vitest';
import type { SubAgent } from '@vibisual/shared';
import { DEFAULT_IDE_OVERLAY, useGraphStore } from './graphStore.js';
import { editorOpenerTab } from './editorOpener.js';
import { captureIDEPaneHandoff } from './idePaneHandoff.js';
import { IDE_EDITOR_REOPEN_MAX, rememberIDEEditorTabs } from './ideEditorReopen.js';

const PROJECT = 'project';
const AGENT = 'agent';
const store = (): ReturnType<typeof useGraphStore.getState> => useGraphStore.getState();
const pane = () => store().ideOverlays[PROJECT]!;
const sub = (id: string): SubAgent => ({
  id, sessionId: `session-${id}`, label: id, parentAgentId: AGENT, status: 'idle', createdAt: 0, lastActivityAt: 0,
});
const open = (agentId = AGENT): void => store().openIDEOverlay(agentId);
const reopen = (): void => { store().closeIDEOverlay(PROJECT); open(); };

beforeEach(() => {
  useGraphStore.setState({
    activeProject: PROJECT, ideOverlays: {}, closedIDEEditorTabs: [], idePaneSeq: 0, ideSplits: {},
    nodeMap: {}, agentConfigs: {}, agentProjects: {}, selectedSubByAgent: {}, defaultSubAgents: {},
    subAgents: { [AGENT]: [sub('a'), sub('b')] },
  });
});

describe('IDE 창을 다시 열어도 우측 탭은 남는다', () => {
  it('웹 페이지 빈 탭의 종류·활성 경로를 복원하고 기억을 꺼낸다', () => {
    open();
    store().openIDEPaneOpener('html', PROJECT);
    reopen();
    expect(pane().editorFiles).toEqual([editorOpenerTab('html')]);
    expect(pane().activeEditorPath).toBe('//opener/html');
    expect(store().closedIDEEditorTabs).toEqual([]);
    reopen();
    expect(pane().editorFiles).toEqual([editorOpenerTab('html')]);
  });

  it('파일과 빈 탭의 순서·선택은 유지하고 초안 없는 dirty 표식은 걷는다', () => {
    open();
    store().openIDEEditorFile({ relPath: 'index.html', absPath: '/repo/index.html', name: 'index.html', dirty: true }, PROJECT);
    store().openIDEPaneOpener('html', PROJECT);
    store().openIDEPaneOpener('pdf', PROJECT);
    store().setActiveIDEEditorFile('//opener/html', PROJECT);
    reopen();
    expect(pane().editorFiles.map((file) => file.relPath)).toEqual(['index.html', '//opener/html', '//opener/pdf']);
    expect(pane().activeEditorPath).toBe('//opener/html');
    expect(pane().editorFiles[0]?.dirty).toBeUndefined();
  });

  it.each(['tab', 'panel'] as const)('직접 닫은 %s는 재열기 때 살아나지 않는다', (target) => {
    open();
    store().openIDEPaneOpener('html', PROJECT);
    reopen();
    if (target === 'tab') store().closeIDEEditorFile('//opener/html', PROJECT);
    else store().closeIDEEditor(PROJECT);
    reopen();
    expect(pane().editorFiles).toEqual([]);
    expect(pane().activeEditorPath).toBeNull();
    expect(store().closedIDEEditorTabs).toEqual([]);
  });

  it('같은 슬롯에 다른 에이전트를 열어도 탭은 각 주인에게 돌아온다', () => {
    open();
    store().openIDEPaneOpener('html', PROJECT);
    open('other-agent');
    expect(pane().editorFiles).toEqual([]);
    store().openIDEPaneOpener('pdf', PROJECT);
    open();
    expect(pane().editorFiles).toEqual([editorOpenerTab('html')]);
    open('other-agent');
    expect(pane().editorFiles).toEqual([editorOpenerTab('pdf')]);
  });

  it('다른 프로젝트의 같은 에이전트와 탭을 섞지 않는다', () => {
    open();
    store().openIDEPaneOpener('html', PROJECT);
    store().closeIDEOverlay(PROJECT);
    useGraphStore.setState({ activeProject: 'other-project' });
    open();
    expect(store().ideOverlays['other-project']?.editorFiles).toEqual([]);
    store().closeIDEOverlay('other-project');
    useGraphStore.setState({ activeProject: PROJECT });
    open();
    expect(pane().editorFiles).toEqual([editorOpenerTab('html')]);
  });

  it('세션별 탭과 고정도 복원하며 전체 보기를 다른 세션으로 바꾸지 않는다', () => {
    open();
    store().setIDEActiveSession('a', PROJECT);
    store().openIDEPaneOpener('html', PROJECT);
    store().setIDEActiveSession('b', PROJECT);
    store().openIDEPaneOpener('pdf', PROJECT);
    reopen();
    expect(pane().activeSessionId).toBe('b');
    expect(pane().editorFiles).toEqual([editorOpenerTab('pdf')]);
    store().setIDEActiveSession('a', PROJECT);
    expect(pane().editorFiles).toEqual([editorOpenerTab('html')]);
    store().setIDEEditorTabsPinned(true, PROJECT);
    store().setIDEActiveSession(null, PROJECT);
    reopen();
    expect(pane().activeSessionId).toBeNull();
    expect(pane().editorPinned).toBe(true);
    expect(pane().editorFiles).toEqual([editorOpenerTab('html')]);
  });

  it('닫힌 사이 삭제된 세션의 파일을 다른 세션에 펼치지 않는다', () => {
    open();
    store().setIDEActiveSession('a', PROJECT);
    store().openIDEPaneOpener('html', PROJECT);
    store().closeIDEOverlay(PROJECT);
    useGraphStore.setState({ subAgents: { [AGENT]: [sub('b')] }, defaultSubAgents: { [AGENT]: 'b' } });
    open();
    expect(pane().activeSessionId).toBe('b');
    expect(pane().editorFiles).toEqual([]);
    expect(pane().editorTabsBySession).toEqual({});
  });

  it('무대 선택의 null이 복원된 파일 탭을 숨기지 않는다', () => {
    open();
    store().openIDEPaneOpener('html', PROJECT);
    store().setIDEStageOpen(true, PROJECT);
    expect(pane().activeEditorPath).toBeNull();
    reopen();
    expect(pane().activeEditorPath).toBe('//opener/html');
  });

  it('세션 목록을 아직 받지 못했어도 보던 웹 페이지 탭을 숨기지 않는다', () => {
    open();
    store().setIDEActiveSession('a', PROJECT);
    store().openIDEPaneOpener('html', PROJECT);
    store().closeIDEOverlay(PROJECT);
    useGraphStore.setState({ subAgents: {} });
    open();
    expect(pane().activeSessionId).toBe('a');
    expect(pane().editorFiles).toEqual([editorOpenerTab('html')]);
    expect(pane().activeEditorPath).toBe('//opener/html');
  });

  it('독립 창으로 넘긴 뒤에는 앱의 옛 탭을 되살리지 않는다', () => {
    open();
    store().openIDEPaneOpener('html', PROJECT);
    store().closeIDEOverlay(PROJECT, { rememberEditorTabs: false });
    expect(store().closedIDEEditorTabs).toEqual([]);
    open();
    expect(pane().editorFiles).toEqual([]);
  });

  it('다른 창에서 받은 최신 탭이 기억보다 우선하며 옛 세션 묶음도 섞지 않는다', () => {
    open();
    store().openIDEPaneOpener('html', PROJECT);
    store().setIDEEditorTabsPinned(true, PROJECT);
    const handoff = captureIDEPaneHandoff({ ...pane(), editorFiles: [], activeEditorPath: null });
    store().closeIDEOverlay(PROJECT);
    store().openIDEOverlay(AGENT, { handoff, handoffTarget: 'app', redock: true });
    expect(pane().editorFiles).toEqual([]);
    expect(pane().editorPinned).toBe(false);
    expect(pane().editorTabsBySession).toEqual({});
    expect(store().closedIDEEditorTabs).toEqual([]);
    reopen();
    expect(pane().editorFiles).toEqual([]);
  });

  it('기억은 주인 수 상한을 지키고 세션 묶음도 별도로 복사한다', () => {
    let history: ReturnType<typeof rememberIDEEditorTabs> = [];
    const source = {
      ...DEFAULT_IDE_OVERLAY, projectId: PROJECT, agentId: AGENT,
      editorFiles: [editorOpenerTab('html')],
      editorTabsBySession: { a: { files: [{ ...editorOpenerTab('pdf'), dirty: true }], activePath: '//opener/pdf' } },
    };
    for (let i = 0; i <= IDE_EDITOR_REOPEN_MAX; i += 1) {
      history = rememberIDEEditorTabs(history, { ...source, agentId: `agent-${i}` });
    }
    expect(history).toHaveLength(IDE_EDITOR_REOPEN_MAX);
    expect(history[0]?.agentId).toBe('agent-1');
    expect(history[0]?.editorTabsBySession.a?.files[0]?.dirty).toBeUndefined();
    expect(source.editorTabsBySession.a.files[0]?.dirty).toBe(true);
    source.editorFiles[0]!.name = 'changed';
    expect(history[0]?.editorFiles[0]?.name).toBe('');
  });
});
