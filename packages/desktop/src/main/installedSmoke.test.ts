import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { consentDocuments } from './consentDocuments';
import { hasCurrentConsent } from './consentRecord';

vi.mock('@vibisual/server', () => ({ atomicWriteFileSync: vi.fn() }));

const repo = path.resolve(__dirname, '../../../..');
const requireCjs = createRequire(import.meta.url);
const { consentRecord, prepare, assertReady } = requireCjs(path.join(repo, '.github/scripts/installed-smoke.cjs'));
const scratch: string[] = [];
function temporary(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-installed-smoke-'));
  scratch.push(dir);
  return dir;
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('installed smoke — verifies the main application, not a living error dialog', () => {
  it.each(['ready', 'settle-cap'])('accepts a renderer-ready main window (%s)', (reason) => {
    expect(() => assertReady(`startup main window revealed (${reason}, 500ms after the window was created)`, '')).not.toThrow();
  });
  it.each(['', 'startup splash shown', 'startup main window revealed (hard-cap, 12000ms)',
    'startup main window revealed (forced, 500ms)'])('rejects absent or forced readiness: %s', (log) => {
    expect(() => assertReady(log, '')).toThrow('did not become ready');
  });
  it.each(['[main/error] backend-startup: failed', '[main/fatal] [boot] main module failed to load',
    '[renderer/error] failed to load'])('rejects errors even after a ready signal: %s', (error) => {
    expect(() => assertReady('startup main window revealed (ready, 500ms)', error)).toThrow('startup failure');
  });
  it('uses the exact shipped documents and the real app consent reader', () => {
    const resources = temporary();
    fs.mkdirSync(path.join(resources, 'app'));
    for (const file of ['EULA.md', 'PRIVACY.md']) fs.copyFileSync(path.join(repo, file), path.join(resources, file));
    fs.cpSync(path.join(repo, 'packages/desktop/build/license'), path.join(resources, 'legal'), { recursive: true });
    fs.copyFileSync(path.join(repo, 'packages/desktop/package.json'), path.join(resources, 'app/package.json'));
    const recordPath = path.join(resources, 'test-consent.json');
    fs.writeFileSync(recordPath, JSON.stringify(consentRecord(resources)));
    expect(hasCurrentConsent(recordPath, consentDocuments())).toBe(true);
    // A stale/modified translation cannot silently bypass the real application's consent gate.
    fs.appendFileSync(path.join(resources, 'legal/license_en_US.txt'), '\nchanged');
    fs.writeFileSync(recordPath, JSON.stringify(consentRecord(resources)));
    expect(hasCurrentConsent(recordPath, consentDocuments())).toBe(false);
  });
  it('refuses developer profiles and paths outside the runner scratch directory', () => {
    const root = temporary();
    vi.stubEnv('RUNNER_TEMP', root);
    vi.stubEnv('GITHUB_ACTIONS', '');
    expect(() => prepare('unused', path.join(root, 'profile'))).toThrow('GitHub Actions');
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    expect(() => prepare('unused', root)).toThrow('fresh child');
    expect(() => prepare('unused', path.join(root, '..', 'real-profile'))).toThrow('fresh child');
  });
});
