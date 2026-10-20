import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandAppIcon } from './CommandAppIcon.js';
import { getCommandAppIcon } from '../utils/commandAppIcon.js';

vi.mock('../utils/commandAppIcon.js', () => ({ getCommandAppIcon: vi.fn(async () => 'data:image/png;base64,aGVsbG8=') }));
let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => { renderer?.unmount(); });
  renderer = undefined;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

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
