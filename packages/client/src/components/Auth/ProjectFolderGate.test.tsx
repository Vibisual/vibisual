import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../stores/graphStore.js';
import { ProjectFolderGate } from './ProjectFolderGate.js';
import type { ProjectFolderOpenResult } from './projectFolderGateFlow.js';

vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../Layout/LanguageSwitcher.js', () => ({ LanguageSwitcher: () => null }));
vi.mock('../../hooks/usePopupDismiss.js', () => ({ useBackdropDismiss: () => ({}) }));
vi.mock('../../stores/onboardingGates.js', () => ({ useOnboardingGate: () => undefined }));
vi.mock('../../stores/graphStore.js', async () => {
  const { create: makeStore } = await import('zustand');
  return { useGraphStore: makeStore(() => ({})) };
});

/** §4 (첫 실행 온보딩) ③ — 폴더를 못 연 실제 원인을 "고르지 않았습니다"(취소)로 덮지 않는다. */

let view: ReactTestRenderer | undefined;
const text = (): string => JSON.stringify(view?.toJSON());

beforeEach(() => {
  vi.stubGlobal('document', { body: {} });
  useGraphStore.setState({
    projects: {}, stubProjects: {},
    claudeSetup: null, claudeAuth: null, codexSetup: null, codexAuth: null,
    userDefaults: { engineChoice: { kind: 'local', chosenAt: 1 }, updatedAt: 1 },
    projectGateForced: true, projectGateDismissed: false, projectGateReason: 'onboarding',
    setProjectGate: vi.fn(),
  });
});

afterEach(async () => {
  await act(async () => { view?.unmount(); });
  view = undefined;
  vi.unstubAllGlobals();
});

async function pick(result: ProjectFolderOpenResult): Promise<void> {
  useGraphStore.setState({ openProjectFolder: vi.fn(async () => result) });
  await act(async () => { view = create(createElement(ProjectFolderGate)); });
  const button = view?.root.findAllByType('button').find((node) => node.children.includes('panel.projectFolder.choose'));
  expect(button).toBeDefined();
  await act(async () => { button?.props.onClick(); });
}

describe('폴더 선택 결과 표시', () => {
  it('선택기가 없으면 취소 문구 대신 설치 안내와 서버 원문을 보인다', async () => {
    await pick({ ok: false, cancelled: false, error: { kind: 'picker-missing', detail: 'no folder picker available (install zenity or kdialog)' } });
    expect(text()).toContain('panel.projectFolder.errorPickerMissing');
    expect(text()).toContain('install zenity or kdialog');
    expect(text()).not.toContain('panel.projectFolder.cancelled');
  });

  it('등록 실패는 실패 문장과 원인을 보인다', async () => {
    await pick({ ok: false, cancelled: false, error: { kind: 'failed', detail: 'Error: EACCES: permission denied' } });
    expect(text()).toContain('panel.projectFolder.errorFailed');
    expect(text()).toContain('EACCES');
    expect(text()).not.toContain('panel.projectFolder.cancelled');
  });

  it('서버에 닿지 못하면 연결 문장을 보인다', async () => {
    await pick({ ok: false, cancelled: false, error: { kind: 'network', detail: null } });
    expect(text()).toContain('panel.projectFolder.errorNetwork');
    expect(text()).not.toContain('panel.projectFolder.cancelled');
  });

  it('실제 취소만 취소 안내를 보이고 오류 상자는 없다', async () => {
    await pick({ ok: false, cancelled: true });
    expect(text()).toContain('panel.projectFolder.cancelled');
    expect(text()).not.toContain('panel.projectFolder.error');
  });

  it('다시 고르면 앞선 실패 안내를 지운다', async () => {
    await pick({ ok: false, cancelled: false, error: { kind: 'failed', detail: 'boom' } });
    await act(async () => {
      useGraphStore.setState({ openProjectFolder: vi.fn(async (): Promise<ProjectFolderOpenResult> => ({ ok: false, cancelled: true })) });
    });
    const button = view?.root.findAllByType('button').find((node) => node.children.includes('panel.projectFolder.choose'));
    await act(async () => { button?.props.onClick(); });
    expect(text()).not.toContain('panel.projectFolder.errorFailed');
    expect(text()).toContain('panel.projectFolder.cancelled');
  });
});
