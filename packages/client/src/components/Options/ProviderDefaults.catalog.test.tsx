import { createElement, createRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGraphStore } from '../../stores/graphStore.js';
import { ProviderDefaults, type ProviderDefaultsHandle } from './ProviderDefaults.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../stores/graphStore.js', async () => {
  const { create: makeStore } = await import('zustand');
  return { useGraphStore: makeStore(() => ({})) };
});
vi.mock('../Codex/useCodexEffectiveConfig.js', () => ({ useCodexEffectiveConfig: () => ({ layers: [] }) }));
vi.mock('../LocalModel/localEffective.js', () => ({ useLocalSampling: () => null, localContextPlaceholder: () => ({}), localTemperaturePlaceholder: () => ({}) }));

let view: ReactTestRenderer | undefined;
const refresh = vi.fn(async () => undefined);

beforeEach(() => {
  refresh.mockClear();
  useGraphStore.setState({
    userDefaults: { updatedAt: 1, engineConfigs: { codex: { provider: { kind: 'codex-cli', modelId: 'saved-model', reasoningEffort: 'ultra' } } } },
    codexModels: { checkedAt: 1, models: [{ slug: 'saved-model', displayName: 'Saved', reasoningLevels: ['ultra'] }] },
    refreshCodexModels: refresh,
  });
});

afterEach(async () => { await act(async () => { view?.unmount(); }); view = undefined; });

it('catalog reorder, retirement and outage do not change saved model, effort or dirty state', async () => {
  const onDirtyChange = vi.fn();
  const ref = createRef<ProviderDefaultsHandle>();
  await act(async () => { view = create(createElement(ProviderDefaults, { engine: 'codex', ref, onDirtyChange })); });
  expect(refresh).toHaveBeenCalledWith(false);
  for (const models of [[{ slug: 'new-model', displayName: 'New', reasoningLevels: ['max'], isDefault: true }], []]) {
    await act(async () => { useGraphStore.setState({ codexModels: { models, checkedAt: 2 } }); });
    const selects = view!.root.findAllByType('select');
    for (const value of ['saved-model', 'ultra']) {
      const select = selects.find((node) => node.props.value === value);
      expect(select, value).toBeDefined();
      expect(select!.findAllByType('option').some((option) => option.props.value === value)).toBe(true);
    }
  }
  expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  await expect(ref.current?.save()).resolves.toBe(true);
  expect(useGraphStore.getState().userDefaults?.engineConfigs?.codex?.provider?.modelId).toBe('saved-model');
});

it('a newly discovered default does not turn a blank inherited model into an explicit choice', async () => {
  useGraphStore.setState({ userDefaults: { updatedAt: 1 } });
  await act(async () => { view = create(createElement(ProviderDefaults, { engine: 'codex' })); });
  await act(async () => { useGraphStore.setState({ codexModels: { checkedAt: 2, models: [{ slug: 'new-default', displayName: 'New', isDefault: true, reasoningLevels: ['ultra'] }] } }); });
  const modelSelect = view!.root.findAllByType('select').find((select) => select.findAllByType('option').some((option) => option.props.value === 'new-default'));
  expect(modelSelect?.props.value).toBe('');
  // The CLI may inherit another configured model, so catalog-default effort is not asserted.
  expect(view!.root.findAllByType('option').some((option) => option.props.value === 'ultra')).toBe(false);
});
