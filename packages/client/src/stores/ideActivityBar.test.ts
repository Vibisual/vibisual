import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeIDEActivityBarPrefs, type IDEActivityBarPrefs } from '@vibisual/shared';
import { DEFAULT_ACTIVITY_ORDER, DEFAULT_HIDDEN_ACTIVITIES } from '../components/IDE/ideActivityItems.js';
import { selectActivityOrder, useIDEActivityBarStore } from './ideActivityBar.js';

const optionalViews = ['goal', 'autoGoal', 'orchestra', 'configTrim', 'loop', 'specReading'] as const;
const fetchMock = vi.fn<typeof fetch>();
let saved: IDEActivityBarPrefs;

beforeEach(() => {
  saved = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url, init) => {
    if (init?.method === 'PUT') {
      const patch = JSON.parse(String(init.body)) as IDEActivityBarPrefs & { reset?: boolean };
      saved = patch.reset ? {} : normalizeIDEActivityBarPrefs({ ...saved, ...patch }) ?? {};
    }
    return new Response(JSON.stringify({ prefs: saved }));
  });
  vi.stubGlobal('fetch', fetchMock);
  useIDEActivityBarStore.getState().applyPrefs({});
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('optional activity views', () => {
  it('hides exactly the six optional features before loading preferences and for an untouched layout', () => {
    expect(new Set(DEFAULT_HIDDEN_ACTIVITIES)).toEqual(new Set(optionalViews));
    expect(new Set(useIDEActivityBarStore.getInitialState().hidden)).toEqual(new Set(optionalViews));
    expect(new Set(useIDEActivityBarStore.getState().hidden)).toEqual(new Set(optionalViews));
    expect(selectActivityOrder(useIDEActivityBarStore.getState())).toEqual(DEFAULT_ACTIVITY_ORDER);
  });

  it('retains a legacy custom order and exclusions while applying the new optional defaults', () => {
    useIDEActivityBarStore.getState().applyPrefs({ order: ['bookmarks', 'files'], hidden: ['hooks', 'retired-view'] });
    const state = useIDEActivityBarStore.getState();
    expect(state.order).toEqual(['bookmarks', 'files']);
    expect(new Set(state.hidden)).toEqual(new Set([...optionalViews, 'hooks']));
    expect(selectActivityOrder(state).indexOf('bookmarks')).toBeLessThan(selectActivityOrder(state).indexOf('files'));
  });

  it.each(optionalViews)('keeps an explicit add of %s across saving and loading, then permits hiding it again', async (view) => {
    await useIDEActivityBarStore.getState().setHiddenState(view, false);
    expect(useIDEActivityBarStore.getState().hidden).not.toContain(view);
    expect(saved.shown).toContain(view);

    useIDEActivityBarStore.getState().applyPrefs({});
    expect(useIDEActivityBarStore.getState().hidden).toContain(view);
    await useIDEActivityBarStore.getState().fetchPrefs();
    expect(useIDEActivityBarStore.getState().hidden).not.toContain(view);

    await useIDEActivityBarStore.getState().setHiddenState(view, true);
    expect(useIDEActivityBarStore.getState().hidden).toContain(view);
    expect(saved.shown ?? []).not.toContain(view);
    useIDEActivityBarStore.getState().applyPrefs(saved);
    expect(useIDEActivityBarStore.getState().hidden).toContain(view);
  });

  it('preserves an all-visible choice even when the hidden list becomes empty', async () => {
    for (const view of optionalViews) await useIDEActivityBarStore.getState().setHiddenState(view, false);
    expect(useIDEActivityBarStore.getState().hidden).toEqual([]);
    expect(new Set(saved.shown)).toEqual(new Set(optionalViews));
    useIDEActivityBarStore.getState().applyPrefs({});
    await useIDEActivityBarStore.getState().fetchPrefs();
    expect(useIDEActivityBarStore.getState().hidden).toEqual([]);
  });

  it('reordering preserves visibility choices, and reset restores optional defaults', async () => {
    await useIDEActivityBarStore.getState().setHiddenState('goal', false);
    await useIDEActivityBarStore.getState().setHiddenState('bookmarks', true);
    await useIDEActivityBarStore.getState().setOrder([...DEFAULT_ACTIVITY_ORDER].reverse());
    expect(saved.shown).toContain('goal');
    expect(saved.hidden).toContain('bookmarks');
    expect(useIDEActivityBarStore.getState().hidden).not.toContain('goal');
    await useIDEActivityBarStore.getState().resetPrefs();
    expect(saved).toEqual({});
    expect(useIDEActivityBarStore.getState().order).toEqual([]);
    expect(new Set(useIDEActivityBarStore.getState().hidden)).toEqual(new Set(optionalViews));
  });

  it('applies another window’s explicit choices and discards retired view names', () => {
    useIDEActivityBarStore.getState().applyPrefs({ shown: ['goal', 'old-view'], hidden: ['hooks'] });
    expect(new Set(useIDEActivityBarStore.getState().hidden)).toEqual(new Set([...optionalViews.filter(view => view !== 'goal'), 'hooks']));
    useIDEActivityBarStore.getState().applyPrefs({ shown: ['goal'], hidden: ['goal'] });
    expect(useIDEActivityBarStore.getState().hidden).toContain('goal');
  });
});
