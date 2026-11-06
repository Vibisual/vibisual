import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BubbleData, ClaudeAuthStatus, ClaudeSetupState } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

/**
 * §5.25 (C) — 기본 엔진이 로컬·코덱스여도 클로드 버블을 열면 클로드의 설치·로그인을 그때 판정한다.
 * 판정 불명은 막지 않고, 준비가 끝나면 열려던 버블로 돌아간다.
 */

const PROJ = 'proj';
const A = 'claude-a';
const B = 'claude-b';

const setup = (phase: ClaudeSetupState['phase']): ClaudeSetupState => ({
  phase, canAutoInstall: true, installCommand: 'install', docsUrl: '', checkedAt: 1,
});
const loggedIn: ClaudeAuthStatus = { loggedIn: true, checkedAt: 1 };
const loggedOut: ClaudeAuthStatus = { loggedIn: false, checkedAt: 1 };

function agent(id: string, customCreated = true): BubbleData {
  return { id, label: id, bubbleType: 'agent', path: id, status: 'idle', activity: 0, customCreated };
}

function openAgents(): string[] {
  return Object.values(useGraphStore.getState().ideOverlays).map((o) => o.agentId ?? '');
}

beforeEach(() => {
  useGraphStore.setState({
    activeProject: PROJ,
    nodeMap: { [A]: agent(A), [B]: agent(B), hook: agent('hook', false) },
    agents: [],
    ideOverlays: {}, closedIDEEditorTabs: [], idePaneSeq: 0,
    subAgents: {}, agentConfigs: {}, selectedSubByAgent: {}, defaultSubAgents: {}, overlayWindows: [],
    userDefaults: { engineChoice: { kind: 'local', chosenAt: 1 }, updatedAt: 1 },
    claudeSetup: setup('missing'), claudeAuth: loggedOut,
    setupGateForced: false, setupGateDismissed: true, loginGateForced: false, loginGateDismissed: true,
    claudeEntryAgentId: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('클로드 버블 진입 준비', () => {
  it('미설치면 IDE 대신 설치 창을 열고 버블을 기억한다', () => {
    useGraphStore.getState().openIDEOverlay(A);
    const s = useGraphStore.getState();
    expect(openAgents()).toEqual([]);
    expect(s.setupGateForced).toBe(true);
    expect(s.setupGateDismissed).toBe(false);
    expect(s.loginGateForced).toBe(false);
    expect(s.claudeEntryAgentId).toBe(A);
  });

  it('설치돼 있고 로그아웃이면 로그인 창을 연다', () => {
    useGraphStore.setState({ claudeSetup: setup('ready') });
    useGraphStore.getState().openIDEOverlay(A);
    const s = useGraphStore.getState();
    expect(openAgents()).toEqual([]);
    expect(s.loginGateForced).toBe(true);
    expect(s.loginGateDismissed).toBe(false);
    expect(s.setupGateForced).toBe(false);
    expect(s.claudeEntryAgentId).toBe(A);
  });

  it('인증 판정 불명은 로그아웃이 아니라 IDE 를 연다', () => {
    useGraphStore.setState({ claudeSetup: setup('ready'), claudeAuth: { loggedIn: false, error: 'timeout', checkedAt: 1 } });
    useGraphStore.getState().openIDEOverlay(A);
    expect(openAgents()).toEqual([A]);
    expect(useGraphStore.getState().loginGateForced).toBe(false);
  });

  it('설치 판정 전이면 막지 않는다', () => {
    useGraphStore.setState({ claudeSetup: null, claudeAuth: null });
    useGraphStore.getState().openIDEOverlay(A);
    expect(openAgents()).toEqual([A]);
  });

  it('앱이 돌리지 않는 훅 버블은 막지 않는다', () => {
    useGraphStore.getState().openIDEOverlay('hook');
    expect(openAgents()).toEqual(['hook']);
    expect(useGraphStore.getState().setupGateForced).toBe(false);
  });

  it('창 이동(되돌아오기)은 진입이 아니라 막지 않는다', () => {
    useGraphStore.getState().openIDEOverlay(A, { pane: 'new', redock: true });
    expect(openAgents()).toEqual([A]);
  });

  it('설치·로그인 창이 없는 별창에서는 막지 않는다', () => {
    vi.stubGlobal('window', { location: { hash: '#detached=1&kind=project&tabKey=proj' } });
    useGraphStore.getState().openIDEOverlay(A);
    expect(openAgents()).toEqual([A]);
    expect(useGraphStore.getState().setupGateForced).toBe(false);
  });

  it('준비가 끝나면 열려던 버블로 돌아가고 기억을 지운다', () => {
    useGraphStore.getState().openIDEOverlay(A);
    useGraphStore.setState({ claudeSetup: setup('ready'), claudeAuth: loggedIn });
    useGraphStore.getState().resumeClaudeEntry();
    expect(openAgents()).toEqual([A]);
    expect(useGraphStore.getState().claudeEntryAgentId).toBeNull();
    // 두 번째 인계(타이머·[계속] 겹침)는 아무것도 하지 않는다.
    useGraphStore.getState().resumeClaudeEntry();
    expect(openAgents()).toEqual([A]);
  });

  it('마지막으로 연 버블로 돌아간다', () => {
    useGraphStore.setState({ claudeSetup: setup('ready') });
    useGraphStore.getState().openIDEOverlay(A);
    useGraphStore.getState().openIDEOverlay(B);
    useGraphStore.setState({ claudeAuth: loggedIn });
    useGraphStore.getState().resumeClaudeEntry();
    expect(openAgents()).toEqual([B]);
  });

  it.each(['setup', 'login'] as const)('%s 창을 [나중에]로 닫으면 돌아가지 않는다', (gate) => {
    useGraphStore.getState().openIDEOverlay(A);
    if (gate === 'setup') useGraphStore.getState().setSetupGate({ forced: false, dismissed: true });
    else useGraphStore.getState().setLoginGate({ forced: false, dismissed: true });
    useGraphStore.setState({ claudeSetup: setup('ready'), claudeAuth: loggedIn });
    useGraphStore.getState().resumeClaudeEntry();
    expect(openAgents()).toEqual([]);
  });

  it('기다리는 사이 버블이 지워졌으면 아무것도 열지 않는다', () => {
    useGraphStore.getState().openIDEOverlay(A);
    useGraphStore.setState({ nodeMap: {}, agents: [], claudeSetup: setup('ready'), claudeAuth: loggedIn });
    useGraphStore.getState().resumeClaudeEntry();
    expect(openAgents()).toEqual([]);
    expect(useGraphStore.getState().claudeEntryAgentId).toBeNull();
  });

  it('준비된 클로드는 기본 엔진과 무관하게 바로 연다', () => {
    useGraphStore.setState({ claudeSetup: setup('ready'), claudeAuth: loggedIn });
    useGraphStore.getState().openIDEOverlay(A);
    expect(openAgents()).toEqual([A]);
    expect(useGraphStore.getState().claudeEntryAgentId).toBeNull();
  });
});
