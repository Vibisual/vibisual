import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { CodexAdvancedSettings } from './CodexAdvancedSettings.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('offers speed examples without restricting arbitrary future tiers or silently enabling one', async () => {
  const onChange = vi.fn();
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(CodexAdvancedSettings, { value: {}, onChange })); });
  const input = view.root.findAllByType('input').find((node) => node.props.list);
  expect(input?.props.value).toBe('');
  expect(onChange).not.toHaveBeenCalled();
  expect(view.root.findByType('datalist').findAllByType('option').map((node) => node.props.value)).toEqual(['fast', 'ultrafast']);
  expect(view.root.findByProps({ id: input?.props['aria-describedby'] }).children).toEqual(['providers.serviceTierHint']);
  await act(async () => { input?.props.onChange({ target: { value: 'future-tier' } }); });
  expect(onChange).toHaveBeenLastCalledWith({ serviceTier: 'future-tier' });
  await act(async () => { input?.props.onChange({ target: { value: '' } }); });
  expect(onChange).toHaveBeenLastCalledWith({ serviceTier: undefined });
  await act(async () => { view.unmount(); });
});

it.each([
  [false, 'panel.agentConfig.codex.unsupported'],
  [undefined, 'panel.agentConfig.effective.unknown'],
] as const)('retains saved personality without offering it when support is %s', async (supportsPersonality, hint) => {
  const onChange = vi.fn();
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(CodexAdvancedSettings, {
    value: { personality: 'pragmatic' }, onChange, supportsPersonality,
  })); });
  const select = view.root.findAllByType('select').find(node => node.props.value === 'pragmatic')!;
  expect(select.props.disabled).toBe(true);
  expect(view.root.findByProps({ id: select.props['aria-describedby'] }).children).toEqual([hint]);
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => { select.props.onChange({ target: { value: 'friendly' } }); });
  expect(onChange).not.toHaveBeenCalled();
  expect(select.props.value).toBe('pragmatic');
  await act(async () => { view.unmount(); });
});

it('enables personality only with explicit model support and preserves it when catalog support changes', async () => {
  const onChange = vi.fn();
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(CodexAdvancedSettings, {
    value: { personality: 'friendly' }, onChange, supportsPersonality: true,
  })); });
  const personality = () => view.root.findAllByType('select').find(node => node.props['aria-describedby'])!;
  expect(personality().props.disabled).toBe(false);
  await act(async () => { personality().props.onChange({ target: { value: 'pragmatic' } }); });
  expect(onChange).toHaveBeenLastCalledWith({ personality: 'pragmatic' });
  onChange.mockClear();
  await act(async () => { view.update(createElement(CodexAdvancedSettings, {
    value: { personality: 'pragmatic' }, onChange, supportsPersonality: false,
  })); });
  expect(personality().props.disabled).toBe(true);
  expect(personality().props.value).toBe('pragmatic');
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => { view.unmount(); });
});
