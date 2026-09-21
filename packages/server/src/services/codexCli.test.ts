import { describe, expect, it } from 'vitest';
import { codexStandaloneCandidatesIn } from './codexCli.js';
import { resolveBinaryIn, type BinLocatorContext } from './binLocator.js';

const homes = {
  win32: 'C:\\Users\\tester', // privacy-ok — synthetic test home
  darwin: '/Users/tester',
  linux: '/home/tester',
};

describe('Codex standalone detection before the app PATH is refreshed', () => {
  it.each(['win32', 'darwin', 'linux'] as const)('%s finds the official native installer location with an empty PATH', (platform) => {
    const home = homes[platform];
    const expected = platform === 'win32'
      ? `${home}\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe`
      : `${home}/.local/bin/codex`;
    const candidates = codexStandaloneCandidatesIn(platform, {}, home);
    const ctx: BinLocatorContext = {
      platform, home, env: {}, loginShellPath: null,
      isExecutableFile: candidate => candidate === expected,
    };
    expect(candidates).toContain(expected);
    expect(resolveBinaryIn('codex', ctx, candidates)).toBe(expected);
  });

  it('Windows respects relocated LocalAppData including spaces', () => {
    expect(codexStandaloneCandidatesIn('win32', { LOCALAPPDATA: 'D:\\App Data' }, homes.win32))
      .toEqual(['D:\\App Data\\Programs\\OpenAI\\Codex\\bin\\codex.exe']);
  });

  it.each(['win32', 'darwin', 'linux'] as const)('%s recognizes CODEX_INSTALL_DIR without changing PATH priority', (platform) => {
    const windows = platform === 'win32';
    const installDir = windows ? 'D:\\Codex Tools' : '/opt/Codex Tools';
    const pathBin = windows ? 'C:\\Tools\\codex.cmd' : '/usr/bin/codex';
    const overrideBin = `${installDir}${windows ? '\\codex.exe' : '/codex'}`;
    const candidates = codexStandaloneCandidatesIn(platform, { CODEX_INSTALL_DIR: installDir }, homes[platform]);
    expect(candidates[0]).toBe(overrideBin);
    const ctx: BinLocatorContext = {
      platform, home: homes[platform], env: { PATH: windows ? 'C:\\Tools' : '/usr/bin' }, loginShellPath: null,
      isExecutableFile: candidate => candidate === overrideBin,
    };
    expect(resolveBinaryIn('codex', ctx, candidates)).toBe(overrideBin);
    ctx.isExecutableFile = candidate => candidate === overrideBin || candidate === pathBin;
    expect(resolveBinaryIn('codex', ctx, candidates)).toBe(pathBin);
  });
});
