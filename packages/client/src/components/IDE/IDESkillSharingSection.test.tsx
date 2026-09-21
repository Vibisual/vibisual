import { createElement } from 'react';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillSharingEntry } from '@vibisual/shared';
import { IDESkillSharingSection } from './IDESkillSharingSection.js';

const fixture = vi.hoisted(() => ({ pane: { agentId: 'agent-a', activeSessionId: 'session-a' }, provider: 'codex-cli' as string | undefined }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./idePane.js', () => ({ useIDEPaneKey: () => 'pane-a', readIDEPane: () => fixture.pane }));
vi.mock('../../stores/graphStore.js', () => ({ useGraphStore: { getState: () => ({
  agentConfigs: { [fixture.pane.agentId]: { provider: { kind: fixture.provider } } },
}) } }));

const skill: SkillSharingEntry = {
  id: 'source-1', name: 'review', description: 'Review the project', sourceProvider: 'claude',
  scope: 'project', sourcePath: '/project/.claude/skills/review', status: 'available', issues: [],
};
const onUse = vi.fn();
const onShared = vi.fn();
let view: ReactTestRenderer | undefined;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function response(skills: SkillSharingEntry[] = [skill]): Response {
  return new Response(JSON.stringify({ ok: true, provider: 'codex', skills }));
}
function shared(status = 'shared', issues: string[] = []): Response {
  return new Response(JSON.stringify({ ok: true, result: { status, name: skill.name, path: '/project/.agents/skills/review', issues } }));
}
function element(activeSessionId = 'session-a', agentId = 'agent-a'): React.ReactElement {
  return createElement(IDESkillSharingSection, { agentId, activeSessionId, provider: 'codex', onUse, onShared });
}
function button(label: string): ReactTestInstance {
  return view!.root.findAllByType('button').find((node) => node.children.includes(`ide.skillSharing.${label}`))!;
}
async function render(): Promise<void> {
  await act(async () => { view = create(element()); });
}
function deferredResponse(): { promise: Promise<Response>; resolve: (value: Response) => void } {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  fixture.pane = { agentId: 'agent-a', activeSessionId: 'session-a' };
  fixture.provider = 'codex-cli';
  onUse.mockReset(); onShared.mockReset();
  fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  await act(async () => { view?.unmount(); });
  view = undefined;
  vi.unstubAllGlobals();
});

describe('user skill sharing interactions', () => {
  it('shares by opaque source ID, inserts only after success, refreshes the installed list, then offers Use', async () => {
    const pending = deferredResponse();
    fetchMock.mockResolvedValueOnce(response()).mockReturnValueOnce(pending.promise);
    await render();
    expect(JSON.stringify(view!.toJSON())).toContain('Review the project');
    await act(async () => button('shareAndUse').props.onClick());
    expect(button('sharing').props.disabled).toBe(true);
    expect(onUse).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/skill-sharing', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ agentId: 'agent-a', sourceId: 'source-1' }),
    }));
    await act(async () => pending.resolve(shared()));
    expect(onUse).toHaveBeenCalledExactlyOnceWith('review');
    expect(onShared).toHaveBeenCalledOnce();
    expect(button('use').props.disabled).toBe(false);
    expect(JSON.stringify(view!.toJSON())).toContain('ide.skillSharing.sharedHint');
  });

  it('revalidates an already shared skill before use and does not insert after a new conflict', async () => {
    fetchMock.mockResolvedValueOnce(response([{ ...skill, status: 'shared' }])).mockResolvedValueOnce(shared('conflict', ['name-conflict']));
    await render();
    await act(async () => button('use').props.onClick());
    expect(onUse).not.toHaveBeenCalled();
    expect(onShared).not.toHaveBeenCalled();
    expect(button('shareAndUse').props.disabled).toBe(true);
    expect(JSON.stringify(view!.toJSON())).toContain('ide.skillSharing.issues.name-conflict');
  });

  it('shows blocked reasons but allows advisory tool dependencies', async () => {
    fetchMock.mockResolvedValueOnce(response([
      { ...skill, status: 'unsupported', issues: ['provider-hooks'] },
      { ...skill, id: 'source-2', name: 'portable', issues: ['tool-dependency'] },
    ]));
    await render();
    const actions = view!.root.findAllByType('button').filter((node) => node.children.includes('ide.skillSharing.shareAndUse'));
    expect(actions.map((node) => node.props.disabled)).toEqual([true, false]);
    expect(JSON.stringify(view!.toJSON())).toContain('ide.skillSharing.issues.provider-hooks');
    expect(JSON.stringify(view!.toJSON())).toContain('ide.skillSharing.issues.tool-dependency');
  });

  it('retains a retryable load failure instead of claiming the list is empty', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(response());
    await render();
    expect(JSON.stringify(view!.toJSON())).toContain('ide.skillSharing.loadFailed');
    expect(JSON.stringify(view!.toJSON())).not.toContain('ide.skillSharing.empty');
    await act(async () => button('retry').props.onClick());
    expect(button('shareAndUse').props.disabled).toBe(false);
  });

  it('does not insert on failed import and can retry the same row', async () => {
    fetchMock.mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response('', { status: 500 })).mockResolvedValueOnce(shared());
    await render();
    await act(async () => button('shareAndUse').props.onClick());
    expect(onUse).not.toHaveBeenCalled();
    expect(JSON.stringify(view!.toJSON())).toContain('ide.skillSharing.shareFailed');
    expect(button('shareAndUse').props.disabled).toBe(false);
    await act(async () => button('shareAndUse').props.onClick());
    expect(onUse).toHaveBeenCalledExactlyOnceWith('review');
  });

  it('does not insert if the active session changes before React rerenders', async () => {
    const pending = deferredResponse();
    fetchMock.mockResolvedValueOnce(response()).mockReturnValueOnce(pending.promise);
    await render();
    await act(async () => button('shareAndUse').props.onClick());
    fixture.pane.activeSessionId = 'session-b';
    await act(async () => pending.resolve(shared()));
    expect(onUse).not.toHaveBeenCalled();
    expect(onShared).not.toHaveBeenCalled();
  });

  it('does not apply a completed import to a switched agent', async () => {
    const pending = deferredResponse();
    fetchMock.mockResolvedValueOnce(response()).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response([]));
    await render();
    await act(async () => button('shareAndUse').props.onClick());
    fixture.pane = { agentId: 'agent-b', activeSessionId: 'session-b' };
    await act(async () => view!.update(element('session-b', 'agent-b')));
    await act(async () => pending.resolve(shared()));
    expect(onUse).not.toHaveBeenCalled();
    expect(onShared).not.toHaveBeenCalled();
    expect(JSON.stringify(view!.toJSON())).toContain('ide.skillSharing.empty');
  });

  it('does not insert if the agent engine changes before React rerenders', async () => {
    const pending = deferredResponse();
    fetchMock.mockResolvedValueOnce(response()).mockReturnValueOnce(pending.promise);
    await render();
    await act(async () => button('shareAndUse').props.onClick());
    fixture.provider = undefined;
    await act(async () => pending.resolve(shared()));
    expect(onUse).not.toHaveBeenCalled();
    expect(onShared).not.toHaveBeenCalled();
  });

  it('ignores a stale list response after an agent switch', async () => {
    const pending = deferredResponse();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response([]));
    await render();
    fixture.pane = { agentId: 'agent-b', activeSessionId: 'session-b' };
    await act(async () => view!.update(element('session-b', 'agent-b')));
    await act(async () => pending.resolve(response()));
    expect(JSON.stringify(view!.toJSON())).toContain('ide.skillSharing.empty');
    expect(JSON.stringify(view!.toJSON())).not.toContain('Review the project');
  });

  it('ignores an import completion after the skills pane closes', async () => {
    const pending = deferredResponse();
    fetchMock.mockResolvedValueOnce(response()).mockReturnValueOnce(pending.promise);
    await render();
    await act(async () => button('shareAndUse').props.onClick());
    await act(async () => view!.unmount());
    await act(async () => pending.resolve(shared()));
    expect(onUse).not.toHaveBeenCalled();
    expect(onShared).not.toHaveBeenCalled();
  });
});
