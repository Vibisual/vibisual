import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../stores/graphStore.js';
import { EngineChooserGate } from './EngineChooserGate.js';

vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../Layout/LanguageSwitcher.js', () => ({ LanguageSwitcher: () => null }));
vi.mock('../../stores/onboardingGates.js', () => ({ useOnboardingGate: () => undefined }));
vi.mock('../../stores/graphStore.js', async () => {
  const { create: makeStore } = await import('zustand');
  return { useGraphStore: makeStore(() => ({})) };
});

let view: ReactTestRenderer | undefined;
const chooseEngine = vi.fn();
const setSetupGate = vi.fn();
const setCodexSetupGate = vi.fn();
const setProjectGate = vi.fn();
function button(key: string) {
  const found = view!.root.findAllByType('button').find((node) => node.children.includes(key)
    || node.findAllByType('span').some((span) => span.children.includes(key)));
  if (!found) throw new Error(`Missing button ${key}`);
  return found;
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  vi.clearAllMocks();
  chooseEngine.mockResolvedValue(undefined);
  vi.stubGlobal('document', { body: {} });
  useGraphStore.setState({
    userDefaults: { updatedAt: 1 }, projects: {}, stubProjects: {},
    engineChooserForced: false, engineChooserDismissed: false,
    chooseEngine, setEngineChooser: vi.fn(), setSetupGate, setCodexSetupGate, setProjectGate,
  });
  await act(async () => { view = create(createElement(EngineChooserGate)); });
});
afterEach(async () => {
  await act(async () => { view?.unmount(); });
  view = undefined;
  vi.unstubAllGlobals();
});

describe('first engine choice owns its save and handoff', () => {
  it('accepts one choice even when two clicks arrive before the disabled UI renders', async () => {
    const save = deferred();
    chooseEngine.mockReturnValueOnce(save.promise);
    const claude = button('panel.engineChooser.claude.name');
    const codex = button('panel.engineChooser.codex.name');
    await act(async () => { claude.props.onClick(); codex.props.onClick(); });
    expect(chooseEngine).toHaveBeenCalledExactlyOnceWith('claude');
    expect(view!.root.findByProps({ role: 'status' }).children).toContain('panel.engineChooser.saving');
    expect(view!.root.findAllByType('button').every((node) => node.props.disabled)).toBe(true);
    expect(setSetupGate).not.toHaveBeenCalled();
    await act(async () => { save.resolve(); });
    expect(setSetupGate).toHaveBeenCalledExactlyOnceWith({ forced: true, dismissed: false });
    expect(setCodexSetupGate).not.toHaveBeenCalled();
    expect(setProjectGate).not.toHaveBeenCalled();
  });

  it('renders a failed save, unlocks selection, and hands off only the successful retry', async () => {
    const save = deferred();
    chooseEngine.mockReturnValueOnce(save.promise);
    await act(async () => { button('panel.engineChooser.claude.name').props.onClick(); });
    await act(async () => { save.reject(new Error('HTTP 503')); });
    expect(view!.root.findByProps({ role: 'alert' }).children).toContain('panel.engineChooser.saveError');
    expect(view!.root.findAllByType('button').every((node) => !node.props.disabled)).toBe(true);
    expect(setSetupGate).not.toHaveBeenCalled();
    expect(setCodexSetupGate).not.toHaveBeenCalled();
    expect(setProjectGate).not.toHaveBeenCalled();
    await act(async () => { button('panel.engineChooser.codex.name').props.onClick(); });
    expect(chooseEngine.mock.calls.map((args) => args[0])).toEqual(['claude', 'codex']);
    expect(view!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
    expect(setCodexSetupGate).toHaveBeenCalledExactlyOnceWith({ forced: true, dismissed: false });
  });

  it('a saved local choice opens the project picker without a cloud login', async () => {
    await act(async () => { button('panel.engineChooser.local.name').props.onClick(); });
    expect(setProjectGate).toHaveBeenCalledExactlyOnceWith({ forced: true, dismissed: false, reason: 'onboarding' });
    expect(setSetupGate).not.toHaveBeenCalled();
    expect(setCodexSetupGate).not.toHaveBeenCalled();
  });
});
