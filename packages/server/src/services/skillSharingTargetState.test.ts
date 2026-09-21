import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { claudeCommandNames } from './skillSharingTargetState.js';
import { sharingPaths } from './skillSharingPaths.js';
import { addResource, removeSharingFixture, sharingFixture, writeSkill, type SharingFixture } from './skillSharingTestHelpers.js';

let fixture: SharingFixture;
beforeEach(() => { fixture = sharingFixture(); });
afterEach(() => { removeSharingFixture(fixture); });

describe('native recipient settings and invocation collisions', () => {
  it.each([false, true])('does not import or invoke a disabled Codex target (already exists: %s)', (alreadyExists) => {
    writeSkill(path.join(fixture.project, '.claude', 'skills'));
    const root = path.join(fixture.project, '.agents', 'skills');
    const target = path.join(root, 'my-skill');
    if (alreadyExists) writeSkill(root);
    const config = `[[skills.config]]\npath = ${JSON.stringify(path.join(target, 'SKILL.md'))}\nenabled = false\n`;
    addResource(path.join(fixture.home, '.codex'), 'config.toml', config);
    const [entry] = fixture.service.list(fixture.context);
    expect(entry).toMatchObject({ status: 'unsupported', issues: ['disabled-skill'] });
    expect(fixture.service.share(fixture.context, entry!.id)).toMatchObject({ status: 'unsupported', issues: ['disabled-skill'] });
    expect(fs.existsSync(target)).toBe(alreadyExists);
    expect(fs.readFileSync(path.join(fixture.home, '.codex', 'config.toml'), 'utf8')).toBe(config);
  });

  it('rechecks config when an already shared target is disabled after listing', () => {
    writeSkill(path.join(fixture.project, '.claude', 'skills'));
    const [entry] = fixture.service.list(fixture.context);
    const result = fixture.service.share(fixture.context, entry!.id);
    expect(result.status).toBe('shared');
    addResource(path.join(fixture.home, '.codex'), 'config.toml', `[[skills.config]]\npath = ${JSON.stringify(path.join(result.path, 'SKILL.md'))}\nenabled = false\n`);
    expect(fixture.service.share(fixture.context, entry!.id).status).toBe('unsupported');
  });

  it.each(['project', 'global'])('keeps an existing Claude %s command unshadowed', (scope) => {
    writeSkill(path.join(fixture.project, '.agents', 'skills'));
    const root = path.join(scope === 'project' ? fixture.project : fixture.home, '.claude');
    addResource(root, 'commands/my-skill.md', 'Existing command body');
    const context = { ...fixture.context, targetProvider: 'claude' as const };
    const [entry] = fixture.service.list(context);
    expect(entry).toMatchObject({ status: 'conflict', issues: ['name-conflict'] });
    expect(fixture.service.share(context, entry!.id).status).toBe('conflict');
    expect(fs.existsSync(path.join(fixture.project, '.claude', 'skills'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'commands/my-skill.md'), 'utf8')).toBe('Existing command body');
  });

  it('collects nested command namespaces using the existing invocation rule', () => {
    addResource(path.join(fixture.project, '.claude'), 'commands/review/security.md', 'Review command');
    const names = claudeCommandNames(sharingPaths({ home: fixture.home, env: {} }), fixture.project);
    expect(names.has('review:security')).toBe(true);
    expect(names.has('security')).toBe(false);
  });

  it('reserves Claude folder invocation names even when their frontmatter names differ', () => {
    writeSkill(path.join(fixture.project, '.agents', 'skills'));
    const existing = writeSkill(path.join(fixture.home, '.claude', 'skills'));
    fs.writeFileSync(path.join(existing, 'SKILL.md'), '---\nname: another-name\ndescription: Existing\n---\n');
    const context = { ...fixture.context, targetProvider: 'claude' as const };
    const [entry] = fixture.service.list(context);
    expect(entry?.status).toBe('conflict');
    expect(fixture.service.share(context, entry!.id).status).toBe('conflict');
    expect(fs.existsSync(path.join(fixture.project, '.claude', 'skills'))).toBe(false);
  });
});
