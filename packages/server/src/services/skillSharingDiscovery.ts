import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { pathKey } from '@vibisual/shared';
import type { SkillSharingEntry } from '@vibisual/shared';
import { readSkillFiles, type SkillFiles } from './skillSharingFiles.js';
import { adaptInvocationPolicy, skillCompatibility } from './skillSharingCompatibility.js';
import {
  assertUnlinkedPath, SkillSharingError, skillRoots,
  type SkillProvider, type SkillSharingContext, type SkillSharingPaths, type SkillRoot,
} from './skillSharingPaths.js';

export interface DiscoveredSkill { entry: SkillSharingEntry; tree?: SkillFiles }

export function sharingSourceId(provider: SkillProvider, scope: SkillRoot['scope'], source: string, paths: SkillSharingPaths): string {
  return createHash('sha256').update(`${provider}\0${scope}\0${pathKey(path.resolve(source), paths.platform)}`).digest('hex');
}

export function scanSharingRoot(root: SkillRoot, provider: SkillProvider, paths: SkillSharingPaths): DiscoveredSkill[] {
  try { assertUnlinkedPath(root.dir); } catch { return []; }
  let children: fs.Dirent[];
  try { children = fs.readdirSync(root.dir, { withFileTypes: true }); } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return [];
    throw err;
  }
  const entries: DiscoveredSkill[] = [];
  for (const child of children) {
    if (child.name.startsWith('.') || child.name === 'synced' || !child.isDirectory()) continue;
    const sourcePath = path.join(root.dir, child.name);
    if (!fs.existsSync(path.join(sourcePath, 'SKILL.md'))) continue;
    const entry: SkillSharingEntry = {
      id: sharingSourceId(provider, root.scope, sourcePath, paths), name: child.name, description: '',
      sourceProvider: provider, scope: root.scope, sourcePath, status: 'available', issues: [],
    };
    try {
      const tree = readSkillFiles(sourcePath);
      const check = skillCompatibility(tree, provider);
      entry.name = check.name || child.name;
      entry.description = check.description;
      entry.issues = check.issues;
      if (check.blocked) entry.status = 'unsupported';
      entries.push({ entry, tree });
    } catch (err) {
      entry.status = 'unsupported';
      entry.issues = [err instanceof SkillSharingError ? err.code : 'unreadable-source'];
      entries.push({ entry });
    }
  }
  return entries;
}

export function discoverSharingSkills(paths: SkillSharingPaths, provider: SkillProvider, context: SkillSharingContext): DiscoveredSkill[] {
  return skillRoots(paths, provider, context.projectCwd).flatMap((root) => scanSharingRoot(root, provider, paths));
}

export function preparedSkill(source: DiscoveredSkill, target: SkillProvider): SkillFiles | undefined {
  if (!source.tree || source.entry.status === 'unsupported') return undefined;
  try { return adaptInvocationPolicy(source.tree, target); } catch {
    source.entry.status = 'unsupported';
    if (!source.entry.issues.includes('invocation-policy')) source.entry.issues.push('invocation-policy');
    return undefined;
  }
}
