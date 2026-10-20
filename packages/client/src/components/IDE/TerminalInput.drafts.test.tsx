import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import { agentSessionInputKey, useGraphStore, type AgentSessionInputAttachment } from '../../stores/graphStore.js';
import { TerminalInput } from './IDEMainArea.js';

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../../hooks/useSessionRunning.js', () => ({ useSessionRunning: () => false }));
vi.mock('../../hooks/useSessionStop.js', () => ({
  useSessionStop: () => ({ stopping: false, stop: vi.fn(), outcome: { kind: 'idle' }, clearOutcome: vi.fn(), forceStop: vi.fn() }),
}));
vi.mock('../../hooks/useAvailableSkills.js', () => ({
  useAvailableSkills: () => ({ skills: [], builtins: [], loaded: true, slashCommandsEnabled: true }),
}));
vi.mock('../../hooks/useVoiceDictation.js', () => ({
  useVoiceDictation: () => ({ status: 'idle', error: null, interim: '', analyserRef: { current: null }, toggle: vi.fn(), stop: vi.fn(), dismissError: vi.fn() }),
}));
vi.mock('../../hooks/useVoiceAsr.js', () => ({ useVoiceAsr: () => ({ state: null }) }));
vi.mock('../../hooks/useMicSettings.js', () => ({ useMicSettings: () => ({ openable: false }) }));
vi.mock('./VoiceInputOverlay.js', () => ({ VoiceInputOverlay: () => null }));
vi.mock('./VoiceInstallDialog.js', () => ({ VoiceInstallDialog: () => null }));
vi.mock('./MicSettingsPopup.js', () => ({ MicSettingsPopup: () => null }));
// The input is tested directly; terminal/stream/canvas siblings must not create browser services.
vi.mock('./IDETerminalPanes.js', () => ({ IDETerminalPanes: () => null }));
vi.mock('./StreamRenderer.js', () => ({ StreamRenderer: () => null, StreamEndGap: () => null }));
vi.mock('./ImageAnnotator.js', () => ({ ImageLightboxView: () => null }));

const agentId = 'agent-draft-lifecycle';
const sessionId = 'session-draft-lifecycle';
const otherSessionId = 'session-other';
const otherAgentId = 'agent-other';
const key = agentSessionInputKey(agentId, sessionId);
const otherKey = agentSessionInputKey(agentId, otherSessionId);
const otherAgentKey = agentSessionInputKey(otherAgentId, sessionId);
const image: AgentSessionInputAttachment = {
  tempId: 'ready-image', previewUrl: 'blob:ready-image',
  serverPath: 'C:/project/.vibisual/attachments/custom-draft/image.png', uploading: false,
};
const originalAddCommand = useGraphStore.getState().addCommand;
const send = vi.fn();
const fetcher = vi.fn<typeof fetch>();
let view: ReactTestRenderer | undefined;
let field: HTMLTextAreaElement;

beforeEach(() => {
  fetcher.mockReset().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  send.mockReset();
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pasted-image');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  useGraphStore.setState({
    agents: [
      { id: agentId, path: 'custom-draft' } as BubbleData,
      { id: otherAgentId, path: 'custom-other' } as BubbleData,
    ],
    agentSessionInputs: {}, agentInputDrafts: {}, attachmentPreviews: {},
    agentConfigs: {}, agentProjects: {}, completedCommands: {}, queuedCommands: {},
    ideOverlays: {}, addCommand: send,
  });
});

afterEach(async () => {
  await act(async () => { view?.unmount(); });
  view = undefined;
  useGraphStore.setState({ addCommand: originalAddCommand });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(agent = agentId, session: string | null = sessionId): Promise<void> {
  await act(async () => {
    view = create(createElement(TerminalInput, { agentId: agent, activeSessionId: session }), {
      createNodeMock: (element) => {
        if (element.type !== 'textarea') return null;
        field = {
          value: element.props.value, isConnected: true, selectionStart: 0, selectionEnd: 0,
          style: {}, scrollHeight: 28,
          ownerDocument: { activeElement: null, defaultView: { requestAnimationFrame: vi.fn() } },
        } as unknown as HTMLTextAreaElement;
        return field;
      },
    });
  });
}

async function leave(): Promise<void> {
  await act(async () => { view!.unmount(); });
  view = undefined;
}

function input(): ReactTestInstance { return view!.root.findByType('textarea'); }
function run(): ReactTestInstance {
  return view!.root.findAllByType('button').find((button) => button.children.includes('ide.mainArea.run'))!;
}
function draft() { return useGraphStore.getState().agentSessionInputs[key]; }
function seed(): void {
  useGraphStore.setState({ agentSessionInputs: {
    [key]: { text: 'Inspect this image', attachments: [image] },
    [otherKey]: { text: 'Other session', attachments: [{ ...image, tempId: 'other-session-image' }] },
    [otherAgentKey]: { text: 'Other project', attachments: [{ ...image, tempId: 'other-agent-image' }] },
  } });
}

async function paste(): Promise<void> {
  const file = new File(['image bytes'], 'pasted.png', { type: 'image/png' });
  await act(async () => {
    input().props.onPaste({
      currentTarget: field, preventDefault: vi.fn(),
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] },
    });
  });
}

describe('TerminalInput draft image ownership', () => {
  it('retains text and images when the pane disappears and is opened again', async () => {
    seed();
    await render();
    expect(view!.root.findByType('img').props.src).toBe(image.previewUrl);
    // No overlay slot remains after closing/replacing a pane; this was the destructive cleanup path.
    expect(useGraphStore.getState().ideOverlays).toEqual({});
    await leave();
    expect(draft()).toEqual({ text: 'Inspect this image', attachments: [image] });
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    await render();
    expect(input().props.value).toBe('Inspect this image');
    expect(view!.root.findByType('img').props.src).toBe(image.previewUrl);
  });

  it('keeps each session and agent image separate while navigating and remounting', async () => {
    seed();
    await render();
    await act(async () => { view!.update(createElement(TerminalInput, { agentId, activeSessionId: otherSessionId })); });
    expect(input().props.value).toBe('Other session');
    await leave();
    await render(otherAgentId);
    expect(input().props.value).toBe('Other project');
    await leave();
    await render();
    expect(input().props.value).toBe('Inspect this image');
    expect(draft()?.attachments).toEqual([image]);
    expect(useGraphStore.getState().agentSessionInputs[otherKey]?.attachments[0]?.tempId).toBe('other-session-image');
    expect(useGraphStore.getState().agentSessionInputs[otherAgentKey]?.attachments[0]?.tempId).toBe('other-agent-image');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('fetches a hydrated image preview again after remount and submits its persisted path', async () => {
    const recovered = { ...image, previewUrl: '' };
    useGraphStore.setState({ agentSessionInputs: {
      [key]: { text: 'Recovered image', attachments: [recovered] },
    } });
    fetcher.mockImplementation(async () => new Response(new Blob(['image bytes'], { type: 'image/png' })));
    vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:recovered-first').mockReturnValueOnce('blob:recovered-remount');
    await render();
    expect(fetcher).toHaveBeenCalledWith('/api/agent-attachments/custom-draft/file?rel=image.png');
    expect(view!.root.findByType('img').props.src).toBe('blob:recovered-first');
    await leave();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:recovered-first');
    expect(draft()?.attachments).toEqual([recovered]);
    await render();
    expect(view!.root.findByType('img').props.src).toBe('blob:recovered-remount');
    await act(async () => { run().props.onClick(); });
    expect(send).toHaveBeenCalledExactlyOnceWith(agentId, 'Recovered image', sessionId, [image.serverPath]);
    expect(draft()).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([, options]) => options?.method !== 'DELETE')).toBe(true);
  });

  it('recovers the preview after switching away and back while its first fetch is pending', async () => {
    useGraphStore.setState({ agentSessionInputs: {
      [key]: { text: 'Recovered image', attachments: [{ ...image, previewUrl: '' }] },
    } });
    let resolveFirst!: (response: Response) => void;
    fetcher.mockReturnValueOnce(new Promise<Response>((done) => { resolveFirst = done; }));
    fetcher.mockImplementation(async () => new Response(new Blob(['image bytes'], { type: 'image/png' })));
    vi.mocked(URL.createObjectURL).mockReturnValue('blob:recovered-after-switch');
    await render();
    expect(view!.root.findByType('img').props.src).toBeUndefined();
    await act(async () => { view!.update(createElement(TerminalInput, { agentId, activeSessionId: otherSessionId })); });
    await act(async () => { view!.update(createElement(TerminalInput, { agentId, activeSessionId: sessionId })); });
    await act(async () => { resolveFirst(new Response(new Blob(['stale image bytes'], { type: 'image/png' }))); });
    expect(view!.root.findByType('img').props.src).toBe('blob:recovered-after-switch');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(draft()?.attachments[0]?.serverPath).toBe(image.serverPath);
    expect(run().props.disabled).toBe(false);
  });

  it('finishes a pending paste in its original draft after the input unmounts', async () => {
    let resolve!: (response: Response) => void;
    fetcher.mockReturnValueOnce(new Promise<Response>((done) => { resolve = done; }));
    useGraphStore.getState().setAgentSessionInputText(agentId, sessionId, 'Pending image');
    await render();
    await paste();
    expect(draft()?.attachments[0]).toMatchObject({ uploading: true, previewUrl: 'blob:pasted-image' });
    await leave();
    await render(otherAgentId);
    await act(async () => { resolve(new Response(JSON.stringify({ path: image.serverPath }))); });
    expect(draft()?.attachments[0]).toMatchObject({ uploading: false, serverPath: image.serverPath });
    expect(useGraphStore.getState().agentSessionInputs[otherAgentKey]).toBeUndefined();
    await leave();
    await render();
    expect(view!.root.findByType('img').props.src).toBe('blob:pasted-image');
    expect(run().props.disabled).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('still removes the chosen image explicitly without changing other drafts', async () => {
    seed();
    await render();
    const remove = view!.root.findByProps({ 'aria-label': 'panel.commandQueue.removeAttachment' });
    await act(async () => { remove.props.onClick(); });
    expect(draft()).toEqual({ text: 'Inspect this image', attachments: [] });
    expect(useGraphStore.getState().agentSessionInputs[otherKey]?.attachments).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(image.previewUrl);
    expect(fetcher).toHaveBeenCalledWith('/api/agent-attachments/custom-draft', expect.objectContaining({
      method: 'DELETE', body: JSON.stringify({ filePath: image.serverPath }),
    }));
  });

  it('submits the retained image once and clears only the submitted session', async () => {
    seed();
    await render();
    await leave();
    await render();
    await act(async () => { run().props.onClick(); });
    expect(send).toHaveBeenCalledExactlyOnceWith(agentId, 'Inspect this image', sessionId, [image.serverPath]);
    expect(draft()).toBeUndefined();
    expect(useGraphStore.getState().agentSessionInputs[otherKey]?.attachments).toHaveLength(1);
    expect(useGraphStore.getState().attachmentPreviews['image.png']).toBe(image.previewUrl);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
