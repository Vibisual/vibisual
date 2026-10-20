import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUBBLE_SKINS, BUBBLE_EDGE_STYLES, SUPPORTED_UI_LOCALES, type UserDefaults } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { BubbleAppearanceSection } from './BubbleAppearanceSection.js';

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

let view: ReactTestRenderer | undefined;
const fetchMock = vi.fn<typeof fetch>();
const stored = (): UserDefaults => ({
  updatedAt: 10,
  appearance: { themeId: 'custom:existing', bubbleSkin: 'outline', edgeStyle: 'beads', uiLocale: 'ko' },
  agentConfig: { model: 'sonnet', rules: 'Keep the existing user settings.' },
});
const response = (defaults: UserDefaults, status = 200) => new Response(JSON.stringify({ ok: status === 200, userDefaults: defaults }), { status });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  useGraphStore.setState({ userDefaults: stored(), bubbleAppearancePending: null, bubbleAppearanceSaving: false });
});
afterEach(async () => {
  await act(async () => { view?.unmount(); });
  view = undefined;
  vi.unstubAllGlobals();
});
async function mount(): Promise<void> {
  await act(async () => { view = create(createElement(BubbleAppearanceSection)); });
}
const selects = () => view!.root.findAllByType('select');

describe('immediate, independent bubble and edge settings', () => {
  it('offers five choices each and uses 05 Signal Rim / E2 Signal Dash without writing defaults', async () => {
    useGraphStore.setState({ userDefaults: { updatedAt: 1 } });
    await mount();
    expect(selects().map(select => select.props.value)).toEqual(['signal', 'dash']);
    expect(selects().map(select => select.findAllByType('option').length)).toEqual([5, 5]);
    expect(selects()[0]!.findAllByType('option').find(option => option.props.value === 'signal')!.children.join('')).toBe('05 · Signal Rim');
    expect(selects()[1]!.findAllByType('option').find(option => option.props.value === 'dash')!.children.join('')).toBe('E2 · Signal Dash');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('previews the bubble immediately, serializes both controls, and sends only its partial patch', async () => {
    let finish!: (value: Response) => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    fetchMock.mockReturnValueOnce(pending);
    await mount();
    act(() => { selects()[0]!.props.onChange({ target: { value: 'frost' } }); });
    expect(selects().map(select => select.props.value)).toEqual(['frost', 'beads']);
    expect(selects().every(select => select.props.disabled)).toBe(true);
    expect(useGraphStore.getState().userDefaults).toEqual(stored());
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ appearance: { bubbleSkin: 'frost' } });
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('PUT');
    await expect(useGraphStore.getState().setBubbleAppearance({ edgeStyle: 'rail' })).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const saved = { ...stored(), updatedAt: 20, appearance: { ...stored().appearance, bubbleSkin: 'frost' as const } };
    await act(async () => { finish(response(saved)); await pending; });
    expect(useGraphStore.getState().userDefaults).toEqual(saved);
    expect(useGraphStore.getState().bubbleAppearancePending).toBeNull();
    expect(selects().every(select => !select.props.disabled)).toBe(true);
    expect(view!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  });

  it('sends only the edge choice and preserves the saved bubble, theme, locale and agent settings', async () => {
    const saved = { ...stored(), updatedAt: 20, appearance: { ...stored().appearance, edgeStyle: 'glow' as const } };
    fetchMock.mockResolvedValueOnce(response(saved));
    await mount();
    await act(async () => { selects()[1]!.props.onChange({ target: { value: 'glow' } }); });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({ appearance: { edgeStyle: 'glow' } });
    expect(selects().map(select => select.props.value)).toEqual(['outline', 'glow']);
    expect(useGraphStore.getState().userDefaults).toEqual(saved);
  });

  it.each(['http', 'network'] as const)('releases the preview and displays an error after a %s failure', async (failure) => {
    if (failure === 'http') fetchMock.mockResolvedValueOnce(response(stored(), 500));
    else fetchMock.mockRejectedValueOnce(new Error('offline'));
    await mount();
    await act(async () => { selects()[0]!.props.onChange({ target: { value: 'halo' } }); });
    expect(selects().map(select => select.props.value)).toEqual(['outline', 'beads']);
    expect(selects().every(select => !select.props.disabled)).toBe(true);
    expect(useGraphStore.getState().userDefaults).toEqual(stored());
    expect(view!.root.findByProps({ role: 'alert' }).children.join('')).toBe('options.appearance.saveFailed');
  });

  it('a failed write never restores an old snapshot over a newer theme or other settings', async () => {
    let finish!: (value: Response) => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    fetchMock.mockReturnValueOnce(pending);
    await mount();
    act(() => { selects()[0]!.props.onChange({ target: { value: 'twin' } }); });
    const newer: UserDefaults = { ...stored(), updatedAt: 30, appearance: { ...stored().appearance, themeId: 'custom:newer', edgeStyle: 'rail' }, agentConfig: { rules: 'Updated elsewhere.' } };
    act(() => { useGraphStore.getState().applyUserDefaults(newer); });
    expect(selects().map(select => select.props.value)).toEqual(['twin', 'rail']);
    await act(async () => { finish(response(stored(), 500)); await pending; });
    expect(useGraphStore.getState().userDefaults).toEqual(newer);
    expect(selects().map(select => select.props.value)).toEqual(['outline', 'rail']);
  });

  it('a successful but late response cannot replace a newer saved snapshot', async () => {
    let finish!: (value: Response) => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    fetchMock.mockReturnValueOnce(pending);
    await mount();
    act(() => { selects()[1]!.props.onChange({ target: { value: 'dash' } }); });
    const newer: UserDefaults = { ...stored(), updatedAt: 30, appearance: { ...stored().appearance, themeId: 'custom:newer', edgeStyle: 'wire' } };
    act(() => { useGraphStore.getState().applyUserDefaults(newer); });
    await act(async () => { finish(response({ ...stored(), updatedAt: 20, appearance: { ...stored().appearance, edgeStyle: 'dash' } })); await pending; });
    expect(useGraphStore.getState().userDefaults).toEqual(newer);
    expect(selects()[1]!.props.value).toBe('wire');
    expect(view!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  });
});

const sources = import.meta.glob('../../i18n/locales/*.json', { eager: true });
type AppearanceStrings = { title: string; intro: string; bubbleStyle: string; edgeStyle: string; saveFailed: string; bubbleSkins: Record<string, string>; edgeStyles: Record<string, string> };
describe('appearance selection translations', () => {
  for (const locale of SUPPORTED_UI_LOCALES) {
    it(`${locale} includes every displayed choice and save message`, () => {
      const module = sources[`../../i18n/locales/${locale}.json`] as { default: { options: { appearance: AppearanceStrings } } };
      const strings = module.default.options.appearance;
      for (const key of ['title', 'intro', 'bubbleStyle', 'edgeStyle', 'saveFailed'] as const) expect(strings[key].trim()).not.toBe('');
      for (const skin of BUBBLE_SKINS) expect(strings.bubbleSkins[skin.id]?.trim()).toBeTruthy();
      for (const edge of BUBBLE_EDGE_STYLES) expect(strings.edgeStyles[edge.id]?.trim()).toBeTruthy();
      if (locale === 'ko') {
        expect(strings.bubbleSkins.signal).toBe('시그널 림');
        expect(strings.edgeStyles.dash).toBe('시그널 대시');
      }
    });
  }
});
