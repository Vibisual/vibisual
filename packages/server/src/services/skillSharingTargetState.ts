import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathKey } from '@vibisual/shared';
import { readCodexConfiguredSkills } from './codexContextSources.js';
import { assertUnlinkedPath, type SkillSharingContext, type SkillSharingPaths } from './skillSharingPaths.js';

/** Command filenames are invocation names; their frontmatter does not rename them. */
export function claudeCommandNames(paths: SkillSharingPaths, cwd: string | null): Set<string> {
  const names = new Set<string>();
  const roots = [path.join(paths.claudeHome, 'commands')];
  if (cwd) roots.push(path.join(cwd, '.claude', 'commands'));
  function visit(dir: string, prefix: string): void {
    try { assertUnlinkedPath(dir); } catch { return; }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const name = prefix ? `${prefix}:${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path.join(dir, entry.name), name);
      else if (entry.name.endsWith('.md')) names.add(pathKey(name.slice(0, -3), paths.platform));
    }
  }
  for (const root of roots) visit(root, '');
  return names;
}

export function codexDisabledSkillPaths(paths: SkillSharingPaths, context: SkillSharingContext): Set<string> {
  const configured = readCodexConfiguredSkills(context.projectCwd ?? paths.home, { home: paths.codexHome, userHome: paths.home });
  const disabled = new Set<string>();
  for (const entry of Array.isArray(configured) ? configured : []) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.enabled !== false || typeof entry.path !== 'string') continue;
    // Both folder and SKILL.md notation have appeared in client configuration examples.
    disabled.add(pathKey(path.resolve(entry.path), paths.platform));
  }
  return disabled;
}
