import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTERNAL_FOLDER_MERGE_DEPTH_DEFAULT, SUPPORTED_UI_LOCALES } from '@vibisual/shared';
import { ExternalFolderSection } from './ExternalFolderSection.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

let view: ReactTestRenderer | undefined;
const fetchMock = vi.fn<typeof fetch>();
const dirtyChange = vi.fn<(dirty: boolean) => void>();
const response = (budget: number, mergeDepth?: number) => new Response(JSON.stringify({ budget, mergeDepth }));
const depthInput = () => view!.root.findByProps({ 'aria-label': 'External folder merge depth' });
const budgetInput = () => view!.root.findByProps({ 'aria-label': 'External folders shown at the top level' });
const button = (label: string) => view!.root.findAllByType('button').find(node => node.children.join('') === label)!;

beforeEach(() => {
  fetchMock.mockReset();
  dirtyChange.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await act(async () => { view?.unmount(); });
  view = undefined;
  vi.unstubAllGlobals();
});

async function mount(): Promise<void> {
  await act(async () => { view = create(<ExternalFolderSection onDirtyChange={dirtyChange} />); });
}

describe('external folder merge settings', () => {
  it('uses the default depth for settings saved before merge depth existed', async () => {
    fetchMock.mockResolvedValueOnce(response(7));
    await mount();
    expect(depthInput().props.value).toBe(EXTERNAL_FOLDER_MERGE_DEPTH_DEFAULT);
    expect(depthInput().props.min).toBe(0);
    expect(depthInput().props.max).toBe(20);
    expect(budgetInput().props.value).toBe(7);
    expect(budgetInput().props.disabled).toBe(true);
    expect(button('Save').props.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('saves a depth-only edit together with the existing budget and clears the dirty guard', async () => {
    fetchMock.mockResolvedValueOnce(response(9, 3));
    await mount();
    act(() => { depthInput().props.onChange({ target: { value: '5' } }); });
    expect(dirtyChange).toHaveBeenLastCalledWith(true);
    expect(button('Save').props.disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(response(9, 5));
    await act(async () => { button('Save').props.onClick(); });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/external-folder-budget');
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PUT');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ budget: 9, mergeDepth: 5 });
    expect(depthInput().props.value).toBe(5);
    expect(button('Save').props.disabled).toBe(true);
    expect(dirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('allows the activity budget at depth zero and restores both defaults without saving early', async () => {
    fetchMock.mockResolvedValueOnce(response(7, 5));
    await mount();
    act(() => { depthInput().props.onChange({ target: { value: '0' } }); });
    expect(budgetInput().props.disabled).toBe(false);
    act(() => { budgetInput().props.onChange({ target: { value: '8' } }); });
    fetchMock.mockResolvedValueOnce(response(8, 0));
    await act(async () => { button('Save').props.onClick(); });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ budget: 8, mergeDepth: 0 });
    act(() => { button('Restore defaults').props.onClick(); });
    expect(depthInput().props.value).toBe(EXTERNAL_FOLDER_MERGE_DEPTH_DEFAULT);
    expect(budgetInput().props.value).toBe(12);
    expect(budgetInput().props.disabled).toBe(true);
    expect(dirtyChange).toHaveBeenLastCalledWith(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps an unsaved depth after a failed write so it can be retried', async () => {
    fetchMock.mockResolvedValueOnce(response(12, 3));
    await mount();
    act(() => { depthInput().props.onChange({ target: { value: '4' } }); });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await act(async () => { button('Save').props.onClick(); });
    expect(depthInput().props.value).toBe(4);
    expect(button('Save').props.disabled).toBe(false);
    expect(dirtyChange).toHaveBeenLastCalledWith(true);
    expect(JSON.stringify(view!.toJSON())).toContain('Could not save. Nothing was changed.');
    fetchMock.mockResolvedValueOnce(response(12, 4));
    await act(async () => { button('Save').props.onClick(); });
    expect(dirtyChange).toHaveBeenLastCalledWith(false);
  });
});

const sources = import.meta.glob('../../i18n/locales/*.json', { eager: true });
describe('external folder merge translations', () => {
  for (const locale of SUPPORTED_UI_LOCALES) {
    it(`${locale} explains merge depth and the activity budget`, () => {
      const module = sources[`../../i18n/locales/${locale}.json`] as {
        default: { panel: { options: { advanced: Record<string, string> } } };
      };
      const strings = module.default.panel.options.advanced;
      for (const key of ['externalBudgetIntro', 'externalBudgetDesc', 'externalMergeDepthLabel', 'externalMergeDepthDesc']) {
        expect(strings[key]?.trim()).toBeTruthy();
      }
      expect(strings.externalMergeDepthDesc).toContain(String(EXTERNAL_FOLDER_MERGE_DEPTH_DEFAULT));
      expect(strings.externalMergeDepthDesc).toContain('0');
      expect(strings.externalBudgetDesc).toContain('0');
    });
  }
});
