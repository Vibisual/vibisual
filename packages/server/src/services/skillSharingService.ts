import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathKey, type SkillSharingEntry, type SkillSharingResult } from '@vibisual/shared';
import { discoverSharingSkills, preparedSkill, scanSharingRoot, type DiscoveredSkill } from './skillSharingDiscovery.js';
import { readSkillFiles, skillFingerprint, writeSkillFiles, type SkillFiles } from './skillSharingFiles.js';
import { claudeCommandNames, codexDisabledSkillPaths } from './skillSharingTargetState.js';
import {
  assertWithinSkillRoot, sharingPaths, SkillSharingError, targetSkillRoot,
  type SkillSharingContext, type SkillSharingOptions, type SkillSharingPaths,
} from './skillSharingPaths.js';

export { SkillSharingError } from './skillSharingPaths.js';
export type { SkillSharingContext, SkillSharingOptions } from './skillSharingPaths.js';

interface EvaluatedSkill { entry: SkillSharingEntry; tree?: SkillFiles; destination: string; root: string }

/** No registry or synchronization state: current source/recipient files are the authority on every call. */
export class SkillSharingService {
  private readonly paths: SkillSharingPaths;
  constructor(options: SkillSharingOptions = {}) { this.paths = sharingPaths(options); }

  list(context: SkillSharingContext): SkillSharingEntry[] {
    return this.evaluate(context).map((item) => item.entry);
  }

  share(context: SkillSharingContext, sourceId: string): SkillSharingResult {
    // IDs are resolved afresh inside the known opposite-provider roots, never decoded into caller paths.
    const item = this.evaluate(context).find((candidate) => candidate.entry.id === sourceId);
    if (!item) throw new SkillSharingError('source-not-found');
    const { entry, destination, root, tree } = item;
    const result = { name: entry.name, path: destination, issues: entry.issues };
    if (entry.status === 'shared') return { ...result, status: 'exists' };
    if (entry.status !== 'available' || !tree) return { ...result, status: entry.status === 'conflict' ? 'conflict' : 'unsupported' };
    try {
      writeSkillFiles(root, destination, tree, this.paths.platform);
      return { ...result, status: 'shared' };
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'EEXIST') {
        return { ...result, status: 'conflict', issues: [...entry.issues, 'name-conflict'] };
      }
      if (err instanceof SkillSharingError) return { ...result, status: 'unsupported', issues: [...entry.issues, err.code] };
      throw err;
    }
  }

  private evaluate(context: SkillSharingContext): EvaluatedSkill[] {
    if (context.targetProvider !== 'claude' && context.targetProvider !== 'codex') throw new SkillSharingError('invalid-provider');
    const sourceProvider = context.targetProvider === 'claude' ? 'codex' : 'claude';
    const sources = discoverSharingSkills(this.paths, sourceProvider, context);
    const targets = discoverSharingSkills(this.paths, context.targetProvider, context);
    // Built-in skills remain read-only, and a user import must not shadow their names either.
    if (context.targetProvider === 'codex') targets.push(...scanSharingRoot({
      dir: path.join(this.paths.codexHome, 'skills', '.system'), scope: 'global',
    }, 'codex', this.paths));
    const commandNames = context.targetProvider === 'claude' ? claudeCommandNames(this.paths, context.projectCwd) : new Set<string>();
    const disabledPaths = context.targetProvider === 'codex' ? codexDisabledSkillPaths(this.paths, context) : new Set<string>();
    return sources.map((source) => this.evaluateOne(source, targets, context, commandNames, disabledPaths));
  }

  private evaluateOne(source: DiscoveredSkill, targets: DiscoveredSkill[], context: SkillSharingContext, commandNames: Set<string>, disabledPaths: Set<string>): EvaluatedSkill {
    const { entry } = source;
    const root = targetSkillRoot(this.paths, context, entry.scope);
    const tree = preparedSkill(source, context.targetProvider);
    const destination = tree ? path.join(root, entry.name) : root;
    const result: EvaluatedSkill = { entry, tree, destination, root };
    if (!tree) return result;
    try {
      assertWithinSkillRoot(root, destination, this.paths.platform);
      if ([destination, path.join(destination, 'SKILL.md')].some((file) => disabledPaths.has(pathKey(file, this.paths.platform)))) {
        entry.status = 'unsupported'; entry.issues.push('disabled-skill'); return result;
      }
      const nameKey = pathKey(entry.name, this.paths.platform);
      if (commandNames.has(nameKey)) {
        entry.status = 'conflict'; entry.issues.push('name-conflict'); return result;
      }
      const collisions = targets.filter((target) => [target.entry.name, path.basename(target.entry.sourcePath)]
        .some((name) => pathKey(name, this.paths.platform) === nameKey));
      if (collisions.some((target) => pathKey(target.entry.sourcePath, this.paths.platform) !== pathKey(destination, this.paths.platform))) {
        entry.status = 'conflict'; entry.issues.push('name-conflict'); return result;
      }
      if (fs.existsSync(destination)) {
        entry.status = skillFingerprint(tree) === skillFingerprint(readSkillFiles(destination)) ? 'shared' : 'conflict';
        if (entry.status === 'conflict') entry.issues.push('name-conflict');
      }
    } catch (err) {
      entry.status = 'unsupported';
      entry.issues.push(err instanceof SkillSharingError ? err.code : 'unsafe-path');
    }
    return result;
  }
}

export const skillSharingService = new SkillSharingService();
