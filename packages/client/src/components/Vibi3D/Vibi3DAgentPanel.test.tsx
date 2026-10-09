import type { FormEvent } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BubbleData, QueuedCommand, Vibi3DSnapshot } from '@vibisual/shared';
import { Vibi3DAgentPanel, type Vibi3DAgentPanelProps } from './Vibi3DAgentPanel.js';

const fixture = vi.hoisted(() => ({ addCommand: vi.fn(), webSocket: vi.fn() }));
const state = {
  agents: [] as BubbleData[], agentProjects: {} as Record<string, string>,
  projects: { Project: { name: 'Project', path: '/project' } },
  connectionStatus: 'connected', queuedCommands: {} as Record<string, QueuedCommand[]>,
  completedCommands: {} as Record<string, QueuedCommand[]>,
  agentSessionInputs: {} as Record<string, { text: string; sendFailure?: string }>, addCommand: fixture.addCommand,
};
vi.mock('../../stores/graphStore.js', () => ({ useGraphStore: Object.assign(
  (select: (value: typeof state) => unknown) => select(state), { getState: () => state },
), agentSessionInputKey: (id: string) => `${id}|__new__` }));
vi.mock('../../hooks/useWebSocket.js', () => ({ useWebSocket: fixture.webSocket }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }));

let renderer: ReactTestRenderer | undefined;
let props: Vibi3DAgentPanelProps;
const snapshot: Vibi3DSnapshot = { sessionId: 'scene-1', projectId: '/project', fileName: 'chair.glb', revision: 0, selectedId: null, nodes: [] };
const text = (): string => JSON.stringify(renderer?.toJSON());
const submit = async (): Promise<void> => {
  await act(async () => { renderer!.root.findByType('input').props.onChange({ target: { value: 'Make it blue' } }); });
  await act(async () => { renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} } as FormEvent); });
};
beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubGlobal('window', { location: { hash: '', protocol: 'http:', host: 'localhost:9000' } });
  state.agents = [{ id: 'agent-1', label: 'Scene editor', path: 'session-a', bubbleType: 'agent', status: 'idle', activity: 0, customCreated: true }];
  state.agentProjects = { 'agent-1': 'Project' }; state.connectionStatus = 'connected';
  state.queuedCommands = {}; state.completedCommands = {}; state.agentSessionInputs = {};
  props = { projectId: '/project', snapshot, connected: true, onBeforeSend: vi.fn().mockResolvedValue(undefined) };
  await act(async () => { renderer = create(<Vibi3DAgentPanel {...props} />); });
});
afterEach(async () => { await act(async () => { renderer?.unmount(); }); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Vibi3D existing-agent request panel', () => {
  it('refreshes the scene first and only reports acceptance after the server queue confirms it', async () => {
    await submit();
    expect(props.onBeforeSend).toHaveBeenCalledTimes(1);
    expect(fixture.addCommand).toHaveBeenCalledWith('agent-1', expect.stringContaining('Make it blue'), null);
    expect(text()).toContain('Sending request');
    expect(text()).not.toContain('Request accepted');
    const prompt = fixture.addCommand.mock.calls[0]![1] as string;
    state.queuedCommands = { 'agent-1': [{ id: 'queued', text: prompt, timestamp: Date.now(), subAgentId: null, status: 'queued' }] };
    await act(async () => { renderer!.update(<Vibi3DAgentPanel {...props} />); });
    expect(text()).toContain('Request accepted');
    expect(fixture.webSocket).not.toHaveBeenCalled();
  });

  it('keeps user input and exposes rejection from the existing dispatch path', async () => {
    await submit();
    state.agentSessionInputs = { 'agent-1|__new__': { text: fixture.addCommand.mock.calls[0]![1] as string, sendFailure: 'rejected' } };
    await act(async () => { renderer!.update(<Vibi3DAgentPanel {...props} />); });
    expect(text()).toContain('Request delivery could not be confirmed');
    expect(renderer!.root.findByType('input').props.value).toBe('Make it blue');
    expect(renderer!.root.findByProps({ role: 'alert' })).toBeDefined();
  });

  it('does not dispatch when refreshing the live scene fails', async () => {
    props.onBeforeSend = vi.fn().mockRejectedValue(new Error('Scene disconnected'));
    await act(async () => { renderer!.update(<Vibi3DAgentPanel {...props} />); });
    await submit();
    expect(fixture.addCommand).not.toHaveBeenCalled();
    expect(text()).toContain('Scene disconnected');
  });

  it('does not send an old request to a newly loaded model', async () => {
    let finish: (() => void) | undefined;
    props.onBeforeSend = () => new Promise<void>((resolve) => { finish = resolve; });
    await act(async () => { renderer!.update(<Vibi3DAgentPanel {...props} />); });
    await submit();
    props = { ...props, snapshot: { ...snapshot, sessionId: 'scene-2' } };
    await act(async () => { renderer!.update(<Vibi3DAgentPanel {...props} />); finish?.(); });
    expect(fixture.addCommand).not.toHaveBeenCalled();
    expect(text()).toContain('The scene changed');
  });

  it('opens a graph connection only for the standalone Vibi3D app window', async () => {
    vi.stubGlobal('window', { location: { hash: '#app=vibi3d&projectId=%2Fproject', protocol: 'http:', host: 'localhost:9000' } });
    await act(async () => { renderer!.update(<Vibi3DAgentPanel {...props} />); });
    expect(fixture.webSocket).toHaveBeenCalledTimes(1);
    expect(fixture.webSocket).toHaveBeenCalledWith(expect.stringMatching(/^ws:\/\/localhost:9000/));
  });
});
