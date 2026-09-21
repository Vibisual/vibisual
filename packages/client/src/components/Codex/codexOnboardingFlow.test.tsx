import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAUDE_SETUP_READY_HOLD_MS, type CodexSetupState } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { ProjectFolderGate } from '../Auth/ProjectFolderGate.js';
import { CodexSetupGate } from './CodexSetupGate.js';

vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../Layout/LanguageSwitcher.js', () => ({ LanguageSwitcher: () => null }));
vi.mock('../../hooks/usePopupDismiss.js', () => ({ useBackdropDismiss: () => ({}) }));
vi.mock('../../stores/onboardingGates.js', () => ({ useOnboardingGate: () => undefined }));
vi.mock('../../stores/graphStore.js', async () => {
  const { create: makeStore } = await import('zustand');
  return { useGraphStore: makeStore(() => ({})) };
});

const ready: CodexSetupState = {
  phase: 'ready', canAutoInstall: true, installCommand: 'install codex', docsUrl: '', checkedAt: 1,
};
let view: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { body: {} });
  useGraphStore.setState({
    userDefaults: { engineChoice: { kind: 'codex', chosenAt: 1 }, updatedAt: 1 },
    codexSetup: ready, codexSetupProgress: null, codexSetupGateForced: true, codexSetupGateDismissed: false,
    codexAuth: { loggedIn: false, checkedAt: 1 },
    claudeSetup: { ...ready, phase: 'missing' }, claudeAuth: { loggedIn: false, checkedAt: 1 },
    projects: {}, stubProjects: {}, projectGateForced: false, projectGateDismissed: false, projectGateReason: 'onboarding',
    setCodexSetupGate: vi.fn((state: { forced?: boolean; dismissed?: boolean }) => {
      useGraphStore.setState({
        ...(state.forced !== undefined ? { codexSetupGateForced: state.forced } : {}),
        ...(state.dismissed !== undefined ? { codexSetupGateDismissed: state.dismissed } : {}),
      });
    }),
    setCodexLoginGate: vi.fn(), setProjectGate: vi.fn(),
    installCodexSetup: vi.fn(async () => undefined), refreshCodexSetup: vi.fn(async () => undefined),
    refreshCodexAuth: vi.fn(async () => useGraphStore.getState().codexAuth),
    refreshCodexModels: vi.fn(async () => undefined), openProjectFolder: vi.fn(async () => false),
  });
});

afterEach(async () => {
  await act(async () => { view?.unmount(); });
  view = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderSetup(): Promise<void> {
  await act(async () => { view = create(createElement(CodexSetupGate)); });
}

async function finishReadyNotice(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(CLAUDE_SETUP_READY_HOLD_MS); });
}

describe('Codex 설치에서 다음 단계로 이어지는 실제 화면 연결', () => {
  it('이미 설치된 Codex를 선택해도 계속하는 중에 멈추지 않고 로그인으로 간다', async () => {
    await renderSetup();
    await finishReadyNotice();
    expect(useGraphStore.getState().setCodexLoginGate).toHaveBeenCalledWith({ forced: true, dismissed: false });
    expect(view?.toJSON()).toBeNull();
  });

  it('이미 로그인된 사용자는 로그인 재요청 없이 폴더 선택으로 간다', async () => {
    useGraphStore.setState({ codexAuth: { loggedIn: true, checkedAt: 1 } });
    await renderSetup();
    await finishReadyNotice();
    expect(useGraphStore.getState().setCodexLoginGate).not.toHaveBeenCalled();
    expect(useGraphStore.getState().setProjectGate).toHaveBeenCalledWith({ forced: true, dismissed: false, reason: 'onboarding' });
  });

  it('새 설치가 준비 완료로 바뀌며 forced가 내려가도 로그인 인계를 놓치지 않는다', async () => {
    useGraphStore.setState({ codexSetup: { ...ready, phase: 'missing' } });
    await renderSetup();
    await act(async () => { useGraphStore.setState({ codexSetup: ready, codexSetupGateForced: false }); });
    await finishReadyNotice();
    expect(useGraphStore.getState().setCodexLoginGate).toHaveBeenCalledTimes(1);
  });

  it('계속 클릭과 완료 타이머가 겹쳐도 다음 창을 한 번만 연다', async () => {
    await renderSetup();
    const button = view?.root.findAllByType('button').find((node) => node.children.includes('panel.codexSetup.continue'));
    expect(button).toBeDefined();
    await act(async () => { button?.props.onClick(); });
    await finishReadyNotice();
    expect(useGraphStore.getState().refreshCodexAuth).toHaveBeenCalledTimes(1);
    expect(useGraphStore.getState().setCodexLoginGate).toHaveBeenCalledTimes(1);
  });

  it('준비된 설치 창을 나중에 다시 열어도 두 번째 인계가 막히지 않는다', async () => {
    await renderSetup();
    await finishReadyNotice();
    await act(async () => { useGraphStore.setState({ codexSetupGateForced: true }); });
    await finishReadyNotice();
    expect(useGraphStore.getState().setCodexLoginGate).toHaveBeenCalledTimes(2);
  });

  it('재실행한 Codex 전용 사용자도 Claude 없이 프로젝트 폴더 화면을 본다', async () => {
    useGraphStore.setState({ codexSetupGateForced: false, codexAuth: { loggedIn: true, checkedAt: 1 } });
    await act(async () => { view = create(createElement(ProjectFolderGate)); });
    expect(JSON.stringify(view?.toJSON())).toContain('panel.projectFolder.choose');
  });
});
