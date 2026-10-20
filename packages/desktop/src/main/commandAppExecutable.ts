import { realpath, stat } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { pathKey } from '@vibisual/shared';
import { COMMAND_APP_ICON_LIMITS as LIMITS } from './commandAppIconConfig';

const WINDOWS_EXTENSIONS = ['.exe', '.com', '.cmd', '.bat', '.ps1'];
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;

export interface CommandExecutableContext {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** Supplied by the existing binLocator knownBinDirs table; never spawn a shell for icons. */
  knownDirs: readonly string[];
  stat?: (file: string) => Promise<{ isFile(): boolean; mode: number }>;
  realpath?: (file: string) => Promise<string>;
}

/** Reject UNC, devices and URL schemes before touching the filesystem. */
function localAbsolutePath(value: string, platform: NodeJS.Platform): string | null {
  if (!value || value.length > LIMITS.maxPathChars || /[\x00-\x1f\x7f]/.test(value) || /^[\\/]{2}/.test(value)) return null;
  if (platform === 'win32') {
    // Git Bash reports drive paths in this form. A lone rooted path still depends on cwd.
    const local = value.replace(/^\/([a-z])\//i, '$1:/');
    if (!/^[a-z]:[\\/]/i.test(local) || /[:<>"|?*]/.test(local.slice(2))) return null;
    if (local.slice(3).split(/[\\/]/).some((part) => WINDOWS_DEVICE.test(part))) return null;
    return win32.normalize(local);
  }
  return posix.isAbsolute(value) && !value.includes('\\') ? posix.normalize(value) : null;
}

/** One executable token, not a command line. Relative paths require cwd and are deliberately unresolved. */
export function normalizeCommandExecutable(value: unknown, platform: NodeJS.Platform): string | null {
  if (typeof value !== 'string' || value.length > LIMITS.maxPathChars) return null;
  const text = value.trim();
  if (/[\x00-\x1f\x7f]/.test(value)) return null;
  const absolute = localAbsolutePath(text, platform);
  if (absolute) return absolute;
  if (!/^[\p{L}\p{N}_.+-]+$/u.test(text) || text === '.' || text === '..') return null;
  if (platform === 'win32' && WINDOWS_DEVICE.test(text)) return null;
  return text;
}

function candidateDirectories(ctx: CommandExecutableContext): string[] {
  const pathValue = ctx.env.PATH ?? ctx.env.Path ?? ctx.env.path ?? '';
  const fromPath = pathValue.slice(0, LIMITS.maxPathEnvChars).split(ctx.platform === 'win32' ? ';' : ':', LIMITS.maxPathDirs);
  const dirs: string[] = [];
  const seen = new Set<string>();
  // Reserve room for known locations even when a Finder environment or long PATH omits them.
  const fallbacks = ctx.knownDirs.slice(0, LIMITS.maxPathDirs / 2);
  for (const raw of [...fromPath.slice(0, LIMITS.maxPathDirs - fallbacks.length), ...fallbacks]) {
    const dir = localAbsolutePath(raw.trim().replace(/^"(.*)"$/, '$1'), ctx.platform);
    if (!dir) continue;
    const key = pathKey(dir, ctx.platform);
    if (!seen.has(key)) { seen.add(key); dirs.push(dir); }
  }
  return dirs;
}

/** Bounded asynchronous probes. Never execute the token, scan directories, or invoke `where`/`which`. */
export async function findCommandExecutable(
  executable: string, ctx: CommandExecutableContext, canceled: () => boolean = () => false,
): Promise<string | null> {
  const p = ctx.platform === 'win32' ? win32 : posix;
  const input = normalizeCommandExecutable(executable, ctx.platform);
  if (!input) return null;
  const ext = p.extname(input).toLowerCase();
  if (ctx.platform === 'win32' && ext && !WINDOWS_EXTENSIONS.includes(ext)) return null;
  const names = ctx.platform === 'win32' && !ext ? WINDOWS_EXTENSIONS.map((suffix) => input + suffix) : [input];
  const candidates = p.isAbsolute(input) ? names : candidateDirectories(ctx).flatMap((dir) => names.map((name) => p.join(dir, name)));
  const readStat = ctx.stat ?? stat;
  const readRealpath = ctx.realpath ?? realpath;
  for (const candidate of candidates) {
    if (canceled()) return null;
    try {
      // Symlinks may resolve outside the local path namespace. Reject before asking Electron for an icon.
      const resolved = localAbsolutePath(await readRealpath(candidate), ctx.platform);
      if (!resolved || canceled()) continue;
      const info = await readStat(resolved);
      if (info.isFile() && (ctx.platform === 'win32' || (info.mode & 0o111) !== 0)) return resolved;
    } catch { /* A missing/unreadable candidate is normal; the next bounded candidate may exist. */ }
  }
  return null;
}
