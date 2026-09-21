import type { SkillFiles } from './skillSharingFiles.js';
import { validSkillName, type SkillProvider } from './skillSharingPaths.js';

interface SkillDocument { name: string; description: string; fields: Map<string, string>; raw: string }
export interface SkillCompatibility { name: string; description: string; issues: string[]; blocked: boolean }

function scalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try { const parsed: unknown = JSON.parse(trimmed); return typeof parsed === 'string' ? parsed : trimmed; } catch { return trimmed; }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed.replace(/\s+#.*$/, '').trim();
}

function skillDocument(tree: SkillFiles): SkillDocument {
  const raw = tree.files.get('SKILL.md')?.content.toString('utf8') ?? '';
  const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw)?.[1] ?? '';
  const fields = new Map<string, string>();
  const lines = frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = /^([\w-]+):\s*(.*)$/.exec(lines[i] ?? '');
    if (!match?.[1]) continue;
    const key = match[1];
    let value = scalar(match[2] ?? '');
    if (/^[>|][+-]?$/.test(value)) {
      const body: string[] = [];
      while (i + 1 < lines.length && /^(\s|$)/.test(lines[i + 1] ?? '')) body.push((lines[++i] ?? '').trim());
      value = body.join(' ').trim();
    }
    fields.set(key, value);
  }
  return { raw, fields, name: fields.get('name') ?? '', description: fields.get('description') ?? '' };
}

/** Only concrete syntax is classified; mentioning an engine or ordinary tool in prose is fine. */
export function skillCompatibility(tree: SkillFiles, source: SkillProvider): SkillCompatibility {
  const doc = skillDocument(tree);
  const issues: string[] = [];
  let blocked = false;
  const block = (issue: string): void => { issues.push(issue); blocked = true; };
  if (!doc.name || !doc.description) block('invalid-skill');
  if (doc.name && !validSkillName(doc.name)) block('invalid-name');
  if (doc.fields.has('hooks')) block('provider-hooks');
  if (doc.fields.get('context') === 'fork' || doc.fields.has('agent')) block('provider-context');
  if (/!`[^`]+`/.test(doc.raw)) block('dynamic-shell');
  const config = tree.files.get('agents/openai.yaml')?.content.toString('utf8') ?? '';
  if (doc.fields.has('allowed-tools') || /\bmcp__\w+|\b(?:functions|tools)\.\w+/.test(doc.raw)
    || /(?:^|\n)dependencies\s*:/.test(config)) issues.push('tool-dependency');
  if (/\.(?:claude|codex)[/\\]|\$\{?(?:CLAUDE|CODEX)_[A-Z_]+/.test(doc.raw)) issues.push('provider-path');
  if (doc.fields.has('model')) issues.push('provider-model');
  if (doc.fields.has('user-invocable')) issues.push('invocation-policy');
  if ((source === 'claude' && doc.fields.get('disable-model-invocation') === 'true')
    || (source === 'codex' && implicitInvocationDisabled(config))) issues.push('invocation-policy');
  return { name: doc.name, description: doc.description, issues: [...new Set(issues)], blocked };
}

function implicitInvocationDisabled(config: string): boolean {
  const block = /(?:^|\n)policy\s*:\s*([^\n]*(?:\n[ \t]+[^\n]*)*)/.exec(config)?.[1] ?? '';
  return /\ballow_implicit_invocation\s*:\s*false\b/.test(block);
}

/** Add the documented equivalent opt-out without changing source files or unrelated configuration. */
export function adaptInvocationPolicy(tree: SkillFiles, target: SkillProvider): SkillFiles {
  const result: SkillFiles = { files: new Map(tree.files), dirs: [...tree.dirs] };
  const doc = skillDocument(tree);
  const yaml = tree.files.get('agents/openai.yaml');
  const config = yaml?.content.toString('utf8') ?? '';
  if (target === 'codex' && doc.fields.get('disable-model-invocation') === 'true') {
    const policy = /(^|\n)(policy\s*:[^\n]*(?:\n[ \t]+[^\n]*)*)/.exec(config);
    let next: string;
    if (!policy) next = `${config}${config && !config.endsWith('\n') ? '\n' : ''}policy:\n  allow_implicit_invocation: false\n`;
    else {
      const body = policy[2] ?? '';
      // Inline maps and anchors are valid YAML but not safely editable with this small adapter.
      if (/^policy[ \t]*:[ \t]*\S/.test(body)) {
        if (implicitInvocationDisabled(config)) return result;
        throw new Error('invocation-policy');
      }
      const updated = /\ballow_implicit_invocation\s*:/.test(body)
        ? body.replace(/(\ballow_implicit_invocation\s*:)\s*[^\r\n]*/, '$1 false')
        : `${body}\n  allow_implicit_invocation: false`;
      next = config.replace(body, updated);
    }
    if (!result.dirs.includes('agents')) result.dirs.push('agents');
    result.files.set('agents/openai.yaml', { content: Buffer.from(next), mode: yaml?.mode ?? 0o644 });
  }
  if (target === 'claude' && implicitInvocationDisabled(config) && doc.fields.get('disable-model-invocation') !== 'true') {
    const skill = tree.files.get('SKILL.md');
    if (!skill) return result;
    const next = doc.fields.has('disable-model-invocation')
      ? doc.raw.replace(/^(disable-model-invocation:)\s*[^\r\n]*/m, '$1 true')
      : doc.raw.replace(/^(\uFEFF?---\r?\n)/, '$1disable-model-invocation: true\n');
    result.files.set('SKILL.md', { content: Buffer.from(next), mode: skill.mode });
  }
  return result;
}
