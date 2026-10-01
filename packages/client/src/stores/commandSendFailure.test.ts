import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, BubbleData, SubAgent } from '@vibisual/shared';
import { agentSessionInputKey, useGraphStore, type AgentSessionInputAttachment } from './graphStore.js';

const agentId = 'agent-send-failure';
const subId = 'sub-send-failure';
const key = agentSessionInputKey(agentId, subId);
const prompt = 'Review the attached image';
const image: AgentSessionInputAttachment = {
  tempId: 'image', previewUrl: 'blob:send-failure', serverPath: '/uploads/image.png', uploading: false,
};
const originalVersionCheck = useGraphStore.getState().ensureClaudeVersionChecked;
const fetcher = vi.fn<typeof fetch>();

beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
  useGraphStore.setState({
    agents: [{ id: agentId, path: 'custom-send-failure', customCreated: true } as BubbleData],
    agentConfigs: { [agentId]: { provider: { kind: 'codex-cli', modelId: '' } } as AgentConfig },
    subAgents: { [agentId]: [{ id: subId, parentAgentId: agentId } as SubAgent] },
    agentSessionInputs: { [key]: { text: prompt, attachments: [image] } },
    attachmentPreviews: { 'image.png': image.previewUrl },
    queuedCommands: {}, completedCommands: {}, ideOverlays: {},
    ensureClaudeVersionChecked: vi.fn(async () => {}),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useGraphStore.setState({ ensureClaudeVersionChecked: originalVersionCheck });
});
function submit(): void {
  const store = useGraphStore.getState();
  store.addCommand(agentId, prompt, subId, [image.serverPath]);
  store.clearAgentSessionInput(agentId, subId);
}
function pending(): (response: Response) => void {
  let respond!: (response: Response) => void;
  fetcher.mockReturnValueOnce(new Promise<Response>((resolve) => { respond = resolve; }));
  return respond;
}
function failure(status = 500, error = 'server-error'): Response {
  return new Response(JSON.stringify({ error }), { status });
}

describe('failed sends retain the original session draft without retrying a possibly accepted command', () => {
  for (const provider of ['claude', 'codex-cli', 'local-llama'] as const) {
    it.each(['network', 'sync-throw', 'http', 'bad-json', 'bad-success'])(`${provider}: %s restores text and images`, async (kind) => {
      useGraphStore.setState({ agentConfigs: { [agentId]: {
        ...(provider === 'claude' ? {} : { provider: { kind: provider, modelId: 'fixture' } }),
      } as AgentConfig } });
      if (kind === 'network') fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      else if (kind === 'sync-throw') fetcher.mockImplementationOnce(() => { throw new Error('transport disconnected'); });
      else if (kind === 'http') fetcher.mockResolvedValueOnce(failure());
      else if (kind === 'bad-json') fetcher.mockResolvedValueOnce(new Response('<html>unavailable</html>'));
      else fetcher.mockResolvedValueOnce(new Response('null'));
      submit();
      await vi.waitFor(() => expect(useGraphStore.getState().agentSessionInputs[key]?.sendFailure).toBeTruthy());
      expect(useGraphStore.getState().agentSessionInputs[key]).toMatchObject({ text: prompt, attachments: [image] });
      expect(useGraphStore.getState().attachmentPreviews['image.png']).toBeUndefined();
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  }

  it('a late refusal preserves new text and another session, without duplicating attachments', async () => {
    const respond = pending();
    submit();
    useGraphStore.getState().setAgentSessionInputText(agentId, subId, 'And review tests');
    useGraphStore.getState().updateAgentSessionInputAttachments(agentId, subId, () => [image]);
    useGraphStore.getState().setAgentSessionInputText(agentId, 'other', 'Unrelated draft');
    respond(failure(403));
    await vi.waitFor(() => expect(useGraphStore.getState().agentSessionInputs[key]?.sendFailure).toBe('rejected'));
    expect(useGraphStore.getState().agentSessionInputs[key]).toMatchObject({ text: `${prompt}\n\nAnd review tests`, attachments: [image] });
    expect(useGraphStore.getState().agentSessionInputs[agentSessionInputKey(agentId, 'other')]?.text).toBe('Unrelated draft');
  });

  it.each(['agent', 'session'])('does not resurrect a deleted %s after a failed response', async (removed) => {
    const respond = pending();
    submit();
    useGraphStore.setState(removed === 'agent' ? { agents: [] } : { subAgents: {} });
    respond(failure());
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(useGraphStore.getState().agentSessionInputs[key]).toBeUndefined();
  });

  it('uses a specific actionable message when the local provider refuses images', async () => {
    fetcher.mockResolvedValueOnce(failure(415, 'local-images-unsupported'));
    submit();
    await vi.waitFor(() => expect(useGraphStore.getState().agentSessionInputs[key]?.sendFailure).toBe('local-images-unsupported'));
    expect(useGraphStore.getState().agentSessionInputs[key]?.attachments).toEqual([image]);
  });

  it('a snapshot received before refusal does not revoke the in-flight image', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const respond = pending();
    submit();
    const s = useGraphStore.getState();
    s.loadSnapshot({}, s.agents, [], {}, [], {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, s.subAgents,
      s.agentPhase, 0, {}, {}, {}, s.agentConfigs, {}, {}, {}, [], [], {}, {}, {});
    expect(revoke).not.toHaveBeenCalledWith(image.previewUrl);
    respond(failure());
    await vi.waitFor(() => expect(useGraphStore.getState().agentSessionInputs[key]?.sendFailure).toBeTruthy());
    expect(useGraphStore.getState().agentSessionInputs[key]?.attachments[0]?.previewUrl).toBe(image.previewUrl);
  });

  it('a successful send leaves the draft cleared and does not manufacture a retry', async () => {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, command: {} })));
    submit();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(useGraphStore.getState().agentSessionInputs[key]).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
