import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioDoc } from '@vibisual/audio';
import type { BubbleData } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { useAudioDelegate } from './useAudioDelegate.js';

vi.mock('../../stores/graphStore.js', async () => {
  const { create: makeStore } = await import('zustand');
  return { useGraphStore: makeStore(() => ({})), agentSessionInputKey: (id: string): string => `${id}|__new__` };
});
vi.mock('../../utils/platform.js', () => ({ clientPathPlatform: (): string => 'linux', sameClientPath: (a: string, b: string): boolean => a === b }));

let view: ReactTestRenderer | undefined;
let delegate: ReturnType<typeof useAudioDelegate>;
const addCommand = vi.fn();
const openIDEOverlay = vi.fn();
const doc: AudioDoc = { schemaVersion: 1, id: 'sound', title: 'Sound', version: 0,
  sampleRate: 48000, channels: 2, assets: {}, tracks: [], createdAt: 1, updatedAt: 1 };
function Probe({ project = '/project' }: { project?: string }): null {
  delegate = useAudioDelegate({ projectId: project, doc, selectedClipId: null, selection: null });
  return null;
}
async function render(project?: string): Promise<void> {
  await act(async () => { view = create(<Probe project={project} />); });
  act(() => delegate.setRequest('Make the mix quieter'));
}
beforeEach(() => {
  addCommand.mockReset(); openIDEOverlay.mockReset();
  useGraphStore.setState({ agents: [{ id: 'agent', path: 'session', label: 'Agent', bubbleType: 'agent', customCreated: true } as BubbleData],
    agentProjects: { agent: '/project' }, agentConfigs: {}, activeProject: '/project',
    queuedCommands: {}, completedCommands: {}, agentSessionInputs: {}, addCommand, openIDEOverlay });
});
afterEach(async () => { await act(async () => view?.unmount()); view = undefined; });

describe('Vibisound agent queue integration', () => {
  it('shows queue acceptance only after the server snapshot and suppresses duplicate submits', async () => {
    await render();
    act(() => { delegate.send(); delegate.send(); });
    expect(addCommand).toHaveBeenCalledTimes(1);
    expect(delegate.status).toBe('submitting');
    const text = String(addCommand.mock.calls[0]?.[1]);
    expect(openIDEOverlay).toHaveBeenCalledWith('agent', { focus: { sessionId: null } });
    act(() => useGraphStore.setState({ queuedCommands: { agent: [{ id: 'command', text, timestamp: 1, subAgentId: null, status: 'queued' }] } }));
    expect(delegate.status).toBe('queued');
  });
  it('does not offer or send to agents from another project', async () => {
    await render('/other');
    expect(delegate.targets).toEqual([]);
    act(() => delegate.send());
    expect(addCommand).not.toHaveBeenCalled();
  });
  it('retains a visible failure and does not focus an IDE in a different active project', async () => {
    useGraphStore.setState({ activeProject: '/different-tab' });
    await render();
    act(() => delegate.send());
    expect(openIDEOverlay).not.toHaveBeenCalled();
    const text = String(addCommand.mock.calls[0]?.[1]);
    act(() => useGraphStore.setState({ agentSessionInputs: { 'agent|__new__': { text, attachments: [], sendFailure: 'rejected' } } }));
    expect(delegate.status).toBe('sendFailed');
  });
});
