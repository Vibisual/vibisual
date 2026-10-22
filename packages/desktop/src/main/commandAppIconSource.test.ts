import { describe, expect, it, vi } from 'vitest';
import { COMMAND_APP_ICON_LIMITS as LIMITS } from './commandAppIconConfig';
import { createCommandAppIconSource, iconDataUrl, isPlainSvg, macAppBundleOf, type IconSourceDeps } from './commandAppIconSource';
import { buildPe, dibFrame, iconResources, pngFrame } from './peIcon.fixture';

const SHELL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHZkAAAAASUVORK5CYII=', 'base64');
const never = (): boolean => false;

function source(platform: NodeJS.Platform, files: Record<string, Buffer | string> = {}) {
  const shellIcon = vi.fn(async (_file: string): Promise<Buffer | null> => SHELL_PNG);
  const openFile = vi.fn(async (file: string) => {
    const data = files[file];
    if (data === undefined) throw new Error('ENOENT');
    const bytes = Buffer.from(data);
    return { size: bytes.length, read: async (offset: number, length: number) => bytes.subarray(offset, offset + length), close: vi.fn(async () => {}) };
  });
  const deps: IconSourceDeps = {
    platform,
    env: {},
    home: '/home/dev',
    shellIcon,
    openFile,
    isFile: async (file) => Object.prototype.hasOwnProperty.call(files, file),
    readBounded: async (file, maxBytes) => {
      const data = files[file];
      return data === undefined || Buffer.byteLength(data) > maxBytes ? null : Buffer.from(data);
    },
  };
  return { read: createCommandAppIconSource(deps), shellIcon, openFile };
}

describe('Windows: the executable\'s own icon group, never the generic picture', () => {
  it('reads PNG-framed icons itself instead of asking the shell (UnrealEditor.exe)', async () => {
    const png = await pngFrame(64);
    const { read, shellIcon } = source('win32', { 'C:\\UE\\UnrealEditor.exe': buildPe(iconResources([[{ size: 64, bitCount: 32, data: png }]])) });
    expect(await read({ file: 'C:\\UE\\UnrealEditor.exe', command: 'C:\\UE\\UnrealEditor.exe' }, never)).toEqual({ mime: 'image/png', data: png });
    expect(shellIcon).not.toHaveBeenCalled();
  });

  it('reports "no icon" for an executable without an icon group (git.exe) — no generic shell picture', async () => {
    const { read, shellIcon } = source('win32', { 'C:\\Git\\cmd\\git.exe': buildPe(null) });
    expect(await read({ file: 'C:\\Git\\cmd\\git.exe', command: 'git' }, never)).toBeNull();
    expect(shellIcon).not.toHaveBeenCalled();
  });

  it('never asks about scripts, which only have a file-type picture (Build.bat)', async () => {
    const { read, shellIcon, openFile } = source('win32');
    for (const file of ['C:\\UE\\Build.bat', 'C:\\npm\\npm.cmd', 'C:\\tools\\run.ps1']) {
      expect(await read({ file, command: file }, never)).toBeNull();
    }
    expect(shellIcon).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
  });

  it('leaves palette-only icons and unreadable executables to the shell', async () => {
    const palette = buildPe(iconResources([[{ size: 32, bitCount: 8, data: dibFrame(32, 8, () => [0, 0, 0, 0]) }]]));
    const { read, shellIcon } = source('win32', { 'C:\\old\\app.exe': palette });
    expect(await read({ file: 'C:\\old\\app.exe', command: 'app' }, never)).toEqual({ mime: 'image/png', data: SHELL_PNG });
    expect(await read({ file: 'C:\\WindowsApps\\python.exe', command: 'python' }, never)).toEqual({ mime: 'image/png', data: SHELL_PNG });
    expect(shellIcon.mock.calls.map(([file]) => file)).toEqual(['C:\\old\\app.exe', 'C:\\WindowsApps\\python.exe']);
  });

  it('closes the file handle after reading', async () => {
    const { read, openFile } = source('win32', { 'C:\\a.exe': buildPe(null) });
    await read({ file: 'C:\\a.exe', command: 'a' }, never);
    const handle = await openFile.mock.results[0]!.value;
    expect(handle.close).toHaveBeenCalledTimes(1);
  });
});

describe('macOS: the enclosing .app bundle', () => {
  it('finds the outermost bundle of a resolved path', () => {
    expect(macAppBundleOf('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code')).toBe('/Applications/Visual Studio Code.app');
    expect(macAppBundleOf('/Applications/Blender.app/Contents/MacOS/Blender')).toBe('/Applications/Blender.app');
    expect(macAppBundleOf('/Applications/Foo.app/Contents/Frameworks/Foo Helper.app/Contents/MacOS/Foo Helper')).toBe('/Applications/Foo.app');
    expect(macAppBundleOf('/opt/homebrew/bin/git')).toBeNull();
    expect(macAppBundleOf('/opt/backup.app.old/tool')).toBeNull();
  });

  it('asks the shell for the bundle, and reports a bare Unix executable as having no icon', async () => {
    const { read, shellIcon } = source('darwin');
    expect(await read({ file: '/Applications/Blender.app/Contents/MacOS/Blender', command: 'blender' }, never)).toEqual({ mime: 'image/png', data: SHELL_PNG });
    expect(await read({ file: '/opt/homebrew/Cellar/git/2.50/bin/git', command: 'git' }, never)).toBeNull();
    expect(await read({ file: '/UE/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor', command: 'x', bundle: '/UE/Engine/Binaries/Mac/UnrealEditor.app' }, never)).not.toBeNull();
    expect(shellIcon.mock.calls.map(([file]) => file)).toEqual(['/Applications/Blender.app', '/UE/Engine/Binaries/Mac/UnrealEditor.app']);
  });
});

describe('Linux: freedesktop icons and engine-shipped icon files', () => {
  it('returns the themed icon with its MIME type and never asks the MIME-only shell', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>';
    const { read, shellIcon } = source('linux', {
      '/usr/share/applications/blender.desktop': '[Desktop Entry]\nIcon=blender\n',
      '/usr/share/icons/hicolor/scalable/apps/blender.svg': svg,
    });
    expect(await read({ file: '/usr/bin/blender', command: 'blender' }, never)).toEqual({ mime: 'image/svg+xml', data: Buffer.from(svg) });
    expect(await read({ file: '/usr/bin/git', command: 'git' }, never)).toBeNull();
    expect(shellIcon).not.toHaveBeenCalled();
  });

  it('reads an engine-shipped icon file directly (Unreal on Linux)', async () => {
    const png = await pngFrame(64);
    const { read } = source('linux', { '/UE/Engine/Source/Runtime/Launch/Resources/Linux/UnrealEngine.png': png });
    expect(await read({ file: '/UE/Engine/Binaries/Linux/UnrealEditor', command: 'x', iconFile: '/UE/Engine/Source/Runtime/Launch/Resources/Linux/UnrealEngine.png' }, never))
      .toEqual({ mime: 'image/png', data: png });
    expect(await read({ file: '/UE/Engine/Binaries/Linux/UE4Editor', command: 'x', iconFile: '/UE/Engine/Source/Runtime/Launch/Resources/Linux/UE4.png' }, never)).toBeNull();
  });
});

describe('what reaches the renderer', () => {
  it('accepts bounded PNG and plain SVG only', async () => {
    const png = await pngFrame(8);
    expect(iconDataUrl({ mime: 'image/png', data: png })).toBe(`data:image/png;base64,${png.toString('base64')}`);
    expect(iconDataUrl({ mime: 'image/png', data: Buffer.from('not a png file') })).toBeNull();
    expect(iconDataUrl({ mime: 'image/png', data: Buffer.concat([png, Buffer.alloc(LIMITS.maxImageBytes)]) })).toBeNull();
    expect(iconDataUrl({ mime: 'image/svg+xml', data: Buffer.from('<svg viewBox="0 0 1 1"/>') })).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(iconDataUrl(null)).toBeNull();
  });

  it.each([
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"/>',
    '<svg><image href="https://example.invalid/x.png"/></svg>',
    '<svg><image xlink:href=\'file:///etc/passwd\'/></svg>',
    '<svg><rect style="fill:url(http://example.invalid/a)"/></svg>',
    '<svg><foreignObject><div/></foreignObject></svg>',
    '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>',
    '<svg><style>@import "x.css";</style></svg>',
    '<html><body>no svg</body></html>',
  ])('refuses active or external SVG: %s', (text) => {
    expect(isPlainSvg(text)).toBe(false);
  });

  it('keeps ordinary SVG features such as local references', () => {
    expect(isPlainSvg('<svg xmlns:xlink="http://www.w3.org/1999/xlink"><defs><linearGradient id="a"/></defs><use xlink:href="#a"/><use href= "#a"/><rect fill="url(#a)" style="fill: url( \'#a\' )"/></svg>')).toBe(true);
  });
});
