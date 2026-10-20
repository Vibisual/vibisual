import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import type { SpawnOptions } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn<(command: string, args: string[], options: SpawnOptions) => FakeChild>(),
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('./binLocator.js', () => ({ resolveBinary: vi.fn() }));

type FakeChild = EventEmitter & { unref: ReturnType<typeof vi.fn> };
const children: FakeChild[] = [];
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;

async function launcher(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
  vi.resetModules();
  const module = await import('./editorLauncher.js');
  // Only module initialization needs the simulated OS. Restore the host platform
  // before filesystem/URL handling, so tests catch accidental host dependencies.
  Object.defineProperty(process, 'platform', platformDescriptor);
  return module;
}

function existingPath(isDirectory: boolean): void {
  vi.spyOn(fs, 'existsSync').mockReturnValue(true);
  vi.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => isDirectory } as fs.Stats);
}

function powershellScript(): string {
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  const [command, args, options] = mocks.spawn.mock.calls[0]!;
  expect(command).toBe('powershell.exe');
  expect(options).toMatchObject({ windowsHide: true, stdio: 'ignore' });
  const encodedIndex = args.indexOf('-EncodedCommand');
  expect(encodedIndex).toBeGreaterThanOrEqual(0);
  return Buffer.from(args[encodedIndex + 1]!, 'base64').toString('utf16le');
}

function powershellLiteral(script: string, variable: string): string | undefined {
  const prefix = `$${variable}=`;
  const expression = script.split('\n').find((line) => line.startsWith(prefix))?.slice(prefix.length);
  const match = expression?.match(/^\[Text\.Encoding\]::UTF8\.GetString\(\[Convert\]::FromBase64String\('([A-Za-z0-9+/=]+)'\)\)$/);
  return match?.[1] ? Buffer.from(match[1], 'base64').toString('utf8') : undefined;
}

beforeEach(() => {
  children.length = 0;
  mocks.spawn.mockReset();
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    children.push(child);
    return child;
  });
});

afterEach(() => {
  Object.defineProperty(process, 'platform', platformDescriptor);
  vi.restoreAllMocks();
});

describe('openFolder — Windows file selection', () => {
  it('retains the complete file path and quotes it for Explorer, including special characters', async () => {
    const { openFolder } = await launcher('win32');
    existingPath(false);
    openFolder("C:/workspace/팀 문서/O'Brien, 보고서 #100%.txt");

    const script = powershellScript();
    expect(powershellLiteral(script, 'target')).toBe("C:\\workspace\\팀 문서\\O'Brien, 보고서 #100%.txt");
    expect(powershellLiteral(script, 'folder')).toBe('C:\\workspace\\팀 문서');
    expect(powershellLiteral(script, 'itemName')).toBe("O'Brien, 보고서 #100%.txt");
    expect(script).toContain('$select=$true');
    expect(script).toContain(`$explorerArgs='/select,"'+$target+'"'`);
    expect(script).toContain('Start-Process explorer.exe -ArgumentList $explorerArgs');
    expect(fs.statSync).toHaveBeenCalledWith("C:\\workspace\\팀 문서\\O'Brien, 보고서 #100%.txt");
    expect(children[0]!.unref).toHaveBeenCalledOnce();
  });

  it('matches the containing folder and selects, scrolls to, and focuses the item in an existing window', async () => {
    const { openFolder } = await launcher('win32');
    existingPath(false);
    openFolder('\\\\fileserver\\shared folder\\report.txt');

    const script = powershellScript();
    expect(powershellLiteral(script, 'target')).toBe('\\\\fileserver\\shared folder\\report.txt');
    expect(powershellLiteral(script, 'folder')).toBe('\\\\fileserver\\shared folder\\');
    expect(script).toMatch(/\$p\.TrimEnd\([^\n]+-ieq \$folder\.TrimEnd\(/);
    expect(script).toContain('Folder.ParseName($itemName)');
    expect(script).toMatch(/SelectItem\(\$item,\s*29\)/);
    expect(script).toContain('[VbFg]::Force($hwnd)');
  });

  it('preserves smart quotes and command-like filename text as data outside the PowerShell source', async () => {
    const { openFolder } = await launcher('win32');
    existingPath(false);
    const folder = 'C:/workspace/O’Brien';
    const name = "report’; Write-Output 'reveal-test-sentinel'; #.txt";
    openFolder(`${folder}/${name}`);

    const script = powershellScript();
    expect(powershellLiteral(script, 'target')).toBe(`C:\\workspace\\O’Brien\\${name}`);
    expect(powershellLiteral(script, 'folder')).toBe('C:\\workspace\\O’Brien');
    expect(powershellLiteral(script, 'itemName')).toBe(name);
    expect(script).not.toContain('O’Brien');
    expect(script).not.toContain(name);
    expect(script).not.toContain('Write-Output');
    expect(script).not.toContain('reveal-test-sentinel');
    expect(script).toContain('$select=$true');
  });

  it('opens a folder itself without enabling file selection', async () => {
    const { openFolder } = await launcher('win32');
    existingPath(true);
    openFolder('C:/workspace/team folder');

    const script = powershellScript();
    expect(powershellLiteral(script, 'folder')).toBe('C:\\workspace\\team folder');
    expect(script).toContain('$select=$false');
    expect(script).toContain(`$explorerArgs='"'+$folder+'"'`);
  });

  it('opens the parent without selecting an inaccessible file', async () => {
    const { openFolder } = await launcher('win32');
    existingPath(false);
    vi.mocked(fs.statSync).mockImplementation(() => { throw new Error('EACCES'); });
    openFolder('C:/workspace/team folder/report.txt');

    const script = powershellScript();
    expect(powershellLiteral(script, 'folder')).toBe('C:\\workspace\\team folder');
    expect(script).toContain('$select=$false');
  });
});

describe('openFolder — macOS Finder', () => {
  it('reveals the original file using open -R with one intact path argument', async () => {
    const { openFolder } = await launcher('darwin');
    existingPath(false);
    const file = "/workspace/팀 문서/O'Brien, report #100%.txt";
    openFolder(file);

    expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith('open', ['-R', file], {
      detached: true, stdio: 'ignore',
    });
    expect(children[0]!.unref).toHaveBeenCalledOnce();
  });

  it('opens a directory itself without the reveal flag', async () => {
    const { openFolder } = await launcher('darwin');
    existingPath(true);
    openFolder('/workspace/team folder');

    expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith('open', ['/workspace/team folder'], {
      detached: true, stdio: 'ignore',
    });
  });
});

describe('openFolder — Linux file managers', () => {
  it('requests exactly one URI with escaped spaces, Unicode, hash, percent, and comma', async () => {
    const { openFolder } = await launcher('linux');
    existingPath(false);
    openFolder("/workspace/팀 문서/O'Brien, report #100%.txt");

    expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith('dbus-send', [
      '--session', '--print-reply', '--reply-timeout=3000',
      '--dest=org.freedesktop.FileManager1', '/org/freedesktop/FileManager1',
      'org.freedesktop.FileManager1.ShowItems',
      "array:string:file:///workspace/%ED%8C%80%20%EB%AC%B8%EC%84%9C/O'Brien%2C%20report%20%23100%25.txt",
      'string:',
    ], { detached: true, stdio: 'ignore' });
    children[0]!.emit('close', 0);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(children[0]!.unref).toHaveBeenCalledOnce();
  });

  it('opens only the containing folder when FileManager1 reports failure', async () => {
    const { openFolder } = await launcher('linux');
    existingPath(false);
    openFolder('/workspace/team folder/report.txt');
    children[0]!.emit('close', 1);

    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.spawn).toHaveBeenLastCalledWith('xdg-open', ['/workspace/team folder'], {
      detached: true, stdio: 'ignore',
    });
    expect(children[1]!.unref).toHaveBeenCalledOnce();
  });

  it('falls back once when a missing dbus-send emits error followed by close', async () => {
    const { openFolder } = await launcher('linux');
    existingPath(false);
    openFolder('/workspace/team folder/report.txt');
    const dbus = children[0]!;
    dbus.emit('error', Object.assign(new Error('dbus-send missing'), { code: 'ENOENT' }));
    dbus.emit('close', -2);

    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.spawn).toHaveBeenLastCalledWith('xdg-open', ['/workspace/team folder'], {
      detached: true, stdio: 'ignore',
    });
  });

  it('falls back if the file-manager request is terminated by a signal', async () => {
    const { openFolder } = await launcher('linux');
    existingPath(false);
    openFolder('/workspace/report.txt');
    children[0]!.emit('close', null, 'SIGTERM');

    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.spawn.mock.calls[1]?.slice(0, 2)).toEqual(['xdg-open', ['/workspace']]);
  });

  it('opens directories directly without invoking D-Bus', async () => {
    const { openFolder } = await launcher('linux');
    existingPath(true);
    openFolder('/workspace/team folder');

    expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith('xdg-open', ['/workspace/team folder'], {
      detached: true, stdio: 'ignore',
    });
  });
});

describe.each(['darwin', 'linux'] as const)('openFolder — %s unavailable paths', (platform) => {
  it('opens the parent without revealing a file when stat fails', async () => {
    const { openFolder } = await launcher(platform);
    existingPath(false);
    vi.mocked(fs.statSync).mockImplementation(() => { throw new Error('EACCES'); });
    openFolder('/workspace/team folder/report.txt');

    expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith(
      platform === 'darwin' ? 'open' : 'xdg-open',
      ['/workspace/team folder'],
      { detached: true, stdio: 'ignore' },
    );
  });

  it('retains ordinary open behavior for a path whose existence is unknown', async () => {
    const { openFolder } = await launcher(platform);
    existingPath(false);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    openFolder('/workspace/unknown');

    expect(fs.statSync).not.toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith(
      platform === 'darwin' ? 'open' : 'xdg-open',
      ['/workspace/unknown'],
      { detached: true, stdio: 'ignore' },
    );
  });
});
