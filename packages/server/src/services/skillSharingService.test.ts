import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SkillSharingService } from './skillSharingService.js';
import { addResource, removeSharingFixture, sharingFixture, writeSkill, type SharingFixture } from './skillSharingTestHelpers.js';

let fixture: SharingFixture;
beforeEach(() => { fixture = sharingFixture(); });
afterEach(() => { removeSharingFixture(fixture); });

describe('user skill sharing', () => {
  it('copies a complete project skill without changing SKILL.md, binary assets or empty directories', () => {
    const source = writeSkill(path.join(fixture.project, '.claude', 'skills'));
    const binary = Buffer.from([0, 255, 34, 10]);
    addResource(source, 'assets/icon.bin', binary);
    addResource(source, 'scripts/check.sh', '#!/bin/sh\nexit 0\n');
    fs.mkdirSync(path.join(source, 'empty'));
    const [entry] = fixture.service.list(fixture.context);
    expect(entry).toMatchObject({ name: 'my-skill', sourceProvider: 'claude', scope: 'project', status: 'available' });
    const result = fixture.service.share(fixture.context, entry!.id);
    const destination = path.join(fixture.project, '.agents', 'skills', 'my-skill');
    expect(result).toMatchObject({ status: 'shared', path: destination });
    expect(fs.readFileSync(path.join(destination, 'SKILL.md'))).toEqual(fs.readFileSync(path.join(source, 'SKILL.md')));
    expect(fs.readFileSync(path.join(destination, 'assets', 'icon.bin'))).toEqual(binary);
    expect(fs.statSync(path.join(destination, 'empty')).isDirectory()).toBe(true);
    expect(fixture.service.list(fixture.context)[0]?.status).toBe('shared');
    expect(fixture.service.share(fixture.context, entry!.id).status).toBe('exists');
  });

  it('uses configured homes and preserves global scope', () => {
    const claudeHome = path.join(fixture.home, 'custom-claude');
    const codexHome = path.join(fixture.home, 'custom-codex');
    const service = new SkillSharingService({ home: fixture.home, env: { CLAUDE_CONFIG_DIR: claudeHome, CODEX_HOME: codexHome } });
    writeSkill(path.join(claudeHome, 'skills'));
    const [entry] = service.list(fixture.context);
    expect(entry?.scope).toBe('global');
    const result = service.share(fixture.context, entry!.id);
    expect(result.path).toBe(path.join(codexHome, 'skills', 'my-skill'));
    expect(fs.existsSync(path.join(fixture.project, '.agents'))).toBe(false);
  });

  it.each(['.codex', '.agents'])('imports %s global Codex skills into Claude', (folder) => {
    writeSkill(path.join(fixture.home, folder, 'skills'));
    const context = { ...fixture.context, targetProvider: 'claude' as const };
    const [entry] = fixture.service.list(context);
    expect(entry).toMatchObject({ scope: 'global', sourceProvider: 'codex' });
    expect(fixture.service.share(context, entry!.id).path).toBe(path.join(fixture.home, '.claude', 'skills', 'my-skill'));
  });

  it.each(['.codex', '.agents'])('imports %s project Codex skills into the same project', (folder) => {
    writeSkill(path.join(fixture.project, folder, 'skills'));
    const context = { ...fixture.context, targetProvider: 'claude' as const };
    const [entry] = fixture.service.list(context);
    expect(entry?.scope).toBe('project');
    expect(fixture.service.share(context, entry!.id).path).toBe(path.join(fixture.project, '.claude', 'skills', 'my-skill'));
  });

  it('does not discover managed, hidden, plugin, command or another project content', () => {
    writeSkill(path.join(fixture.home, '.codex', 'skills', '.system'), 'system-skill');
    writeSkill(path.join(fixture.home, '.codex', 'skills', 'synced'), 'synced-skill');
    writeSkill(path.join(fixture.home, '.codex', 'plugins', 'cache'), 'plugin-skill');
    writeSkill(path.join(fixture.base, 'other', '.agents', 'skills'), 'other-skill');
    writeSkill(path.join(fixture.home, '.codex', 'skills'), 'mine');
    const entries = fixture.service.list({ ...fixture.context, targetProvider: 'claude' });
    expect(entries.map((entry) => entry.name)).toEqual(['mine']);
  });

  it('never overwrites different resources, even when SKILL.md matches', () => {
    const source = writeSkill(path.join(fixture.project, '.claude', 'skills'));
    const target = writeSkill(path.join(fixture.project, '.agents', 'skills'));
    addResource(source, 'guide.txt', 'new');
    addResource(target, 'guide.txt', 'user edits');
    const [entry] = fixture.service.list(fixture.context);
    expect(entry?.status).toBe('conflict');
    expect(fixture.service.share(fixture.context, entry!.id).status).toBe('conflict');
    expect(fs.readFileSync(path.join(target, 'guide.txt'), 'utf8')).toBe('user edits');
  });

  it('detects same frontmatter name in a different folder or scope', () => {
    writeSkill(path.join(fixture.project, '.claude', 'skills'));
    const other = writeSkill(path.join(fixture.home, '.codex', 'skills'), 'renamed-folder');
    fs.writeFileSync(path.join(other, 'SKILL.md'), '---\nname: my-skill\ndescription: Existing\n---\n');
    const [entry] = fixture.service.list(fixture.context);
    expect(entry?.status).toBe('conflict');
    expect(fs.existsSync(path.join(fixture.project, '.agents'))).toBe(false);
  });

  it('does not shadow a Codex system skill', () => {
    writeSkill(path.join(fixture.home, '.claude', 'skills'));
    writeSkill(path.join(fixture.home, '.codex', 'skills', '.system'));
    expect(fixture.service.list(fixture.context)[0]?.status).toBe('conflict');
  });

  it('rechecks both source and recipient instead of trusting old list state', () => {
    const source = writeSkill(path.join(fixture.project, '.claude', 'skills'));
    const [entry] = fixture.service.list(fixture.context);
    const target = writeSkill(path.join(fixture.project, '.agents', 'skills'));
    addResource(target, 'private.txt', 'keep');
    expect(fixture.service.share(fixture.context, entry!.id).status).toBe('conflict');
    fs.renameSync(source, `${source}-moved`);
    expect(() => fixture.service.share(fixture.context, entry!.id)).toThrow('source-not-found');
  });

  it('rejects foreign IDs and cannot address arbitrary filesystem paths', () => {
    writeSkill(path.join(fixture.project, '.claude', 'skills'));
    for (const id of ['../my-skill', path.join(fixture.base, 'secret'), '0'.repeat(64)]) {
      expect(() => fixture.service.share(fixture.context, id)).toThrow('source-not-found');
    }
  });
});
