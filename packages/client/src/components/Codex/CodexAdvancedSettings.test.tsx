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
