import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioProviderDraft } from '@vibisual/audio';
import { useSoundProviders } from './useSoundProviders.js';

let view: ReactTestRenderer | undefined;
let handle: ReturnType<typeof useSoundProviders>;
const fetchMock = vi.fn<typeof fetch>();
const provider: AudioProviderDraft = { id: 'future', name: 'Future model', kind: 'api',
  endpoint: 'https://provider.example.test/v1', model: 'example', capabilities: ['generate'] };
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status });
function Probe({ project }: { project: string }): null { handle = useSoundProviders(project); return null; }
async function render(project: string): Promise<void> {
  await act(async () => {
    // Matches SoundConnections: each project owns a separate state lifetime.
    const element = <Probe key={project} project={project} />;
    if (view) view.update(element); else view = create(element);
  });
}
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(async () => { await act(async () => { view?.unmount(); }); view = undefined; vi.unstubAllGlobals(); });

describe('Vibisound connection drafts', () => {
  it('round-trips descriptions through local settings without calling a provider endpoint', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true, settings: { providers: [] }, active: false }))
      .mockResolvedValueOnce(json({ ok: true, settings: { providers: [provider] }, active: false }));
    await render('/project one');
    act(() => handle.setProviders([provider]));
    expect(handle.dirty).toBe(true);
    await act(async () => { await handle.save(); });
    expect(handle.status).toBe('saved');
    expect(handle.dirty).toBe(false);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/app/vibisound/settings?project=%2Fproject%20one', '/api/app/vibisound/settings',
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ project: '/project one', settings: { providers: [provider] } });
  });
  it('does not overwrite unknown settings after a failed load and retains drafts after a failed save', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'failed' }, 500));
    await render('/failed');
    expect(handle.status).toBe('loadFailed');
    await act(async () => { await handle.save(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(json({ ok: true, settings: { providers: [provider] } }))
      .mockResolvedValueOnce(json({ error: 'invalid-settings' }, 400));
    await act(async () => handle.retry());
    act(() => handle.setProviders([{ ...provider, name: 'Changed' }]));
    await act(async () => { await handle.save(); });
    expect(handle.status).toBe('saveFailed');
    expect(handle.providers[0]?.name).toBe('Changed');
    expect(handle.dirty).toBe(true);
  });
  it('ignores an old project load that arrives after switching projects', async () => {
    let resolve!: (response: Response) => void;
    const old = new Promise<Response>((done) => { resolve = done; });
    fetchMock.mockReturnValueOnce(old).mockResolvedValueOnce(json({ ok: true, settings: { providers: [] } }));
    await render('/old');
    await render('/new');
    await act(async () => resolve(json({ ok: true, settings: { providers: [provider] } })));
    expect(handle.providers).toEqual([]);
    expect(handle.status).toBe('ready');
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
