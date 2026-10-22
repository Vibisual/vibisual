import { posix } from 'node:path';
import { COMMAND_APP_ICON_LIMITS as LIMITS } from './commandAppIconConfig';

/**
 * freedesktop icon lookup for a Linux executable. Electron's getFileIcon only knows MIME types there —
 * every executable gets "application-x-executable" — so the app's own picture comes from its Desktop
 * Entry `Icon=` key and the hicolor icon theme (Desktop Entry / Icon Theme specifications). Only fixed
 * candidate paths are probed — no directory is listed — and the number of probes is capped.
 */

const NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
/** Launchers whose real path names the launcher, not the app (`/snap/bin/blender` → `/usr/bin/snap`). */
const LAUNCHERS = new Set(['snap', 'flatpak', 'env']);
const THEME_SIZES = ['64x64', '128x128', '256x256', '48x48'];

export interface LinuxIconContext {
  env: NodeJS.ProcessEnv;
  home: string;
  isFile(file: string): Promise<boolean>;
  /** File text, or null when missing, unreadable or larger than `maxBytes`. */
  readText(file: string, maxBytes: number): Promise<string | null>;
}

/** Desktop-entry ids / icon names to try, from the command as written and its resolved path. */
export function linuxIconNames(...paths: readonly string[]): string[] {
  const names: string[] = [];
  for (const path of paths) {
    const base = posix.basename(path);
    for (const name of [base, base.toLowerCase()]) {
      if (NAME.test(name) && !LAUNCHERS.has(name) && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

/** XDG data directories in lookup order (user first), plus flatpak exports missing from XDG_DATA_DIRS. */
export function xdgDataDirs(env: NodeJS.ProcessEnv, home: string): string[] {
  const usable = (dir: string | undefined): dir is string => !!dir && posix.isAbsolute(dir) && !/[\x00-\x1f]/.test(dir);
  const dataHome = usable(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : posix.join(home, '.local/share');
  const listed = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':');
  const result: string[] = [];
  for (const dir of [dataHome, ...listed, posix.join(home, '.local/share/flatpak/exports/share'), '/var/lib/flatpak/exports/share']) {
    if (!usable(dir)) continue;
    const normalized = posix.normalize(dir).replace(/(.)\/$/, '$1');
    if (!result.includes(normalized)) result.push(normalized);
    if (result.length >= LIMITS.maxXdgDataDirs) break;
  }
  return result;
}

/** `Icon=` of the `[Desktop Entry]` group; localized `Icon[xx]=` keys are not the app icon. */
export function desktopEntryIcon(text: string): string | null {
  let inEntry = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inEntry = line === '[Desktop Entry]';
      continue;
    }
    if (!inEntry) continue;
    const match = /^Icon\s*=\s*(.*)$/.exec(line);
    if (match) return match[1]!.trim() || null;
  }
  return null;
}

/** Path of a PNG/SVG icon for the first name that resolves, or null. */
export async function findLinuxAppIcon(names: readonly string[], ctx: LinuxIconContext, canceled: () => boolean): Promise<string | null> {
  if (!names.length) return null;
  const dataDirs = xdgDataDirs(ctx.env, ctx.home);
  let probes = 0;
  const allowed = (): boolean => !canceled() && probes < LIMITS.maxLinuxIconProbes;
  const exists = async (file: string): Promise<boolean> => {
    if (!allowed()) return false;
    probes += 1;
    return ctx.isFile(file);
  };

  const iconNames: string[] = [];
  for (const name of names) {
    const entries = [
      ...dataDirs.map((dir) => `${dir}/applications/${name}.desktop`),
      `/var/lib/snapd/desktop/applications/${name}_${name}.desktop`,
    ];
    for (const entry of entries) {
      if (!allowed()) return null;
      probes += 1;
      const text = await ctx.readText(entry, LIMITS.maxDesktopEntryBytes);
      if (text === null) continue;
      const icon = desktopEntryIcon(text);
      if (icon && posix.isAbsolute(icon)) {
        const file = posix.normalize(icon);
        if (/\.(?:png|svg)$/i.test(file) && !/[\x00-\x1f]/.test(file) && await exists(file)) return file;
      } else if (icon && NAME.test(icon) && !iconNames.includes(icon)) {
        iconNames.push(icon);
      }
      // The first entry with this id is the one the desktop uses; later ones are shadowed.
      break;
    }
  }
  for (const name of names) if (!iconNames.includes(name)) iconNames.push(name);

  const themeRoots = [posix.join(ctx.home, '.icons'), ...dataDirs.map((dir) => `${dir}/icons`)];
  for (const icon of iconNames) {
    for (const root of themeRoots) {
      for (const size of THEME_SIZES) {
        const file = `${root}/hicolor/${size}/apps/${icon}.png`;
        if (await exists(file)) return file;
      }
      const scalable = `${root}/hicolor/scalable/apps/${icon}.svg`;
      if (await exists(scalable)) return scalable;
    }
    for (const ext of ['png', 'svg']) {
      const file = `/usr/share/pixmaps/${icon}.${ext}`;
      if (await exists(file)) return file;
    }
    if (!allowed()) return null;
  }
  return null;
}
