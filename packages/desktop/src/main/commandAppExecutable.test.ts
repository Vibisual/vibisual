import { describe, expect, it, vi } from 'vitest';
import { findCommandExecutable, normalizeCommandExecutable, type CommandExecutableContext } from './commandAppExecutable';
import { COMMAND_APP_ICON_LIMITS as LIMITS } from './commandAppIconConfig';

function context(platform: NodeJS.Platform, files: Record<string, number> = {}): CommandExecutableContext {
  return {
    platform, env: {}, knownDirs: [],
    realpath: vi.fn(async (file: string) => {
      if (file in files) return file;
      throw new Error('missing');
    }),
    stat: vi.fn(async (file: string) => ({ isFile: () => true, mode: files[file] ?? 0o755 })),
  };
}

describe('command executable boundaries', () => {
  it.each(['\\\\server\\share\\app.exe', '//server/share/app.exe', '\\\\?\\C:\\app.exe', 'https://host/app.exe',
    'file:///C:/app.exe', 'C:relative.exe', 'C:/app.exe:stream', '../app.exe', 'app.exe --secret', 'app\n.exe',
    '\\rooted.exe', 'nul.exe', 'C:/nul.exe', '.', '..', '', 'x'.repeat(LIMITS.maxPathChars + 1)])('rejects %s without filesystem work', async (input) => {
    const ctx = context('win32');
    expect(normalizeCommandExecutable(input, ctx.platform)).toBeNull();
    expect(await findCommandExecutable(input, ctx)).toBeNull();
    expect(ctx.realpath).not.toHaveBeenCalled();
    expect(ctx.stat).not.toHaveBeenCalled();
  });

  it('normalizes local Windows and Git Bash paths with spaces and Unicode', () => {
    expect(normalizeCommandExecutable('C:/Program Files/엔진/App.exe', 'win32')).toBe('C:\\Program Files\\엔진\\App.exe');
    expect(normalizeCommandExecutable('/c/Program Files/엔진/App.exe', 'win32')).toBe('c:\\Program Files\\엔진\\App.exe');
  });

  it('resolves Windows names in PATH without invoking a shell', async () => {
    const ctx = context('win32', { 'C:\\Tools\\engine.exe': 0 });
    ctx.env = { Path: '\\\\network\\tools;.;C:\\Tools' };
    expect(await findCommandExecutable('engine', ctx)).toBe('C:\\Tools\\engine.exe');
    expect(ctx.realpath).toHaveBeenCalledTimes(1);
  });

  it('uses known macOS locations omitted from Finder PATH', async () => {
    const ctx = context('darwin', { '/opt/homebrew/bin/blender': 0o755 });
    ctx.env = { PATH: '/usr/bin:/bin' };
    ctx.knownDirs = ['/opt/homebrew/bin'];
    expect(await findCommandExecutable('blender', ctx)).toBe('/opt/homebrew/bin/blender');
  });

  it('preserves Linux case and requires executable mode', async () => {
    const ctx = context('linux', { '/tools/Engine': 0o755, '/tools/engine': 0o644 });
    ctx.env = { PATH: '/tools' };
    expect(await findCommandExecutable('Engine', ctx)).toBe('/tools/Engine');
    expect(await findCommandExecutable('engine', ctx)).toBeNull();
  });

  it('ignores directories, unsupported Windows extensions, and network symlink targets', async () => {
    const ctx = context('win32', { 'C:\\app.exe': 0 });
    ctx.stat = vi.fn(async () => ({ isFile: () => false, mode: 0 }));
    expect(await findCommandExecutable('C:/app.exe', ctx)).toBeNull();
    expect(await findCommandExecutable('C:/app.png', ctx)).toBeNull();
    ctx.realpath = vi.fn(async () => '\\\\server\\share\\app.exe');
    vi.mocked(ctx.stat).mockClear();
    expect(await findCommandExecutable('C:/app.exe', ctx)).toBeNull();
    expect(ctx.stat).not.toHaveBeenCalled();
  });

  it('bounds PATH probes and stops once the caller expires', async () => {
    const ctx = context('linux');
    ctx.env = { PATH: Array.from({ length: 1000 }, (_, i) => `/dir${i}`).join(':') };
    ctx.knownDirs = Array.from({ length: 100 }, (_, i) => `/fallback${i}`);
    expect(await findCommandExecutable('missing', ctx)).toBeNull();
    expect(ctx.realpath).toHaveBeenCalledTimes(LIMITS.maxPathDirs);
    vi.mocked(ctx.realpath!).mockClear();
    expect(await findCommandExecutable('missing', ctx, () => true)).toBeNull();
    expect(ctx.realpath).not.toHaveBeenCalled();
  });
});
