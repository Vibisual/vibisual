import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consentDocuments } from './consentDocuments';
import { ensureDesktopConsent } from './consentWindow';

const state = vi.hoisted(() => ({ home: '', userData: '', isolated: false, packaged: true }));
vi.mock('electron', () => ({
  app: {
    get isPackaged() { return state.packaged; },
    getLocale: () => 'ko',
    getPath: (key: string) => key === 'home' ? state.home : state.userData,
    commandLine: { hasSwitch: (key: string) => key === 'user-data-dir' && state.isolated },
  },
  BrowserWindow: vi.fn(function () { throw new Error('Consent UI requested'); }),
}));
vi.mock('@vibisual/server', () => ({
  atomicWriteFileSync: vi.fn((file: string, data: string) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  }),
}));
vi.mock('./appMessageBox', () => ({ showAppMessageBox: vi.fn(async () => {}) }));
vi.mock('./windowCloak', () => ({ coverFirstShow: vi.fn() }));

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vib-consent-window-'));
  state.home = join(root, 'home');
  state.userData = join(root, 'profile');
  state.isolated = false;
  state.packaged = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function accepted(file: string, version = consentDocuments().version): string {
  const data = JSON.stringify({ schema: 1, accepted: true, version, digest: 'b'.repeat(64),
    locale: 'ko', acceptedAt: '2026-10-13T12:00:00.000Z', appVersion: '0.2.0' });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  return data;
}

describe('packaged desktop consent persistence', () => {
  it('starts without a prompt after an app update with changed notices', async () => {
    accepted(join(state.home, '.vibisual', 'legal-consent.json'));
    const onPrompt = vi.fn();
    expect(await ensureDesktopConsent({ onPrompt })).toBe(true);
    expect(onPrompt).not.toHaveBeenCalled();
  });

  it('inherits existing profile acceptance without asking or changing its evidence', async () => {
    const original = accepted(join(state.userData, 'legal-consent.json'));
    const onPrompt = vi.fn();
    expect(await ensureDesktopConsent({ onPrompt })).toBe(true);
    expect(onPrompt).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(join(state.home, '.vibisual', 'legal-consent.json'), 'utf8')))
      .toEqual(JSON.parse(original));
    state.userData = join(root, 'reinstalled-profile');
    expect(await ensureDesktopConsent({ onPrompt })).toBe(true);
    expect(onPrompt).not.toHaveBeenCalled();
  });

  it('accepts an explicitly isolated profile without migrating it into the shared home', async () => {
    state.isolated = true;
    accepted(join(state.userData, 'legal-consent.json'));
    expect(await ensureDesktopConsent()).toBe(true);
    expect(() => readFileSync(join(state.home, '.vibisual', 'legal-consent.json'))).toThrow();
  });

  it('requires acceptance inside a fresh explicit profile even when the shared home is accepted', async () => {
    state.isolated = true;
    accepted(join(state.home, '.vibisual', 'legal-consent.json'));
    const onPrompt = vi.fn();
    expect(await ensureDesktopConsent({ onPrompt })).toBe(false);
    expect(onPrompt).toHaveBeenCalled();
  });

  it('requests consent for a new EULA version', async () => {
    accepted(join(state.home, '.vibisual', 'legal-consent.json'), '0.0');
    const onPrompt = vi.fn();
    expect(await ensureDesktopConsent({ onPrompt })).toBe(false);
    expect(onPrompt).toHaveBeenCalled();
  });

  it('leaves source development execution outside the distribution gate', async () => {
    state.packaged = false;
    const onPrompt = vi.fn();
    expect(await ensureDesktopConsent({ onPrompt })).toBe(true);
    expect(onPrompt).not.toHaveBeenCalled();
  });
});
