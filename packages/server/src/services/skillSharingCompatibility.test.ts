import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { addResource, removeSharingFixture, sharingFixture, writeSkill, type SharingFixture } from './skillSharingTestHelpers.js';

let fixture: SharingFixture;
beforeEach(() => { fixture = sharingFixture(); });
afterEach(() => { removeSharingFixture(fixture); });

describe('cross-engine skill compatibility', () => {
  it.each([
    ['hooks:\n  Stop: []\n', 'body', 'provider-hooks'],
    ['context: fork\n', 'body', 'provider-context'],
    ['agent: Explore\n', 'body', 'provider-context'],
    ['', 'Inspect !`git diff` before proceeding.', 'dynamic-shell'],
  ])('blocks concrete runtime extension %s', (metadata, body, issue) => {
    writeSkill(path.join(fixture.project, '.claude', 'skills'), 'my-skill', metadata, body);
    const [entry] = fixture.service.list(fixture.context);
    expect(entry).toMatchObject({ status: 'unsupported', issues: [issue] });
    expect(fixture.service.share(fixture.context, entry!.id).status).toBe('unsupported');
    expect(fs.existsSync(path.join(fixture.project, '.agents'))).toBe(false);
  });

  it('allows ordinary procedures mentioning engines, Read, Bash and review tools', () => {
    writeSkill(path.join(fixture.project, '.claude', 'skills'), 'my-skill', '', 'Claude and Codex: Read the files. Use Bash if needed.');
    expect(fixture.service.list(fixture.context)[0]).toMatchObject({ status: 'available', issues: [] });
  });

  it('shows unverified tool, model and provider-path dependencies without claiming compatibility', () => {
    writeSkill(path.join(fixture.project, '.claude', 'skills'), 'my-skill', 'allowed-tools: [Read, mcp__design__inspect]\nmodel: opus\n', 'Use mcp__design__inspect and .claude/settings.json.');
    expect(fixture.service.list(fixture.context)[0]).toMatchObject({
      status: 'available', issues: ['tool-dependency', 'provider-path', 'provider-model'],
    });
  });

  it('flags Codex plugin tools required by agents/openai.yaml', () => {
    const source = writeSkill(path.join(fixture.project, '.agents', 'skills'));
    addResource(source, 'agents/openai.yaml', 'dependencies:\n  tools:\n    - type: mcp\n      value: design\n');
    expect(fixture.service.list({ ...fixture.context, targetProvider: 'claude' })[0]).toMatchObject({
      status: 'available', issues: ['tool-dependency'],
    });
  });

  it('preserves explicit-only Claude skills by adding Codex policy without altering their text', () => {
    const source = writeSkill(path.join(fixture.project, '.claude', 'skills'), 'finish-what-was-asked', 'disable-model-invocation: true\n');
    const original = fs.readFileSync(path.join(source, 'SKILL.md'));
    const [entry] = fixture.service.list(fixture.context);
    expect(entry?.status).toBe('available');
    const result = fixture.service.share(fixture.context, entry!.id);
    expect(result.status).toBe('shared');
    expect(fs.readFileSync(path.join(result.path, 'SKILL.md'))).toEqual(original);
    expect(fs.readFileSync(path.join(result.path, 'agents', 'openai.yaml'), 'utf8')).toContain('allow_implicit_invocation: false');
    expect(fs.existsSync(path.join(source, 'agents'))).toBe(false);
    expect(fixture.service.list(fixture.context)[0]?.status).toBe('shared');
  });

  it.each([
    'interface:\n  display_name: Tone cleanup\n',
    'interface:\n  display_name: Tone cleanup\npolicy:\n  allow_implicit_invocation: true\n',
    'interface:\n  display_name: Tone cleanup\npolicy:\n  other: kept\n',
  ])('preserves other Codex metadata when enforcing the opt-out', (yaml) => {
    const source = writeSkill(path.join(fixture.project, '.claude', 'skills'), 'tone-cleanup', 'disable-model-invocation: true\n');
    addResource(source, 'agents/openai.yaml', yaml);
    const [entry] = fixture.service.list(fixture.context);
    const result = fixture.service.share(fixture.context, entry!.id);
    const actual = fs.readFileSync(path.join(result.path, 'agents/openai.yaml'), 'utf8');
    expect(actual).toContain('display_name: Tone cleanup');
    expect(actual).toContain('allow_implicit_invocation: false');
    expect(actual).not.toContain('allow_implicit_invocation: true');
    expect(fs.readFileSync(path.join(source, 'agents/openai.yaml'), 'utf8')).toBe(yaml);
    expect(fixture.service.list(fixture.context)[0]?.status).toBe('shared');
  });

  it('preserves Codex explicit-only policy when importing into Claude', () => {
    const source = writeSkill(path.join(fixture.project, '.agents', 'skills'));
    addResource(source, 'agents/openai.yaml', 'policy:\n  allow_implicit_invocation: false\n');
    const context = { ...fixture.context, targetProvider: 'claude' as const };
    const [entry] = fixture.service.list(context);
    const result = fixture.service.share(context, entry!.id);
    expect(fs.readFileSync(path.join(result.path, 'SKILL.md'), 'utf8')).toContain('disable-model-invocation: true');
    expect(fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8')).not.toContain('disable-model-invocation');
    expect(fixture.service.list(context)[0]?.status).toBe('shared');
  });

  it('reads standard folded descriptions and quoted frontmatter', () => {
    const source = writeSkill(path.join(fixture.project, '.claude', 'skills'));
    fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: "my-skill"\ndescription: >\n  First line\n  second line\n---\nBody\n');
    expect(fixture.service.list(fixture.context)[0]).toMatchObject({ description: 'First line second line', status: 'available' });
  });
});
