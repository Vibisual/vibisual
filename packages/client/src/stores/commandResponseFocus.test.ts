import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, BubbleData } from '@vibisual/shared';
import { useGraphStore } from './graphStore.js';

const AGENT = 'command-agent';
const originalAck = useGraphStore.getState().acknowledgeUsageLimit;
const ack = vi.fn();
const fetchMock = vi.fn<typeof fetch>();
let pane: string;
function response(sid: string): Response { return new Response(JSON.stringify({ command: { subAgentId: sid } })); }
function deferred(): { promise: Promise<Response>; resolve: (sid: string) => void } {
  let done!: (value: Response) => void;
  return { promise: new Promise((resolve) => { done = resolve; }), resolve: (sid) => done(response(sid)) };
}
function active(): string | null | undefined { return useGraphStore.getState().ideOverlays[pane]?.activeSessionId; }
beforeEach(() => {
  fetchMock.mockReset();
  ack.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  useGraphStore.setState({
    agents: [{ id: AGENT, path: 'custom-command-agent', customCreated: true } as BubbleData],
    agentConfigs: { [AGENT]: { provider: { kind: 'codex-cli', modelId: '' } } as AgentConfig },
    activeProject: 'command-project', ideOverlays: {}, subAgents: {}, acknowledgeUsageLimit: ack,
  });
  useGraphStore.getState().openIDEOverlay(AGENT);
  pane = Object.keys(useGraphStore.getState().ideOverlays)[0]!;
  useGraphStore.getState().setIDEActiveSession('session-a', pane);
  ack.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  useGraphStore.setState({ acknowledgeUsageLimit: originalAck });
});

describe('a command response must not take focus back from a newer user action', () => {
  it('sending in A then choosing B leaves B selected when A responds', async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    useGraphStore.getState().addCommand(AGENT, 'work in A', 'session-a');
    useGraphStore.getState().setIDEActiveSession('session-b', pane);
    ack.mockClear();
    pending.resolve('session-a');
    await vi.waitFor(() => expect(ack).toHaveBeenCalledWith({ subAgentIds: ['session-a'] }));
    expect(active()).toBe('session-b');
  });

  it('out-of-order responses to two main-tab sends cannot replace the newer assigned session', async () => {
    const first = deferred();
    const second = deferred();
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    useGraphStore.getState().setIDEActiveSession(null, pane);
    useGraphStore.getState().addCommand(AGENT, 'first');
    useGraphStore.getState().addCommand(AGENT, 'second');
    second.resolve('newer-session');
    await vi.waitFor(() => expect(active()).toBe('newer-session'));
    first.resolve('older-session');
    await vi.waitFor(() => expect(ack).toHaveBeenCalledWith({ subAgentIds: ['older-session'] }));
    expect(active()).toBe('newer-session');
  });

  it('a successful response still selects its assigned session when the source pane is unchanged', async () => {
    fetchMock.mockResolvedValueOnce(response('assigned-session'));
    useGraphStore.getState().setIDEActiveSession(null, pane);
    useGraphStore.getState().addCommand(AGENT, 'new work');
    await vi.waitFor(() => expect(active()).toBe('assigned-session'));
  });

  it('a pane opened after sending is not owned by that old request', async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    useGraphStore.setState({ ideOverlays: {} });
    useGraphStore.getState().addCommand(AGENT, 'sent from command center', 'session-a');
    useGraphStore.getState().openIDEOverlay(AGENT);
    pane = Object.keys(useGraphStore.getState().ideOverlays)[0]!;
    useGraphStore.getState().setIDEActiveSession('session-b', pane);
    ack.mockClear();
    pending.resolve('session-a');
    await vi.waitFor(() => expect(ack).toHaveBeenCalledWith({ subAgentIds: ['session-a'] }));
    expect(active()).toBe('session-b');
  });
});
