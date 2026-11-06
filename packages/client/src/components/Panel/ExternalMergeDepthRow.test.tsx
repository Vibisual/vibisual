import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalMergeDepthRow } from './ExternalMergeDepthRow.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key),
  }),
}));

let view: ReactTestRenderer | undefined;
const fetchMock = vi.fn<typeof fetch>();
const text = () => JSON.stringify(view!.toJSON());
const resetButton = () => view!.root.findAllByType('button')
  .find((node) => node.findAll((child) => child.children.includes('panel.externalMergeDepth.reset')).length > 0);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await act(async () => { view?.unmount(); });
  view = undefined;
  vi.unstubAllGlobals();
});

describe('external folder merge depth row', () => {
  it('shows the machine default without a reset action', async () => {
    await act(async () => { view = create(<ExternalMergeDepthRow nodeId="ext-1" depth={2} custom={false} />); });
    expect(text()).toContain('panel.externalMergeDepth.levels:{\\"depth\\":2}');
    expect(text()).toContain('panel.externalMergeDepth.defaultValue');
    expect(resetButton()).toBeUndefined();
  });

  it('shows a project value and clears it back to the default for the whole project', async () => {
    await act(async () => { view = create(<ExternalMergeDepthRow nodeId="ext-1" depth={3} custom />); });
    expect(text()).toContain('panel.externalMergeDepth.projectValue');
    await act(async () => { resetButton()!.props.onClick(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/external-folder/merge-depth');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ nodeId: 'ext-1', mergeDepth: null });
  });

  it('labels depth zero as merging off', async () => {
    await act(async () => { view = create(<ExternalMergeDepthRow nodeId="ext-1" depth={0} custom />); });
    expect(text()).toContain('panel.externalMergeDepth.off');
  });
});
