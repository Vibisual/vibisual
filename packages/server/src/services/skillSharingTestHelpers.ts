import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SkillSharingService, type SkillSharingContext } from './skillSharingService.js';

export interface SharingFixture {
  base: string;
  home: string;
  project: string;
  service: SkillSharingService;
  context: SkillSharingContext;
}

export function sharingFixture(): SharingFixture {
  // realpath avoids the platform-owned /var -> /private/var alias on macOS.
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'vib-skill-sharing-'));
  const home = path.join(base, 'home');
  const project = path.join(base, 'project');
  fs.mkdirSync(home);
  fs.mkdirSync(project);
  return { base, home, project, service: new SkillSharingService({ home, env: {} }), context: { projectCwd: project, targetProvider: 'codex' } };
}

export function removeSharingFixture(fixture: SharingFixture): void {
  if (path.dirname(fixture.base) !== fs.realpathSync(os.tmpdir()) || !path.basename(fixture.base).startsWith('vib-skill-sharing-')) {
    throw new Error('invalid test cleanup path');
  }
  fs.rmSync(fixture.base, { recursive: true, force: true });
}

export function writeSkill(root: string, folder = 'my-skill', extra = '', body = 'Follow the project procedures.'): string {
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${folder}\ndescription: A reusable procedure\n${extra}---\n${body}\n`);
  return dir;
}

export function addResource(dir: string, relative: string, body: string | Buffer): void {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}
