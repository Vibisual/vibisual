import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isPathWithin, pathKey, type PlatformName } from '@vibisual/shared';
import { codexHomeIn } from './codexCli.js';
import { hostConfigHome } from './claudeConfigHomes.js';
import { HOST_PLATFORM } from './pathKey.js';

export type SkillProvider = 'claude' | 'codex';
export interface SkillSharingContext { projectCwd: string | null; targetProvider: SkillProvider }
export interface SkillSharingOptions {
  home?: string;
  claudeHome?: string;
  codexHome?: string;
  platform?: PlatformName;
  env?: NodeJS.ProcessEnv;
}
export interface SkillRoot { dir: string; scope: 'project' | 'global' }
export interface SkillSharingPaths { home: string; claudeHome: string; codexHome: string; platform: PlatformName }

export class SkillSharingError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'SkillSharingError'; }
}

export function sharingPaths(options: SkillSharingOptions): SkillSharingPaths {
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  return {
    home: path.resolve(home),
    claudeHome: path.resolve(options.claudeHome ?? (env['CLAUDE_CONFIG_DIR']?.trim()
      || (options.home ? path.join(home, '.claude') : hostConfigHome().dir))),
    codexHome: path.resolve(options.codexHome ?? codexHomeIn(env, home)),
    platform: options.platform ?? HOST_PLATFORM,
  };
}

export function skillRoots(paths: SkillSharingPaths, provider: SkillProvider, cwd: string | null): SkillRoot[] {
  const roots: SkillRoot[] = [];
  if (cwd) {
    roots.push({ dir: path.join(cwd, provider === 'claude' ? '.claude' : '.agents', 'skills'), scope: 'project' });
    if (provider === 'codex') roots.push({ dir: path.join(cwd, '.codex', 'skills'), scope: 'project' });
  }
  roots.push({ dir: path.join(provider === 'claude' ? paths.claudeHome : paths.codexHome, 'skills'), scope: 'global' });
  if (provider === 'codex') roots.push({ dir: path.join(paths.home, '.agents', 'skills'), scope: 'global' });
  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = pathKey(root.dir, paths.platform);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function targetSkillRoot(paths: SkillSharingPaths, context: SkillSharingContext, scope: SkillRoot['scope']): string {
  const root = skillRoots(paths, context.targetProvider, context.projectCwd).find((item) => item.scope === scope);
  if (!root) throw new SkillSharingError('invalid-scope');
  return root.dir;
}

/** lstat detects Windows junctions as links too; never follow any path segment. */
export function assertUnlinkedPath(target: string): void {
  let current = path.resolve(target);
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new SkillSharingError('unsafe-path');
    } catch (err) {
      if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) throw err;
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export function assertWithinSkillRoot(root: string, target: string, platform: PlatformName): void {
  if (!isPathWithin(path.resolve(target), path.resolve(root), platform)
    || pathKey(path.resolve(target), platform) === pathKey(path.resolve(root), platform)) {
    throw new SkillSharingError('unsafe-path');
  }
  assertUnlinkedPath(target);
}

/** Portable folder names reject Windows devices/ADS even when this server runs on Linux. */
export function validSkillName(name: string): boolean {
  return /^[\p{L}\p{N}_-]{1,64}$/u.test(name) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name);
}
