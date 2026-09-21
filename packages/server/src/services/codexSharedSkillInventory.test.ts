import { describe, expect, it } from 'vitest';
import { parseCodexPromptInputSkills } from './codexInventoryService.js';

function report(roots: string[]): string {
  return JSON.stringify([{ content: [{ text: ['<skills_instructions>',
    ...roots.map((root, i) => `- \`r${i}\` = \`${root}\``),
    ...roots.map((_root, i) => `- sample-${i}: User workflow. (file: r${i}/sample-${i}/SKILL.md)`),
    '</skills_instructions>'].join('\n') }] }]);
}

describe('shared user skill discovery in the Codex inventory', () => {
  it.each(['win32', 'darwin', 'linux'] as const)('classifies known user/project roots on %s without relabeling plugins', (platform) => {
    const base = platform === 'win32' ? 'C:/profile' : '/profile';
    const home = `${base}/.codex`;
    const roots = [`${base}/.agents/skills`, `${base}/project/.agents/skills`, `${base}/project/.codex/skills`,
      `${home}/skills/.system`, `${home}/plugins/cache/vendor/plugin/1/skills`, `${base}/unknown/skills`];
    const result = parseCodexPromptInputSkills(report(roots), home, platform, roots.slice(0, 3));
    expect(result.map((skill) => skill.source)).toEqual(['user', 'user', 'user', 'system', 'plugin', 'plugin']);
  });

  it('does not treat a similarly named sibling as the configured user root', () => {
    const roots = ['/profile/.agents/skills-backup'];
    expect(parseCodexPromptInputSkills(report(roots), '/profile/.codex', 'linux', ['/profile/.agents/skills'])[0]?.source).toBe('plugin');
  });

  it('keeps Linux path case distinctions for shared roots', () => {
    expect(parseCodexPromptInputSkills(report(['/profile/.agents/Skills']), '/profile/.codex', 'linux', ['/profile/.agents/skills'])[0]?.source).toBe('plugin');
  });
});
