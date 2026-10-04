import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEngineKind } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { ProviderTabs } from './ProviderTabs.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../stores/graphStore.js', async () => {
  const { create: makeStore } = await import('zustand');
  return { useGraphStore: makeStore(() => ({})) };
});

let view: ReactTestRenderer | undefined;
const chooseEngine = vi.fn();
const onChange = vi.fn();
function render(value: AgentEngineKind, showSetMain = true) {
  return createElement(ProviderTabs, { value, onChange, showSetMain });
}
function setMainButton() {
  return view!.root.findAllByType('button').find((node) => node.children.includes('providers.setMain'));
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  chooseEngine.mockResolvedValue(undefined);
  useGraphStore.setState({ userDefaults: { updatedAt: 1, engineChoice: { kind: 'claude', chosenAt: 1 } }, chooseEngine });
});
afterEach(async () => {
  await act(async () => { view?.unmount(); });
  view = undefined;
});

describe('provider tabs — [set as default] beside the tabs (§5.25 (C))', () => {
  it('without the opt-in the row is the three tabs only', async () => {
    await act(async () => { view = create(render('codex', false)); });
    expect(view!.root.findByProps({ role: 'tablist' }).findAllByType('button')).toHaveLength(3);
    expect(view!.root.findAllByType('button')).toHaveLength(3);
    expect(view!.root.findAll((node) => node.children.includes('providers.isMain'))).toHaveLength(0);
  });

  it('a tab only switches the view — it never saves the main provider', async () => {
    await act(async () => { view = create(render('claude')); });
    const codexTab = view!.root.findAllByProps({ role: 'tab' }).find((node) => node.children.includes('providers.codex'))!;
    await act(async () => { codexTab.props.onClick(); });
    expect(onChange).toHaveBeenCalledExactlyOnceWith('codex');
    expect(chooseEngine).not.toHaveBeenCalled();
  });

  it('the button stays outside the tablist so the tablist holds tabs only', async () => {
    await act(async () => { view = create(render('codex')); });
    const tablist = view!.root.findByProps({ role: 'tablist' });
    expect(tablist.findAllByType('button').every((node) => node.props.role === 'tab')).toBe(true);
    expect(setMainButton()).toBeDefined();
  });

  it('when the viewed provider already is the main one there is nothing to press', async () => {
    await act(async () => { view = create(render('claude')); });
    expect(setMainButton()).toBeUndefined();
    expect(view!.root.findAll((node) => node.type === 'span' && node.children.includes('providers.isMain'))).toHaveLength(1);
  });

  it('saves the viewed provider once even when two clicks land before disabled renders', async () => {
    const save = deferred();
    chooseEngine.mockReturnValueOnce(save.promise);
    await act(async () => { view = create(render('codex')); });
    const button = setMainButton()!;
    await act(async () => { button.props.onClick(); button.props.onClick(); });
    expect(chooseEngine).toHaveBeenCalledExactlyOnceWith('codex');
    expect(setMainButton()!.props.disabled).toBe(true);
    await act(async () => {
      useGraphStore.setState({ userDefaults: { updatedAt: 2, engineChoice: { kind: 'codex', chosenAt: 2 } } });
      save.resolve();
    });
    expect(setMainButton()).toBeUndefined();
    expect(view!.root.findAll((node) => node.type === 'span' && node.children.includes('providers.isMain'))).toHaveLength(1);
  });

  it('a failed save says so on that provider only and can be retried', async () => {
    const save = deferred();
    chooseEngine.mockReturnValueOnce(save.promise);
    await act(async () => { view = create(render('codex')); });
    await act(async () => { setMainButton()!.props.onClick(); });
    await act(async () => { save.reject(new Error('HTTP 503')); });
    expect(view!.root.findByProps({ role: 'alert' }).children).toContain('providers.saveFailed');
    expect(setMainButton()!.props.disabled).toBe(false);

    await act(async () => { view!.update(render('local')); });
    expect(view!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);

    await act(async () => { view!.update(render('codex')); });
    await act(async () => { setMainButton()!.props.onClick(); });
    expect(chooseEngine.mock.calls.map((args) => args[0])).toEqual(['codex', 'codex']);
    expect(view!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  });
});
