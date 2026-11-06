import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENT_CARD_KINDS, CARD_RULES_DOCUMENT, buildAgentCardCommonGuide, buildAgentCardGuide } from '@vibisual/shared';
import { ensureAgentCardGuides, ensureCardRulesDoc, resetCardRulesDocCache } from './cardRulesDoc.js';
import { logger } from '../logger.js';

vi.mock('../logger.js', () => ({ logger: { warn: vi.fn() } }));

let fixtureHome: string;
const guideNames = ['common.md', ...AGENT_CARD_KINDS.map((kind) => `${kind}.md`)].sort();
beforeEach(() => {
  fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-card-rules-'));
  vi.spyOn(os, 'homedir').mockReturnValue(fixtureHome);
  resetCardRulesDocCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  resetCardRulesDocCache();
  const relative = path.relative(os.tmpdir(), fixtureHome);
  if (path.isAbsolute(relative) || !relative.startsWith('vibi-card-rules-') || relative.includes(path.sep)) {
    throw new Error('Temporary card rules path escaped its fixture root');
  }
  fs.rmSync(fixtureHome, { recursive: true, force: true });
});

describe('card rules files', () => {
  it('keeps the optional rationale separate from executable guides', () => {
    const document = ensureCardRulesDoc();
    expect(document).toBe(path.join(fixtureHome, '.vibisual', 'rules', 'cards.md').replace(/\\/g, '/'));
    expect(fs.readFileSync(document!, 'utf8')).toBe(CARD_RULES_DOCUMENT);
    expect(fs.existsSync(path.join(fixtureHome, '.vibisual', 'rules', 'cards-v1'))).toBe(false);
    const read = vi.spyOn(fs, 'readFileSync');
    expect(ensureCardRulesDoc()).toBe(document);
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['posix', 'powershell'] as const)('prepares only the %s guide family outside the project', (shell) => {
    const directory = ensureAgentCardGuides(shell);
    expect(directory).toBe(path.join(fixtureHome, '.vibisual', 'rules', 'cards-v1', shell).replace(/\\/g, '/'));
    expect(fs.readdirSync(directory!).sort()).toEqual(guideNames);
    expect(fs.readFileSync(path.join(directory!, 'common.md'), 'utf8')).toBe(buildAgentCardCommonGuide(shell));
    for (const kind of AGENT_CARD_KINDS) {
      const content = fs.readFileSync(path.join(directory!, `${kind}.md`), 'utf8');
      expect(content).toBe(buildAgentCardGuide(kind, shell));
      expect(content).not.toMatch(/```(?:bash|powershell)/);
    }
    expect(fs.readdirSync(path.dirname(directory!))).toEqual([shell]);
    expect(fs.existsSync(path.join(fixtureHome, '.vibisual', 'rules', 'cards.md'))).toBe(false);
  });

  it('separates shell syntax and caches each successfully prepared family', () => {
    const posix = ensureAgentCardGuides('posix');
    const powershell = ensureAgentCardGuides('powershell');
    expect(posix).not.toBe(powershell);
    expect(fs.readFileSync(path.join(posix!, 'common.md'), 'utf8')).toContain('```bash');
    expect(fs.readFileSync(path.join(powershell!, 'common.md'), 'utf8')).toContain('```powershell');
    const read = vi.spyOn(fs, 'readFileSync');
    const write = vi.spyOn(fs, 'writeFileSync');
    expect(ensureAgentCardGuides('posix')).toBe(posix);
    expect(ensureAgentCardGuides('powershell')).toBe(powershell);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('preserves unchanged files across cache resets and replaces stale content only', () => {
    const directory = ensureAgentCardGuides('posix')!;
    const review = path.join(directory, 'review.md');
    const before = fs.statSync(review).mtimeMs;
    resetCardRulesDocCache();
    const write = vi.spyOn(fs, 'writeFileSync');
    expect(ensureAgentCardGuides('posix')).toBe(directory);
    expect(write).not.toHaveBeenCalled();
    expect(fs.statSync(review).mtimeMs).toBe(before);
    fs.writeFileSync(review, 'stale guide', 'utf8');
    write.mockClear();
    resetCardRulesDocCache();
    expect(ensureAgentCardGuides('posix')).toBe(directory);
    expect(write).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(review, 'utf8')).toBe(buildAgentCardGuide('review', 'posix'));
  });

  it.each(['common.md', 'question.md'])('withholds guides when %s fails and retries after reset', (failedFile) => {
    const originalWrite = fs.writeFileSync;
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
      if (String(file).endsWith(`${path.sep}${failedFile}`)) throw new Error('write denied');
      return originalWrite(file, data, options);
    });
    expect(ensureAgentCardGuides('posix')).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('write denied'));
    const attempted = write.mock.calls.length;
    expect(ensureAgentCardGuides('posix')).toBeUndefined();
    expect(write).toHaveBeenCalledTimes(attempted);
    write.mockRestore();
    resetCardRulesDocCache();
    const directory = ensureAgentCardGuides('posix');
    expect(directory).toBeDefined();
    expect(fs.readdirSync(directory!).sort()).toEqual(guideNames);
  });

  it('keeps rationale failures independent from guide creation', () => {
    const originalWrite = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
      if (String(file).endsWith(`${path.sep}cards.md`)) throw new Error('rationale denied');
      return originalWrite(file, data, options);
    });
    expect(ensureCardRulesDoc()).toBeUndefined();
    expect(ensureAgentCardGuides('powershell')).toBeDefined();
    expect(ensureCardRulesDoc()).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
