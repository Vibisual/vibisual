import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTEXT_SOURCE_IDS as IDS } from '@vibisual/shared';
import { buildCodexContextArgs, readCodexContextSources, readCodexDeveloperInstructions } from './codexContextSources.js';

let root: string;
let home: string;
let cwd: string;
const write = (file: string, text: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const options = () => ({ home, userHome: path.join(root, 'user') });

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-codex-context-'));
  home = path.join(root, 'codex');
  cwd = path.join(root, 'project', 'nested');
  fs.mkdirSync(path.join(root, 'project', '.git'), { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  write(path.join(home, 'AGENTS.md'), 'global instructions');
  write(path.join(root, 'project', 'AGENTS.md'), 'root instructions');
  write(path.join(cwd, 'AGENTS.md'), 'shadowed instructions');
  write(path.join(cwd, 'AGENTS.override.md'), 'override instructions');
  write(path.join(root, 'project', '.agents', 'skills', 'project-skill', 'SKILL.md'), '---\nname: project-skill\ndescription: useful project skill\n---\nLong body omitted from catalog');
  write(path.join(home, 'skills', '.system', 'built-in', 'SKILL.md'), '---\nname: built-in\ndescription: system skill\n---\nBody');
  write(path.join(home, 'config.toml'), [
    'developer_instructions = "safe developer text"',
    'project_doc_max_bytes = 0',
    '[mcp_servers.private]',
    'enabled = true',
    'bearer_token_env_var = "PRIVATE_TOKEN_NAME"',
    'http_headers = { Authorization = "SECRET_HEADER_VALUE" }',
    '[mcp_servers."with.dot"]',
    'command = "demo"',
    'enabled = false',
    '[plugins."example@market"]',
    'enabled = true',
  ].join('\n'));
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('native Codex context sources', () => {
  it('shows Codex docs with override precedence and keeps global instructions separate', () => {
    const sources = readCodexContextSources(cwd, options());
    const docs = sources.find((item) => item.id === IDS.codexInstructions)!;
    expect(docs.children?.map((child) => child.path)).toEqual([
      path.join(root, 'project', 'AGENTS.md'), path.join(cwd, 'AGENTS.override.md'),
    ]);
    expect(docs.defaultEnabled).toBe(false);
    expect(docs.control).toBe('spawn');
    expect(sources.find((item) => item.id === IDS.codexGlobalInstructions)?.control).toBe('none');
    expect(sources.every((item) => !item.id.startsWith('cc.'))).toBe(true);
  });

  it('includes project and built-in skills but counts only catalog descriptions', () => {
    const skills = readCodexContextSources(cwd, options()).find((item) => item.id === IDS.codexSkills)!;
    expect(skills.children?.map((child) => child.title).sort()).toEqual(['built-in', 'project-skill']);
    expect(skills.chars).toBeLessThan(100);
    expect(skills.defaultEnabled).toBe(true);
  });

  it('exposes only developer text, without adding config files or secrets to preview paths', () => {
    const items = readCodexContextSources(cwd, options());
    expect(readCodexDeveloperInstructions(cwd, options())).toBe('safe developer text');
    expect(items.find((item) => item.id === IDS.codexDeveloperInstructions)?.chars).toBe(19);
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain('PRIVATE_TOKEN_NAME');
    expect(serialized).not.toContain('SECRET_HEADER_VALUE');
    expect(serialized).not.toContain('config.toml');
  });

  it('honors native developer instructions in the selected config profile', () => {
    const profileHome = path.join(root, 'profile-home');
    write(path.join(profileHome, 'config.toml'), 'profile = "chosen"\ndeveloper_instructions = "base"\n[profiles.chosen]\ndeveloper_instructions = "profile instructions"\n');
    expect(readCodexDeveloperInstructions(cwd, { ...options(), home: profileHome })).toBe('profile instructions');
  });

  it('excludes explicitly disabled skills from disk fallback measurements', () => {
    const disabledHome = path.join(root, 'disabled-home');
    const skill = path.join(disabledHome, 'skills', 'disabled', 'SKILL.md');
    write(skill, '---\nname: disabled\ndescription: never injected\n---\nBody');
    write(path.join(disabledHome, 'config.toml'), `[[skills.config]]\npath=${JSON.stringify(skill.replace(/\\/g, '/'))}\nenabled=false\n`);
    const skills = readCodexContextSources(cwd, { ...options(), home: disabledHome }).find((item) => item.id === IDS.codexSkills)!;
    expect(skills.children?.some((child) => child.title === 'disabled')).toBe(false);
  });
});

describe('native Codex context overrides', () => {
  const scope = { projectKey: 'project', agentId: 'agent', subAgentId: 'session' };
  it('leaves the native configuration untouched when there is no override', () => {
    expect(buildCodexContextArgs(undefined, scope, cwd, options())).toEqual([]);
  });

  it('disables only verified native blocks and never emits Claude switches', () => {
    const args = buildCodexContextArgs({ projects: { project: {
      [IDS.codexInstructions]: false, [IDS.codexSkills]: false,
      [IDS.codexDeveloperInstructions]: false, [IDS.codexCollaborationInstructions]: false,
      [IDS.codexGlobalInstructions]: false, [IDS.codexHooks]: false,
    } }, agents: {}, sessions: {}, updatedAt: 1 }, scope, cwd, options());
    expect(args).toEqual([
      '-c', 'project_doc_max_bytes=0', '-c', 'skills.include_instructions=false',
      '-c', 'developer_instructions=""', '-c', 'include_collaboration_mode_instructions=false',
    ]);
  });

  it('lets the session turn a source back on without rewriting personal configuration', () => {
    const configBefore = fs.readFileSync(path.join(home, 'config.toml'), 'utf8');
    const args = buildCodexContextArgs({
      projects: { project: { [IDS.codexInstructions]: false, [IDS.codexSkills]: false } },
      agents: {},
      sessions: { session: { [IDS.codexInstructions]: true, [IDS.codexSkills]: true } }, updatedAt: 1,
    }, scope, cwd, options());
    expect(args).toEqual(['-c', 'project_doc_max_bytes=32768', '-c', 'skills.include_instructions=true']);
    expect(fs.readFileSync(path.join(home, 'config.toml'), 'utf8')).toBe(configBefore);
  });

  it('disables configured integrations with literal names and restores native enabled states on ON', () => {
    const overrides = { projects: { project: { [IDS.codexMcp]: false, [IDS.codexPlugins]: false } }, agents: {}, sessions: {}, updatedAt: 1 };
    expect(buildCodexContextArgs(overrides, scope, cwd, options())).toEqual([
      '-c', 'mcp_servers={"private"={enabled=false},"with.dot"={enabled=false}}',
      '-c', 'plugins={"example@market"={enabled=false}}',
    ]);
    expect(buildCodexContextArgs({ ...overrides, sessions: { session: { [IDS.codexMcp]: true, [IDS.codexPlugins]: true } } }, scope, cwd, options())).toEqual([]);
  });
});
