import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitStatusCard } from './GitStatusCard.js';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn<() => Promise<boolean>>(),
  alert: vi.fn<() => Promise<void>>(),
  fetch: vi.fn<typeof fetch>(),
  state: { gitRefreshing: {}, setGitRefreshing: vi.fn() },
  t: (key: string) => key,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('../../stores/graphStore.js', () => ({
  useGraphStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}));
vi.mock('../../utils/appDialog.js', () => ({ confirmDialog: mocks.confirm, alertDialog: mocks.alert }));

let view: ReactTestRenderer | undefined;
let answer: (confirmed: boolean) => void;

function initButton() {
  return view!.root.findAllByType('button').find((button) => !button.props.title)!;
}
function initCalls() {
  return mocks.fetch.mock.calls.filter(([url]) => url === '/api/git-init');
}
async function mount() {
  await act(async () => { view = create(<GitStatusCard projectName="first" />); });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirm.mockImplementation(() => new Promise<boolean>((resolve) => { answer = resolve; }));
  mocks.alert.mockResolvedValue(undefined);
  mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ case: 'not-repo' })));
  vi.stubGlobal('fetch', mocks.fetch);
});
afterEach(() => {
  act(() => view?.unmount());
  view = undefined;
  vi.unstubAllGlobals();
});

describe('Git initialization app dialogs', () => {
  it('waits for confirmation and ignores repeated clicks while the dialog is pending', async () => {
    await mount();
    act(() => { initButton().props.onClick(); initButton().props.onClick(); });
    expect(initCalls()).toHaveLength(0);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(initButton().props.disabled).toBe(true);
    await act(async () => { answer(true); });
    expect(initCalls()).toHaveLength(1);
    expect(JSON.parse(String(initCalls()[0]![1]?.body))).toEqual({ projectName: 'first' });
  });

  it('cancels without initializing and allows another attempt', async () => {
    await mount();
    act(() => initButton().props.onClick());
    await act(async () => { answer(false); });
    expect(initCalls()).toHaveLength(0);
    expect(initButton().props.disabled).toBe(false);
    act(() => initButton().props.onClick());
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
    await act(async () => { answer(false); });
  });

  it('does not initialize a stale project after switching away and back', async () => {
    await mount();
    act(() => initButton().props.onClick());
    await act(async () => { view!.update(<GitStatusCard projectName="second" />); });
    await act(async () => { view!.update(<GitStatusCard projectName="first" />); });
    await act(async () => { answer(true); });
    expect(initCalls()).toHaveLength(0);
  });

  it('shows a failed initialization in the app alert dialog', async () => {
    await mount();
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'failed', stderr: 'details' }), { status: 500 }));
    act(() => initButton().props.onClick());
    await act(async () => { answer(true); });
    expect(mocks.alert).toHaveBeenCalledWith('panel.gitStatus.initFailed\nfailed\ndetails', { tone: 'danger' });
    expect(initButton().props.disabled).toBe(false);
  });
});
