import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, BubbleData, OrchestraPreparation } from '@vibisual/shared';
import { agentSessionInputKey, useGraphStore, type AgentSessionInputAttachment } from './graphStore.js';

const agentId = 'agent-orchestra-prep';
const subId = 'sub-orchestra-prep';
const key = agentSessionInputKey(agentId, subId);
const attachment: AgentSessionInputAttachment = {
  tempId: 'reference', previewUrl: 'blob:reference', serverPath: '/uploads/reference.png', uploading: false,
};
const originalVersionCheck = useGraphStore.getState().ensureClaudeVersionChecked;
const originalRefreshSetup = useGraphStore.getState().refreshCodexSetup;
const originalRefreshAuth = useGraphStore.getState().refreshCodexAuth;

function rejection(preparation: OrchestraPreparation): Response {
  return new Response(JSON.stringify({ ok: false, error: 'orchestra-engine-not-ready', preparation }), { status: 409 });
}

beforeEach(() => {
  useGraphStore.setState({
    agents: [{ id: agentId, path: 'custom-orchestra', customCreated: true } as BubbleData],
    agentConfigs: { [agentId]: { provider: { kind: 'codex-cli', modelId: '' } } as AgentConfig },
    agentSessionInputs: { [key]: { text: 'Review these files', attachments: [attachment] } },
    attachmentPreviews: { 'reference.png': attachment.previewUrl },
    setupGateForced: false, loginGateForced: false, codexSetupGateForced: false, codexLoginGateForced: false,
    ensureClaudeVersionChecked: vi.fn(async () => {}),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useGraphStore.setState({
    ensureClaudeVersionChecked: originalVersionCheck,
    refreshCodexSetup: originalRefreshSetup,
    refreshCodexAuth: originalRefreshAuth,
  });
});

describe('자동 편성 준비 때문에 실행되지 않은 요청', () => {
  it('전송 직후 비운 입력과 첨부를 원 세션에 복원하고 필요한 다른 엔진의 설치 창만 연다', async () => {
    let respond!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve; })));
    const store = useGraphStore.getState();
    store.addCommand(agentId, 'Review these files', subId, [attachment.serverPath]);
    // 실제 IDE submit 과 같은 순서다: REST를 기다리는 동안 입력과 첨부를 비운다.
    store.clearAgentSessionInput(agentId, subId);
    respond(rejection({ engine: 'claude', action: 'setup' }));
    await vi.waitFor(() => expect(useGraphStore.getState().setupGateForced).toBe(true));
    const next = useGraphStore.getState();
    expect(next.agentSessionInputs[key]).toMatchObject({ text: 'Review these files', attachments: [attachment] });
    expect(next.agentSessionInputs[key]?.sendError).toBeTruthy();
    expect(next.attachmentPreviews['reference.png']).toBeUndefined(); // blob을 revoke하지 않고 draft가 다시 소유한다.
    expect(next.codexSetupGateForced).toBe(false);
    expect(next.loginGateForced).toBe(false);
    expect(next.ensureClaudeVersionChecked).not.toHaveBeenCalled();
  });

  it('응답을 기다리며 쓴 다음 입력·다른 세션 내용을 덮지 않고 로그인 안내 후 재전송할 수 있다', async () => {
    let respond!: (r: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { respond = resolve; }));
    vi.stubGlobal('fetch', fetcher);
    const store = useGraphStore.getState();
    store.addCommand(agentId, 'Review these files', subId, [attachment.serverPath]);
    store.clearAgentSessionInput(agentId, subId);
    store.setAgentSessionInputText(agentId, subId, 'Also check the tests');
    store.setAgentSessionInputText(agentId, 'other', 'Other session draft');
    respond(rejection({ engine: 'codex', action: 'login' }));
    await vi.waitFor(() => expect(useGraphStore.getState().codexLoginGateForced).toBe(true));
    expect(useGraphStore.getState().agentSessionInputs[key]?.text).toBe('Review these files\n\nAlso check the tests');
    expect(useGraphStore.getState().agentSessionInputs[agentSessionInputKey(agentId, 'other')]?.text).toBe('Other session draft');
    const restored = useGraphStore.getState().agentSessionInputs[key]!;
    useGraphStore.getState().addCommand(agentId, restored.text, subId, restored.attachments.map((a) => a.serverPath));
    useGraphStore.getState().clearAgentSessionInput(agentId, subId);
    respond(new Response(JSON.stringify({ ok: true, command: {} }), { status: 200 }));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(useGraphStore.getState().agentSessionInputs[key]).toBeUndefined();
  });

  it('판정 불가는 로그아웃으로 취급하지 않고 다시 확인한 실제 결과로 안내한다', async () => {
    useGraphStore.setState({
      refreshCodexSetup: vi.fn(async () => { useGraphStore.setState({ codexSetup: { phase: 'ready', canAutoInstall: true, installCommand: '', docsUrl: '', checkedAt: 1 } }); }),
      refreshCodexAuth: vi.fn(async () => {
        const auth = { loggedIn: false, checkedAt: 1 };
        useGraphStore.setState({ codexAuth: auth });
        return auth;
      }),
    });
    await useGraphStore.getState().prepareOrchestraEngine({ engine: 'codex', action: 'refresh' });
    expect(useGraphStore.getState().codexLoginGateForced).toBe(true);
    expect(useGraphStore.getState().codexSetupGateForced).toBe(false);
  });

  it('설치·로그인을 마친 뒤 다시 확인하면 오래된 입력 오류 때문에 준비 창을 다시 열지 않는다', async () => {
    useGraphStore.setState({
      refreshCodexSetup: vi.fn(async () => { useGraphStore.setState({ codexSetup: { phase: 'ready', canAutoInstall: true, installCommand: '', docsUrl: '', checkedAt: 2 } }); }),
      refreshCodexAuth: vi.fn(async () => {
        const auth = { loggedIn: true, checkedAt: 2 };
        useGraphStore.setState({ codexAuth: auth });
        return auth;
      }),
    });
    await useGraphStore.getState().prepareOrchestraEngine({ engine: 'codex', action: 'refresh' });
    expect(useGraphStore.getState().codexLoginGateForced).toBe(false);
    expect(useGraphStore.getState().codexSetupGateForced).toBe(false);
  });

  it('기다리는 동안 삭제한 에이전트의 입력이나 전역 준비 창을 되살리지 않는다', async () => {
    let respond!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve; })));
    useGraphStore.getState().addCommand(agentId, 'Review these files', subId);
    useGraphStore.setState({ agents: [], agentSessionInputs: {} });
    respond(rejection({ engine: 'claude', action: 'setup' }));
    // REST 본문 소비와 스토어 갱신을 모두 기다린다.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useGraphStore.getState().agentSessionInputs).toEqual({});
    expect(useGraphStore.getState().setupGateForced).toBe(false);
  });

  it('IDE draft를 쓰지 않는 명령 팝업에서 보낸 첨부도 파일 경로를 잃지 않는다', async () => {
    useGraphStore.setState({ agentSessionInputs: {} });
    vi.stubGlobal('fetch', vi.fn(async () => rejection({ engine: 'claude', action: 'setup' })));
    useGraphStore.getState().addCommand(agentId, 'Review popup image', subId, [attachment.serverPath]);
    await vi.waitFor(() => expect(useGraphStore.getState().setupGateForced).toBe(true));
    expect(useGraphStore.getState().agentSessionInputs[key]?.attachments).toEqual([
      expect.objectContaining({ serverPath: attachment.serverPath, uploading: false }),
    ]);
  });
});
