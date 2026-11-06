import { createElement, Fragment, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAUDE_SETUP_READY_HOLD_MS, type ClaudeSetupState, type CodexSetupState } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { CodexSetupGate } from '../Codex/CodexSetupGate.js';
import { ClaudeSetupGate } from './ClaudeSetupGate.js';

vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../Layout/LanguageSwitcher.js', () => ({ LanguageSwitcher: () => null }));
vi.mock('../../hooks/usePopupDismiss.js', () => ({ useBackdropDismiss: () => ({}) }));
vi.mock('../../stores/onboardingGates.js', () => ({ useOnboardingGate: () => undefined }));
vi.mock('../../stores/graphStore.js', async () => {
  const { create: makeStore } = await import('zustand');
  return { useGraphStore: makeStore(() => ({})) };
});

/** §5.25 (C)·§4 — 이미 설치된 Claude 를 첫 엔진으로 고르면 "계속하는 중"에서 멈추지 않고 로그인·폴더로 한 번만 넘어간다. */

const ready: ClaudeSetupState = {
  phase: 'ready', canAutoInstall: true, installCommand: 'install claude', docsUrl: '', checkedAt: 1,
};
const codexReady: CodexSetupState = {
  phase: 'ready', canAutoInstall: true, installCommand: 'install codex', docsUrl: '', checkedAt: 1,
};
let view: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { body: {} });
  useGraphStore.setState({
    userDefaults: { engineChoice: { kind: 'claude', chosenAt: 1 }, updatedAt: 1 },
    claudeSetup: ready, claudeSetupProgress: null, setupGateForced: true, setupGateDismissed: false,
    claudeAuth: { loggedIn: false, checkedAt: 1 },
    codexSetup: codexReady, codexSetupProgress: null, codexSetupGateForced: false, codexSetupGateDismissed: false,
    codexAuth: { loggedIn: false, checkedAt: 1 },
    projects: {}, stubProjects: {},
    setSetupGate: vi.fn((state: { forced?: boolean; dismissed?: boolean }) => {
      useGraphStore.setState({
        ...(state.forced !== undefined ? { setupGateForced: state.forced } : {}),
        ...(state.dismissed !== undefined ? { setupGateDismissed: state.dismissed } : {}),
      });
    }),
    setCodexSetupGate: vi.fn((state: { forced?: boolean; dismissed?: boolean }) => {
      useGraphStore.setState({
        ...(state.forced !== undefined ? { codexSetupGateForced: state.forced } : {}),
        ...(state.dismissed !== undefined ? { codexSetupGateDismissed: state.dismissed } : {}),
      });
    }),
    setLoginGate: vi.fn(), setCodexLoginGate: vi.fn(), setProjectGate: vi.fn(), resumeClaudeEntry: vi.fn(),
    installClaudeSetup: vi.fn(async () => undefined), refreshClaudeSetup: vi.fn(async () => undefined),
    refreshClaudeAuth: vi.fn(async () => useGraphStore.getState().claudeAuth),
    installCodexSetup: vi.fn(async () => undefined), refreshCodexSetup: vi.fn(async () => undefined),
    refreshCodexAuth: vi.fn(async () => useGraphStore.getState().codexAuth),
    refreshCodexModels: vi.fn(async () => undefined),
  });
});

afterEach(async () => {
  await act(async () => { view?.unmount(); });
  view = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderSetup(): Promise<void> {
  await act(async () => { view = create(createElement(ClaudeSetupGate)); });
}

async function finishReadyNotice(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(CLAUDE_SETUP_READY_HOLD_MS); });
}

describe('Claude 설치에서 다음 단계로 이어지는 실제 화면 연결', () => {
  it('이미 설치된 Claude 를 선택해도 계속하는 중에 멈추지 않고 로그인으로 간다', async () => {
    await renderSetup();
    expect(JSON.stringify(view?.toJSON())).toContain('panel.setup.ready');
    await finishReadyNotice();
    expect(useGraphStore.getState().setLoginGate).toHaveBeenCalledExactlyOnceWith({ forced: true, dismissed: false });
    expect(useGraphStore.getState().setupGateForced).toBe(false);
    expect(view?.toJSON()).toBeNull();
  });

  it('이미 로그인된 사용자는 로그인 재요청 없이 폴더 선택으로 가고 기다리던 버블로 돌아간다', async () => {
    useGraphStore.setState({ claudeAuth: { loggedIn: true, checkedAt: 1 } });
    await renderSetup();
    await finishReadyNotice();
    expect(useGraphStore.getState().setLoginGate).not.toHaveBeenCalled();
    expect(useGraphStore.getState().setProjectGate).toHaveBeenCalledWith({ forced: true, dismissed: false, reason: 'onboarding' });
    expect(useGraphStore.getState().resumeClaudeEntry).toHaveBeenCalledTimes(1);
  });

  it('새 설치가 준비 완료로 바뀌며 forced 가 내려가도 로그인 인계를 놓치지 않는다', async () => {
    useGraphStore.setState({ claudeSetup: { ...ready, phase: 'missing' } });
    await renderSetup();
    await act(async () => { useGraphStore.setState({ claudeSetup: ready, setupGateForced: false }); });
    await finishReadyNotice();
    expect(useGraphStore.getState().setLoginGate).toHaveBeenCalledTimes(1);
  });

  it('계속 클릭과 완료 타이머가 겹쳐도 다음 창을 한 번만 연다', async () => {
    await renderSetup();
    const button = view?.root.findAllByType('button').find((node) => node.children.includes('panel.setup.continue'));
    expect(button).toBeDefined();
    await act(async () => { button?.props.onClick(); });
    await finishReadyNotice();
    expect(useGraphStore.getState().refreshClaudeAuth).toHaveBeenCalledTimes(1);
    expect(useGraphStore.getState().setLoginGate).toHaveBeenCalledTimes(1);
    expect(view?.toJSON()).toBeNull();
  });

  it('준비된 설치 창을 나중에 다시 열어도 두 번째 인계가 막히지 않는다', async () => {
    await renderSetup();
    await finishReadyNotice();
    await act(async () => { useGraphStore.setState({ setupGateForced: true }); });
    await finishReadyNotice();
    expect(useGraphStore.getState().setLoginGate).toHaveBeenCalledTimes(2);
  });

  it('설치 판정이 엔진 선택보다 늦게 와도 ready 로 도착하면 인계한다', async () => {
    useGraphStore.setState({ claudeSetup: null });
    await renderSetup();
    await act(async () => { useGraphStore.setState({ claudeSetup: ready }); });
    await finishReadyNotice();
    expect(useGraphStore.getState().setLoginGate).toHaveBeenCalledTimes(1);
  });

  it('forced 가 아닌 준비 완료 상태는 저절로 열리거나 인계하지 않는다', async () => {
    useGraphStore.setState({ setupGateForced: false });
    await renderSetup();
    await finishReadyNotice();
    expect(view?.toJSON()).toBeNull();
    expect(useGraphStore.getState().setLoginGate).not.toHaveBeenCalled();
  });

  it('두 엔진이 모두 설치된 첫 선택에서 고른 엔진만 다음 칸으로 넘긴다', async () => {
    await act(async () => {
      view = create(createElement(Fragment, null, createElement(ClaudeSetupGate), createElement(CodexSetupGate)));
    });
    await finishReadyNotice();
    expect(useGraphStore.getState().setLoginGate).toHaveBeenCalledTimes(1);
    expect(useGraphStore.getState().setCodexLoginGate).not.toHaveBeenCalled();
    expect(view?.toJSON()).toBeNull();
  });
});
