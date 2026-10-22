import { describe, expect, it, vi } from 'vitest';
import { COMMAND_APP_ICON_LIMITS as LIMITS } from './commandAppIconConfig';
import { desktopEntryIcon, findLinuxAppIcon, linuxIconNames, xdgDataDirs, type LinuxIconContext } from './linuxAppIcon';

const HOME = '/home/dev';

function disk(files: Record<string, string>, env: NodeJS.ProcessEnv = {}): LinuxIconContext & { isFile: ReturnType<typeof vi.fn>; readText: ReturnType<typeof vi.fn> } {
  return {
    env,
    home: HOME,
    isFile: vi.fn(async (file: string) => Object.prototype.hasOwnProperty.call(files, file)),
    readText: vi.fn(async (file: string, maxBytes: number) => {
      const text = files[file];
      return text === undefined || text.length > maxBytes ? null : text;
    }),
  };
}

const never = (): boolean => false;

describe('freedesktop lookup inputs', () => {
  it('names come from the command as written and its real path, minus launchers', () => {
    expect(linuxIconNames('/snap/bin/blender', '/usr/bin/snap')).toEqual(['blender']);
    expect(linuxIconNames('code', '/usr/share/code/bin/code')).toEqual(['code']);
    expect(linuxIconNames('/opt/UE/Engine/Binaries/Linux/UnrealEditor', '/opt/UE/Engine/Binaries/Linux/UnrealEditor')).toEqual(['UnrealEditor', 'unrealeditor']);
    expect(linuxIconNames('../x', '/usr/bin/.hidden', '/usr/bin/a b')).toEqual(['x']);
  });

  it('XDG data dirs follow the spec defaults, drop relative entries and add flatpak exports', () => {
    expect(xdgDataDirs({}, HOME)).toEqual([
      `${HOME}/.local/share`, '/usr/local/share', '/usr/share',
      `${HOME}/.local/share/flatpak/exports/share`, '/var/lib/flatpak/exports/share',
    ]);
    expect(xdgDataDirs({ XDG_DATA_HOME: 'relative', XDG_DATA_DIRS: '/usr/share/ubuntu:rel:/usr/share/:/usr/share' }, HOME)).toEqual([
      `${HOME}/.local/share`, '/usr/share/ubuntu', '/usr/share',
      `${HOME}/.local/share/flatpak/exports/share`, '/var/lib/flatpak/exports/share',
    ]);
    const many = Array.from({ length: 40 }, (_, i) => `/data/${i}`).join(':');
    expect(xdgDataDirs({ XDG_DATA_DIRS: many }, HOME)).toHaveLength(LIMITS.maxXdgDataDirs);
  });

  it('reads Icon= of the [Desktop Entry] group only, not actions or localized keys', () => {
    const entry = ['[Desktop Action new]', 'Icon=wrong', '[Desktop Entry]', 'Name=Blender', 'Icon[ko]=localized', 'Icon = blender ', 'Exec=blender %f'].join('\n');
    expect(desktopEntryIcon(entry)).toBe('blender');
    expect(desktopEntryIcon('[Desktop Entry]\r\nIcon=\r\n')).toBeNull();
    expect(desktopEntryIcon('Icon=outside-group')).toBeNull();
  });
});

describe('findLinuxAppIcon', () => {
  it('resolves the desktop entry icon name through the hicolor theme', async () => {
    const ctx = disk({
      '/usr/share/applications/blender.desktop': '[Desktop Entry]\nIcon=blender\n',
      '/usr/share/icons/hicolor/scalable/apps/blender.svg': '<svg/>',
    });
    expect(await findLinuxAppIcon(['blender'], ctx, never)).toBe('/usr/share/icons/hicolor/scalable/apps/blender.svg');
  });

  it('prefers a PNG at the target size over the scalable SVG and the user theme over the system one', async () => {
    const ctx = disk({
      '/usr/share/icons/hicolor/64x64/apps/code.png': 'png',
      '/usr/share/icons/hicolor/scalable/apps/code.svg': '<svg/>',
      [`${HOME}/.local/share/icons/hicolor/128x128/apps/code.png`]: 'png',
    });
    expect(await findLinuxAppIcon(['code'], ctx, never)).toBe(`${HOME}/.local/share/icons/hicolor/128x128/apps/code.png`);
  });

  it('a user desktop entry shadows the system one, and an absolute Icon= path is used directly', async () => {
    const ctx = disk({
      [`${HOME}/.local/share/applications/godot.desktop`]: '[Desktop Entry]\nIcon=/opt/godot/icon.png\n',
      '/usr/share/applications/godot.desktop': '[Desktop Entry]\nIcon=godot\n',
      '/opt/godot/icon.png': 'png',
      '/usr/share/icons/hicolor/64x64/apps/godot.png': 'png',
    });
    expect(await findLinuxAppIcon(['godot'], ctx, never)).toBe('/opt/godot/icon.png');
  });

  it('finds snap desktop entries, which are named <snap>_<app>.desktop', async () => {
    const ctx = disk({
      '/var/lib/snapd/desktop/applications/blender_blender.desktop': '[Desktop Entry]\nIcon=/snap/blender/5000/blender.svg\n',
      '/snap/blender/5000/blender.svg': '<svg/>',
    });
    expect(await findLinuxAppIcon(linuxIconNames('/snap/bin/blender', '/usr/bin/snap'), ctx, never)).toBe('/snap/blender/5000/blender.svg');
  });

  it('falls back to /usr/share/pixmaps and returns null when nothing matches', async () => {
    expect(await findLinuxAppIcon(['inkscape'], disk({ '/usr/share/pixmaps/inkscape.png': 'png' }), never)).toBe('/usr/share/pixmaps/inkscape.png');
    expect(await findLinuxAppIcon(['git'], disk({}), never)).toBeNull();
  });

  it('ignores icon names that would leave the theme directory and non-image absolute paths', async () => {
    const ctx = disk({
      '/usr/share/applications/evil.desktop': '[Desktop Entry]\nIcon=../../../etc/passwd\n',
      '/usr/share/applications/odd.desktop': '[Desktop Entry]\nIcon=/etc/shadow\n',
      '/etc/shadow': 'secret',
    });
    expect(await findLinuxAppIcon(['evil', 'odd'], ctx, never)).toBeNull();
    expect(ctx.isFile.mock.calls.some(([file]) => String(file).includes('passwd') || file === '/etc/shadow')).toBe(false);
  });

  it('never probes more than the limit and stops as soon as the request is canceled', async () => {
    const ctx = disk({}, { XDG_DATA_DIRS: Array.from({ length: 40 }, (_, i) => `/data/${i}`).join(':') });
    const names = Array.from({ length: 20 }, (_, i) => `app${i}`);
    expect(await findLinuxAppIcon(names, ctx, never)).toBeNull();
    expect(ctx.isFile.mock.calls.length + ctx.readText.mock.calls.length).toBeLessThanOrEqual(LIMITS.maxLinuxIconProbes);
    const canceled = disk({});
    expect(await findLinuxAppIcon(['app'], canceled, () => true)).toBeNull();
    expect(canceled.isFile).not.toHaveBeenCalled();
    expect(canceled.readText).not.toHaveBeenCalled();
  });
});
