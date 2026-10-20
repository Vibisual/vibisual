import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationHead } from '@vibisual/shared';
import { useCreationHead } from './useCreationHead.js';

/** §5.13 (R-10) item 10 — only open, visible panels poll, and only a changed head reaches the screen. */
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./creationApi.js', () => ({ readCreationHead: mocks.read }));

const head = (revision: number, candidateStamp = 0): CreationHead => ({
  id: 'doc', appId: 'vibimage', revision, updatedAt: revision, candidateStamp, pendingCandidates: 0,
});
const seen: (CreationHead | null)[] = [];
function Probe(props: { enabled: boolean }): null {
  seen.push(useCreationHead('project', 'doc', { enabled: props.enabled, intervalMs: 1_000 }));
  return null;
}
const distinct = (): number => new Set(seen.filter((item) => item !== null)).size;
let view: ReactTestRenderer | undefined;
beforeEach(() => { vi.useFakeTimers(); seen.length = 0; mocks.read.mockReset(); });
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('(10) head polling', () => {
  it('a closed panel reads nothing; an open one polls the head and re-renders only when it changed', async () => {
    mocks.read.mockResolvedValue(head(2));
    await act(async () => { view = create(createElement(Probe, { enabled: false })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(mocks.read).not.toHaveBeenCalled();
    await act(async () => { view!.update(createElement(Probe, { enabled: true })); });
    const rendersBefore = seen.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(mocks.read.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(seen.at(-1)).toMatchObject({ revision: 2 });
    // Three polls with the same answer: one new value, no further renders.
    expect(distinct()).toBe(1);
    expect(seen.length - rendersBefore).toBeLessThanOrEqual(1);
    mocks.read.mockResolvedValue(head(3));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(seen.at(-1)).toMatchObject({ revision: 3 });
    expect(distinct()).toBe(2);
  });

  it('does not poll while the window is hidden', async () => {
    vi.stubGlobal('document', { visibilityState: 'hidden', addEventListener: vi.fn(), removeEventListener: vi.fn() });
    mocks.read.mockResolvedValue(head(2));
    await act(async () => { view = create(createElement(Probe, { enabled: true })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
