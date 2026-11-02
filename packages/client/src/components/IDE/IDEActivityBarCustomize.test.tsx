import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDEActivityBarCustomize } from './IDEActivityBarCustomize.js';
import { DEFAULT_ACTIVITY_ORDER } from './ideActivityItems.js';
import { useIDEActivityBarStore } from '../../stores/ideActivityBar.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const optionalViews = ['goal', 'autoGoal', 'orchestra', 'configTrim', 'loop', 'specReading'] as const;
const fetchMock = vi.fn<typeof fetch>();
let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({})));
  vi.stubGlobal('fetch', fetchMock);
  useIDEActivityBarStore.getState().applyPrefs({});
});

afterEach(async () => {
  await act(async () => { renderer?.unmount(); });
  renderer = undefined;
  vi.unstubAllGlobals();
});

it.each([false, true])('opens settings for all six optional views without adding or enabling them (shown: %s)', async (shown) => {
  const onConfigure = vi.fn();
  const hidden = shown ? [] : [...optionalViews];
  if (shown) useIDEActivityBarStore.getState().applyPrefs({ shown: [...optionalViews] });
  await act(async () => {
    renderer = create(createElement(IDEActivityBarCustomize, {
      order: DEFAULT_ACTIVITY_ORDER,
      visible: shown ? [...optionalViews, 'files'] : ['files'],
      hidden,
      labelOf: view => view,
      onConfigure,
      onClose: vi.fn(),
    }));
  });
  const before = [...useIDEActivityBarStore.getState().hidden];
  const settings = renderer!.root.findAllByType('button').filter(node => node.props['aria-label'] === 'ide.activityBar.configure');
  expect(settings).toHaveLength(optionalViews.length);
  for (const view of optionalViews) {
    const row = renderer!.root.findAllByType('li').find(node => node.findAllByType('span').some(span => span.children.includes(view)))!;
    const button = row.findAllByType('button').find(node => node.props['aria-label'] === 'ide.activityBar.configure')!;
    await act(async () => { button.props.onClick(); });
    expect(onConfigure).toHaveBeenLastCalledWith(view);
  }
  expect(useIDEActivityBarStore.getState().hidden).toEqual(before);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('adding a hidden feature changes only activity visibility and does not open its settings', async () => {
  const onConfigure = vi.fn();
  await act(async () => {
    renderer = create(createElement(IDEActivityBarCustomize, {
      order: DEFAULT_ACTIVITY_ORDER,
      visible: ['files'],
      hidden: ['goal'],
      labelOf: view => view,
      onConfigure,
      onClose: vi.fn(),
    }));
  });
  const button = renderer!.root.findAllByType('button').find(node => node.props['aria-label'] === 'ide.activityBar.add')!;
  await act(async () => { button.props.onClick(); });
  expect(useIDEActivityBarStore.getState().hidden).not.toContain('goal');
  expect(onConfigure).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/ide-activity-bar');
});
