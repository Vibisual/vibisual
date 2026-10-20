import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedExternalPath, ResolvedWorkspacePath } from './useWorkspacePathKind.js';
import { openMemoFileLink, openMemoUrl, useMemoLinkHost, type MemoLinkHost, type MemoLinkHostInputs } from './useMemoLinkHost.js';

const mocks = vi.hoisted(() => ({
  root: 'C:/repo' as string | null,
  pane: 'pane-a' as string | null,
  graph: {
    subAgents: {} as Record<string, { id: string; label: string }[]>,
    subAgentLabels: {} as Record<string, string>,
    openIDEOverlay: vi.fn(),
  },
  selectSession: vi.fn(),
  resolveWorkspacePath: vi.fn<(root: string, relPath: string) => Promise<ResolvedWorkspacePath>>(),
  resolveExternalPath: vi.fn<(path: string) => Promise<ResolvedExternalPath>>(),
  revealExternalPath: vi.fn(),
  openWorkspaceTarget: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../../stores/graphStore.js', () => ({ useGraphStore: { getState: () => mocks.graph } }));
vi.mock('./idePane.js', () => ({ useIDEPaneKey: () => mocks.pane }));
vi.mock('./ideSlot.js', () => ({ useIDESlotKey: () => 'slot-a' }));
vi.mock('./useIDEProjectRoot.js', () => ({ useIDEProjectRoot: () => mocks.root }));
vi.mock('./useSplitDrop.js', () => ({ useSelectSessionInSplit: () => mocks.selectSession }));
vi.mock('./useWorkspacePathKind.js', () => ({
  resolveWorkspacePath: mocks.resolveWorkspacePath,
  resolveExternalPath: mocks.resolveExternalPath,
  revealExternalPath: mocks.revealExternalPath,
}));
vi.mock('./openWorkspaceTarget.js', () => ({ openWorkspaceTarget: mocks.openWorkspaceTarget }));

let view: ReactTestRenderer | undefined;
let host: MemoLinkHost;
function Probe({ inputs }: { inputs: MemoLinkHostInputs }): null {
  host = useMemoLinkHost(inputs);
  return null;
}
function render(overrides: Partial<MemoLinkHostInputs> = {}): MemoLinkHostInputs {
  const inputs: MemoLinkHostInputs = {
    agentId: 'agent', activeSessionId: 'a', isCustom: true, prompts: [], jumpToStream: vi.fn(), ...overrides,
  };
  act(() => {
    if (view) view.update(<Probe inputs={inputs} />);
    else view = create(<Probe inputs={inputs} />);
  });
  return inputs;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.root = 'C:/repo';
  mocks.pane = 'pane-a';
  mocks.graph.subAgents = { agent: [{ id: 'a', label: 'Session A' }, { id: 'b', label: 'Session B' }] };
  mocks.graph.subAgentLabels = {};
  mocks.resolveWorkspacePath.mockResolvedValue({ kind: 'file', absPath: 'C:/repo/src/App.tsx', executable: false });
  mocks.resolveExternalPath.mockResolvedValue({ kind: 'file', absPath: 'D:/notes/a.md' });
});

afterEach(() => {
  act(() => view?.unmount());
  view = undefined;
  vi.unstubAllGlobals();
});

describe('memo file links use the existing workspace opening route', () => {
  it('preserves the normalized path, selected lines and owning pane', async () => {
    expect(await openMemoFileLink('C:\\repo\\src\\App.tsx:42-44', 'C:/repo', 'pane-a', 'run failed')).toBe(true);
    expect(mocks.resolveWorkspacePath).toHaveBeenCalledWith('C:/repo', 'src/App.tsx');
    expect(mocks.openWorkspaceTarget).toHaveBeenCalledWith({
      relPath: 'src/App.tsx', absPath: 'C:/repo/src/App.tsx', kind: 'file', lines: { start: 42, end: 44 },
    }, 'C:/repo', 'run failed', 'pane-a');
    expect(mocks.revealExternalPath).not.toHaveBeenCalled();
  });

  it('passes executable detection through to the workspace opener', async () => {
    mocks.resolveWorkspacePath.mockResolvedValue({ kind: 'file', absPath: 'C:/repo/tools/run.cmd', executable: true });
    expect(await openMemoFileLink('tools/run.cmd', 'C:/repo', 'pane-a', 'run failed')).toBe(true);
    expect(mocks.openWorkspaceTarget).toHaveBeenCalledWith(expect.objectContaining({ executable: true }), 'C:/repo', 'run failed', 'pane-a');
  });

  it('returns failure for missing files without attempting to open them', async () => {
    mocks.resolveWorkspacePath.mockResolvedValue({ kind: 'missing', absPath: '', executable: false });
    expect(await openMemoFileLink('src/App.tsx', 'C:/repo', 'pane-a', 'run failed')).toBe(false);
    expect(mocks.openWorkspaceTarget).not.toHaveBeenCalled();
  });

  it('does not resolve an empty path or a path without a project root', async () => {
    expect(await openMemoFileLink('', 'C:/repo', null, '')).toBe(false);
    expect(await openMemoFileLink('src/App.tsx', null, null, '')).toBe(false);
    expect(mocks.resolveWorkspacePath).not.toHaveBeenCalled();
    expect(mocks.resolveExternalPath).not.toHaveBeenCalled();
    expect(mocks.openWorkspaceTarget).not.toHaveBeenCalled();
  });

  it('reveals an external file instead of sending it through a workspace opener', async () => {
    expect(await openMemoFileLink('D:\\notes\\a.md:12', 'C:/repo', 'pane-a', '')).toBe(true);
    expect(mocks.resolveExternalPath).toHaveBeenCalledWith('D:/notes/a.md');
    expect(mocks.revealExternalPath).toHaveBeenCalledWith('D:/notes/a.md');
    expect(mocks.resolveWorkspacePath).not.toHaveBeenCalled();
    expect(mocks.openWorkspaceTarget).not.toHaveBeenCalled();
  });

  it('does not reveal an external path that no longer exists', async () => {
    mocks.resolveExternalPath.mockResolvedValue({ kind: 'missing', absPath: '' });
    expect(await openMemoFileLink('D:/notes/a.md', 'C:/repo', null, '')).toBe(false);
    expect(mocks.revealExternalPath).not.toHaveBeenCalled();
  });
});

describe('memo link navigation uses the live session state', () => {
  it('keeps its host identity while adopting the latest pane, project and inputs', async () => {
    render();
    const original = host;
    mocks.root = 'C:/other-project';
    mocks.pane = 'pane-b';
    mocks.resolveWorkspacePath.mockResolvedValue({ kind: 'file', absPath: 'C:/other-project/README.md', executable: false });
    const inputs = render({ activeSessionId: 'b', prompts: [{ id: 'prompt-b', text: 'New input', at: 123 }] });
    expect(host).toBe(original);
    expect(host.prompts()).toBe(inputs.prompts);
    expect(host.rootPath()).toBe('C:/other-project');
    expect(host.sessions()).toEqual([{ id: 'a', label: 'Session A' }]);
    await host.open({ kind: 'file', path: 'README.md' });
    expect(mocks.openWorkspaceTarget).toHaveBeenCalledWith(expect.any(Object), 'C:/other-project', 'ide.streamRenderer.pathLink.runFailed', 'pane-b');
  });

  it('reads renames and closed sessions when the menu opens, without requiring a rerender', () => {
    render();
    mocks.graph.subAgentLabels.b = 'Renamed B';
    expect(host.sessions()).toEqual([{ id: 'b', label: 'Renamed B' }]);
    expect(host.sessionInfo('b')).toEqual({ label: 'Renamed B', alive: true });
    mocks.graph.subAgents.agent = [{ id: 'a', label: 'Session A' }];
    expect(host.sessions()).toEqual([]);
    expect(host.sessionInfo('b')).toEqual({ label: '', alive: false });
  });

  it('jumps within the current stream and focuses another session with its bookmark', async () => {
    const inputs = render();
    expect(await host.open({ kind: 'stream', sessionId: 'a', anchorId: 'cmd-a', text: 'Selected text' })).toBe(true);
    expect(inputs.jumpToStream).toHaveBeenCalledWith('cmd-a', 'Selected text');
    expect(mocks.graph.openIDEOverlay).not.toHaveBeenCalled();
    expect(await host.open({ kind: 'stream', sessionId: 'b', anchorId: 'cmd-b', text: 'Other text' })).toBe(true);
    expect(mocks.graph.openIDEOverlay).toHaveBeenCalledWith('agent', {
      focus: { sessionId: 'b', bookmark: { text: 'Other text', anchorId: 'cmd-b' } },
    });
    expect(mocks.selectSession).not.toHaveBeenCalled();
  });

  it('opens a live session through the split-aware selector, then rejects it after closure', async () => {
    render();
    expect(await host.open({ kind: 'session', sessionId: 'b' })).toBe(true);
    expect(mocks.selectSession).toHaveBeenCalledWith('b');
    mocks.selectSession.mockClear();
    mocks.graph.subAgents.agent = [{ id: 'a', label: 'Session A' }];
    // A same-named session under another agent is not a target for this memo.
    mocks.graph.subAgents.other = [{ id: 'b', label: 'Other agent session' }];
    expect(await host.open({ kind: 'session', sessionId: 'b' })).toBe(false);
    expect(await host.open({ kind: 'stream', sessionId: 'b', text: 'Old text' })).toBe(false);
    expect(mocks.selectSession).not.toHaveBeenCalled();
    expect(mocks.graph.openIDEOverlay).not.toHaveBeenCalled();
  });

  it('offers the main session only for hook agents and excludes the active session', async () => {
    render();
    expect(host.sessions().some((session) => session.id === null)).toBe(false);
    expect(await host.open({ kind: 'session', sessionId: null })).toBe(false);
    render({ isCustom: false });
    expect(host.sessions()).toEqual([
      { id: null, label: 'ide.tabbar.agentTabLabel' }, { id: 'b', label: 'Session B' },
    ]);
    expect(await host.open({ kind: 'session', sessionId: null })).toBe(true);
    expect(mocks.selectSession).toHaveBeenCalledWith(null);
    render({ isCustom: false, activeSessionId: null });
    expect(host.sessions().map((session) => session.id)).toEqual(['a', 'b']);
  });
});

describe('memo web links validate the saved target before opening', () => {
  it('opens a safe address with no opener access and rejects unsafe stored targets', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    expect(openMemoUrl('https://example.com/docs')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer');
    open.mockClear();
    for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///C:/repo/private.txt']) {
      expect(openMemoUrl(url)).toBe(false);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('reports failure if the browser API is unavailable or throws', () => {
    vi.stubGlobal('window', {});
    expect(openMemoUrl('https://example.com')).toBe(false);
    vi.stubGlobal('window', { open: () => { throw new Error('Cannot open'); } });
    expect(openMemoUrl('https://example.com')).toBe(false);
  });
});
