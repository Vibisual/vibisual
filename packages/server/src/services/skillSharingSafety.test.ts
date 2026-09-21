import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SkillSharingService } from './skillSharingService.js';
import { sharingPaths, skillRoots, validSkillName } from './skillSharingPaths.js';
import { addResource, removeSharingFixture, sharingFixture, writeSkill, type SharingFixture } from './skillSharingTestHelpers.js';

let fixture: SharingFixture;
beforeEach(() => { fixture = sharingFixture(); });
afterEach(() => { removeSharingFixture(fixture); });

describe('skill sharing path boundaries', () => {
  it('rejects nested source symlinks and Windows junctions without copying their contents', () => {
    const source = writeSkill(path.join(fixture.project, '.claude', 'skills'));
    const outside = path.join(fixture.base, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret'), 'keep private');
    fs.symlinkSync(outside, path.join(source, 'linked'), 'junction');
    const [entry] = fixture.service.list(fixture.context);
    expect(entry).toMatchObject({ status: 'unsupported', issues: ['unsafe-path'] });
    expect(fixture.service.share(fixture.context, entry!.id).status).toBe('unsupported');
    expect(fs.existsSync(path.join(fixture.project, '.agents'))).toBe(false);
  });

  it('rejects target parent junctions and never writes outside the project', () => {
    writeSkill(path.join(fixture.project, '.claude', 'skills'));
    const outside = path.join(fixture.base, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(fixture.project, '.agents'), 'junction');
    const [entry] = fixture.service.list(fixture.context);
    expect(entry).toMatchObject({ status: 'unsupported', issues: ['unsafe-path'] });
    expect(fixture.service.share(fixture.context, entry!.id).status).toBe('unsupported');
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('rejects a target skill folder replaced by a junction after listing', () => {
    writeSkill(path.join(fixture.project, '.claude', 'skills'));
    const [entry] = fixture.service.list(fixture.context);
    const targetRoot = path.join(fixture.project, '.agents', 'skills');
    fs.mkdirSync(targetRoot, { recursive: true });
    const outside = path.join(fixture.base, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(targetRoot, 'my-skill'), 'junction');
    expect(fixture.service.share(fixture.context, entry!.id).status).toBe('unsupported');
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('does not offer source roots or skill folders that are junctions', () => {
    const outside = writeSkill(path.join(fixture.base, 'outside'));
    const root = path.join(fixture.project, '.claude', 'skills');
    fs.mkdirSync(root, { recursive: true });
    fs.symlinkSync(outside, path.join(root, 'linked'), 'junction');
    expect(fixture.service.list(fixture.context)).toEqual([]);
    fs.renameSync(root, `${root}-old`);
    fs.symlinkSync(path.dirname(outside), root, 'junction');
    expect(fixture.service.list(fixture.context)).toEqual([]);
  });

  it.each(['../escape', 'a/b', 'a\\b', 'a:b', '..', '.hidden', 'name.', 'name ', 'CON', 'NUL', 'LPT1'])('rejects unsafe skill name %s', (name) => {
    const source = writeSkill(path.join(fixture.project, '.claude', 'skills'));
    fs.writeFileSync(path.join(source, 'SKILL.md'), `---\nname: '${name}'\ndescription: safe\n---\n`);
    const [entry] = fixture.service.list(fixture.context);
    expect(entry?.status).toBe('unsupported');
    expect(entry?.issues).toContain('invalid-name');
    expect(fixture.service.share(fixture.context, entry!.id).status).toBe('unsupported');
    expect(fs.existsSync(path.join(fixture.project, '.agents'))).toBe(false);
  });

  it.each(['win32', 'darwin', 'linux'])('keeps portable names and configured roots on %s', (platform) => {
    const config = sharingPaths({ home: fixture.home, env: {}, platform });
    const roots = skillRoots(config, 'codex', fixture.project);
    expect(roots.map((root) => root.dir)).toEqual([
      path.join(fixture.project, '.agents', 'skills'), path.join(fixture.project, '.codex', 'skills'),
      path.join(fixture.home, '.codex', 'skills'), path.join(fixture.home, '.agents', 'skills'),
    ]);
    expect(validSkillName('리뷰-steps_2')).toBe(true);
    expect(validSkillName('bad:name')).toBe(false);
  });

  it.each(['win32', 'darwin', 'linux'])('uses the platform case policy for duplicate names on %s', (platform) => {
    writeSkill(path.join(fixture.project, '.claude', 'skills'), 'my-skill');
    const target = writeSkill(path.join(fixture.home, '.codex', 'skills'), 'different');
    fs.writeFileSync(path.join(target, 'SKILL.md'), '---\nname: MY-SKILL\ndescription: Existing\n---\n');
    const service = new SkillSharingService({ home: fixture.home, env: {}, platform });
    expect(service.list(fixture.context)[0]?.status).toBe(platform === 'linux' ? 'available' : 'conflict');
  });

  it('rejects a source that grows past the bounded complete-copy limit', () => {
    const source = writeSkill(path.join(fixture.project, '.claude', 'skills'));
    addResource(source, 'too-large.bin', Buffer.alloc(64 * 1024 * 1024));
    const [entry] = fixture.service.list(fixture.context);
    expect(entry).toMatchObject({ status: 'unsupported', issues: ['skill-too-large'] });
  });
});
