import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveBinary } from './binLocator.js';

interface BlenderSearchContext {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  directories(root: string): string[];
}
/** Installed executables only. Blender is separately installed, never bundled or downloaded by this feature. */
export function blenderCandidates(context: BlenderSearchContext): string[] {
  const { platform, env, home } = context;
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'darwin') return [
    '/Applications/Blender.app/Contents/MacOS/Blender',
    p.join(home, 'Applications', 'Blender.app', 'Contents', 'MacOS', 'Blender'),
  ];
  if (platform !== 'win32') return ['/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender'];
  const roots = [
    p.join(env['ProgramFiles'] ?? 'C:\\Program Files', 'Blender Foundation'),
    p.join(env['LOCALAPPDATA'] ?? p.join(home, 'AppData', 'Local'), 'Programs', 'Blender Foundation'),
  ];
  return roots.flatMap(root => context.directories(root)
    .filter(name => /^Blender\s+[\d.]+$/i.test(name))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map(name => p.join(root, name, 'blender.exe')));
}
export function findBlender(): string | null {
  if (process.env['VIBISUAL_BLENDER']) return resolveBinary(process.env['VIBISUAL_BLENDER']);
  return resolveBinary('blender', blenderCandidates({
    platform: process.platform, env: process.env, home: os.homedir(),
    directories: (root) => {
      try { return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    },
  }));
}
