import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMicSettings, type MicSettingsHandle } from './useMicSettings.js';

let view: ReactTestRenderer | undefined;
let handle: MicSettingsHandle;
const fetchMock = vi.fn<typeof fetch>();

function Probe(): null {
  handle = useMicSettings();
  return null;
}

afterEach(async () => {
  await act(async () => { view?.unmount(); });
  view = undefined;
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('microphone settings belong to the device recording audio', () => {
  it.each([
    ['iPhone Safari', { platform: 'iPhone', userAgent: 'iPhone Safari', maxTouchPoints: 5 }, 'Ios'],
    ['iPad desktop browsing', { platform: 'MacIntel', userAgent: 'Macintosh Safari', maxTouchPoints: 5 }, 'Ios'],
    ['Android Chrome', { platform: 'Linux armv8l', userAgent: 'Linux; Android 16 Chrome' }, 'Android'],
    ['Android platform hint', { platform: 'Linux', userAgent: '', userAgentData: { platform: 'Android' } }, 'Android'],
    ['Windows browser', { platform: 'Win32', userAgent: 'Windows Chrome' }, 'Browser'],
    ['macOS browser', { platform: 'MacIntel', userAgent: 'Macintosh Safari', maxTouchPoints: 0 }, 'Browser'],
    ['Linux browser', { platform: 'Linux x86_64', userAgent: 'Linux Firefox' }, 'Browser'],
  ])('%s never opens microphone settings on the server PC', async (_name, navigatorStub, hint) => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', navigatorStub);
    // Even if the server can open Windows settings, that is unrelated to this browser's mic.
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      ok: true, openable: true, hintKey: 'ide.mainArea.voiceMicSettingsHintWin',
    })));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { view = create(<Probe />); });
    expect(handle.hintKey).toBe(`ide.mainArea.voiceMicSettingsHint${hint}`);
    expect(handle.openable).toBe(false);
    await expect(handle.open()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves OS settings access inside the desktop shell', async () => {
    vi.stubGlobal('window', { api: {} });
    vi.stubGlobal('navigator', { platform: 'Win32' });
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      ok: true, openable: true, hintKey: 'ide.mainArea.voiceMicSettingsHintWin',
    })));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { view = create(<Probe />); });
    expect(handle.openable).toBe(true);
    expect(handle.hintKey).toBe('ide.mainArea.voiceMicSettingsHintWin');
    await expect(handle.open()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/mic-settings');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/mic-settings/open', { method: 'POST' });
  });
});
