import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandAppIcon } from './CommandAppIcon.js';
import { COMMAND_APP_BRAND_ICONS } from './commandAppBrandIcons.js';
import { getCommandAppIcon, peekCommandAppIcon } from '../utils/commandAppIcon.js';

vi.mock('../utils/commandAppIcon.js', () => ({
  getCommandAppIcon: vi.fn(async () => 'data:image/png;base64,aGVsbG8='),
  peekCommandAppIcon: vi.fn((): string | null | undefined => undefined),
}));
let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => { renderer?.unmount(); });
  renderer = undefined;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const sources = (): string[] => renderer!.root.findAllByType('img').map((img) => String(img.props.src));

describe('command app icon visibility', () => {
  it('renders a terminal fallback without requesting an icon when executable is absent', () => {
    act(() => { renderer = create(<CommandAppIcon />); });
    expect(renderer!.root.findAllByType('svg')).toHaveLength(1);
    expect(getCommandAppIcon).not.toHaveBeenCalled();
  });

  it('waits for visibility, requests once, and never displays the previous app icon after a target change', async () => {
    let notify: (entries: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof notify) { notify = callback; }
      observe(): void {}
      disconnect(): void {}
    });
    act(() => { renderer = create(<CommandAppIcon executable="first.exe" />, { createNodeMock: () => ({}) }); });
    expect(getCommandAppIcon).not.toHaveBeenCalled();
    act(() => { notify([{ isIntersecting: false }]); });
    expect(getCommandAppIcon).not.toHaveBeenCalled();
    await act(async () => { notify([{ isIntersecting: true }]); });
    expect(getCommandAppIcon).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findAllByType('img')).toHaveLength(1);
    act(() => { renderer!.update(<CommandAppIcon executable="second.exe" />); });
    expect(renderer!.root.findAllByType('img')).toHaveLength(0);
    expect(renderer!.root.findAllByType('svg')).toHaveLength(1);
  });
});

describe('bundled marks for commands without an icon of their own', () => {
  it('draws the official Git mark at once and never asks the desktop (git.exe carries no icon)', async () => {
    await act(async () => { renderer = create(<CommandAppIcon executable="C:/Program Files/Git/cmd/git.exe" />); });
    expect(sources()).toEqual([COMMAND_APP_BRAND_ICONS.git.dark]);
    expect(getCommandAppIcon).not.toHaveBeenCalled();
    expect(peekCommandAppIcon).not.toHaveBeenCalled();
  });

  it('picks the variant made for the background it sits on (curl)', async () => {
    await act(async () => { renderer = create(<CommandAppIcon executable="/usr/bin/curl" />); });
    expect(sources()).toEqual([COMMAND_APP_BRAND_ICONS.curl.dark]);
    await act(async () => { renderer!.update(<CommandAppIcon executable="/usr/bin/curl" tone="light" />); });
    expect(sources()).toEqual([COMMAND_APP_BRAND_ICONS.curl.light]);
    expect(COMMAND_APP_BRAND_ICONS.curl.dark).not.toBe(COMMAND_APP_BRAND_ICONS.curl.light);
  });

  it('falls back to the glyph if a bundled file fails to load', async () => {
    await act(async () => { renderer = create(<CommandAppIcon executable="pnpm.cmd" />); });
    await act(async () => { renderer!.root.findByType('img').props.onError(); });
    expect(renderer!.root.findAllByType('img')).toHaveLength(0);
    expect(renderer!.root.findAllByType('svg')).toHaveLength(1);
  });
});

describe('native icons on remount', () => {
  it('draws an already fetched icon in the first render, without the glyph and without a new request', () => {
    vi.mocked(peekCommandAppIcon).mockReturnValue('data:image/png;base64,Y2FjaGVk');
    act(() => { renderer = create(<CommandAppIcon executable="C:/UE/UnrealEditor.exe" />); });
    expect(sources()).toEqual(['data:image/png;base64,Y2FjaGVk']);
    expect(getCommandAppIcon).not.toHaveBeenCalled();
  });

  it('a remembered "no icon" answer shows the glyph without asking again', () => {
    vi.mocked(peekCommandAppIcon).mockReturnValue(null);
    act(() => { renderer = create(<CommandAppIcon executable="C:/tools/tool.exe" />); });
    expect(renderer!.root.findAllByType('img')).toHaveLength(0);
    expect(getCommandAppIcon).not.toHaveBeenCalled();
  });
});
