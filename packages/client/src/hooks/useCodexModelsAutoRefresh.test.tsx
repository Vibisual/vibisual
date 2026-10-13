import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CODEX_MODELS_REFRESH_INTERVAL_MS, type CodexSetupState } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';
import { useCodexModelsAutoRefresh } from './useCodexModelsAutoRefresh.js';

vi.mock('../stores/graphStore.js', async () => {
  const { create: makeStore } = await import('zustand');
  return { useGraphStore: makeStore(() => ({})) };
});

const ready: CodexSetupState = { phase: 'ready', canAutoInstall: true, installCommand: '', docsUrl: '', checkedAt: 1 };
const refresh = vi.fn(async () => undefined);
let view: ReactTestRenderer | undefined;
let doc: EventTarget & { hidden: boolean };
let win: EventTarget;

function Probe(): null { useCodexModelsAutoRefresh(); return null; }

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  doc = Object.assign(new EventTarget(), { hidden: false });
  win = Object.assign(new EventTarget(), { setInterval, clearInterval });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  useGraphStore.setState({ codexSetup: ready, refreshCodexModels: refresh });
});

afterEach(async () => {
  await act(async () => { view?.unmount(); });
  view = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('refreshes automatically when ready, at the interval and on focus, using server freshness', async () => {
  useGraphStore.setState({ codexSetup: { ...ready, phase: 'missing' } });
  await act(async () => { view = create(createElement(Probe)); });
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => { useGraphStore.setState({ codexSetup: ready }); });
  expect(refresh).toHaveBeenCalledWith(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(CODEX_MODELS_REFRESH_INTERVAL_MS); });
  expect(refresh).toHaveBeenCalledTimes(2);
  await act(async () => { win.dispatchEvent(new Event('focus')); });
  expect(refresh).toHaveBeenCalledTimes(3);
});

it('skips hidden windows, refreshes on return, and removes listeners and timers on unmount', async () => {
  doc.hidden = true;
  await act(async () => { view = create(createElement(Probe)); });
  await act(async () => { await vi.advanceTimersByTimeAsync(CODEX_MODELS_REFRESH_INTERVAL_MS); });
  expect(refresh).not.toHaveBeenCalled();
  doc.hidden = false;
  await act(async () => { doc.dispatchEvent(new Event('visibilitychange')); });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => { view?.unmount(); });
  view = undefined;
  await act(async () => {
    win.dispatchEvent(new Event('focus'));
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(CODEX_MODELS_REFRESH_INTERVAL_MS);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
});
