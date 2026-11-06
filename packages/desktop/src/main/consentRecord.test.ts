import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atomicWriteFileSync } from '@vibisual/server';
import type { ConsentDocuments } from './consentDocuments';
import { consentRecordPaths, hasCurrentConsent, restoreCurrentConsent, saveConsent } from './consentRecord';

const state = vi.hoisted(() => ({ failWrite: false }));
vi.mock('@vibisual/server', () => ({
  atomicWriteFileSync: vi.fn((file: string, data: string): void => {
    if (state.failWrite) throw new Error('Cannot persist consent');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file + '.tmp', data);
    renameSync(file + '.tmp', file);
  }),
}));

const documents: ConsentDocuments = {
  version: '1.1', digest: 'a'.repeat(64), eula: 'Terms', privacy: 'Privacy', summaries: { en: 'Notice' },
};
let scratch: string;
let home: string;
let userData: string;

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1, accepted: true, version: '1.1', digest: 'b'.repeat(64), locale: 'ko',
    acceptedAt: '2026-10-13T10:00:00.000Z', appVersion: '0.2.0', ...overrides,
  };
}

function writeRecord(file: string, value: unknown = record()): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'vib-consent-'));
  home = join(scratch, 'home');
  userData = join(scratch, 'profile');
  state.failWrite = false;
  vi.mocked(atomicWriteFileSync).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

describe('desktop consent persistence', () => {
  it('retains acceptance across app builds and notice changes within the same EULA version', () => {
    const file = join(userData, 'legal-consent.json');
    writeRecord(file);
    expect(hasCurrentConsent(file, documents)).toBe(true);
    expect(hasCurrentConsent(file, { ...documents, digest: 'c'.repeat(64) })).toBe(true);
    expect(hasCurrentConsent(file, { ...documents, version: '1.2' })).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(record());
  });

  it.each([
    ['schema', 2], ['accepted', false], ['version', '1.0'], ['digest', undefined],
    ['digest', 'invalid'], ['acceptedAt', 'not-a-date'], ['appVersion', ''], ['locale', 'unknown'],
  ])('rejects invalid %s=%s', (field, value) => {
    const file = join(userData, 'legal-consent.json');
    writeRecord(file, record({ [field]: value }));
    expect(hasCurrentConsent(file, documents)).toBe(false);
  });

  it('requires a readable, intact acceptance record', () => {
    const paths = consentRecordPaths(home, userData);
    expect(restoreCurrentConsent(paths, documents)).toBe(false);
    for (const value of [null, [], 'accepted']) {
      writeRecord(paths.current, value);
      expect(restoreCurrentConsent(paths, documents)).toBe(false);
    }
    writeFileSync(paths.current, '{broken');
    expect(restoreCurrentConsent(paths, documents)).toBe(false);
    expect(atomicWriteFileSync).not.toHaveBeenCalled();
  });

  it('migrates legacy acceptance without changing its evidence or acceptance time', () => {
    const paths = consentRecordPaths(home, userData);
    expect(paths).toEqual({ current: join(home, '.vibisual', 'legal-consent.json'),
      legacy: join(userData, 'legal-consent.json') });
    const accepted = record({ extra: 'preserved' });
    writeRecord(paths.legacy!, accepted);
    expect(restoreCurrentConsent(paths, documents)).toBe(true);
    expect(JSON.parse(readFileSync(paths.current, 'utf8'))).toEqual(accepted);
    expect(JSON.parse(readFileSync(paths.legacy!, 'utf8'))).toEqual(accepted);
    expect(atomicWriteFileSync).toHaveBeenCalledTimes(1);
  });

  it('does not rewrite current acceptance when a legacy record remains', () => {
    const paths = consentRecordPaths(home, userData);
    writeRecord(paths.current);
    writeRecord(paths.legacy!, record({ locale: 'en', appVersion: '0.2.1' }));
    expect(restoreCurrentConsent(paths, documents)).toBe(true);
    expect(JSON.parse(readFileSync(paths.current, 'utf8'))).toEqual(record());
    expect(atomicWriteFileSync).not.toHaveBeenCalled();
  });

  it('recovers a damaged primary record from valid legacy acceptance', () => {
    const paths = consentRecordPaths(home, userData);
    writeRecord(paths.current, record({ accepted: false }));
    writeRecord(paths.legacy!);
    expect(restoreCurrentConsent(paths, documents)).toBe(true);
    expect(hasCurrentConsent(paths.current, documents)).toBe(true);
  });

  it('preserves acceptance when reinstallation replaces or relocates the app profile', () => {
    const paths = consentRecordPaths(home, userData);
    writeRecord(paths.legacy!);
    expect(restoreCurrentConsent(paths, documents)).toBe(true);
    rmSync(userData, { recursive: true });
    expect(restoreCurrentConsent(consentRecordPaths(home, join(scratch, 'new-profile')), documents)).toBe(true);
    expect(JSON.parse(readFileSync(paths.current, 'utf8'))).toEqual(record());
  });

  it('uses explicit profiles without reading or overwriting shared acceptance', () => {
    const shared = consentRecordPaths(home, userData);
    writeRecord(shared.current);
    const isolated = consentRecordPaths(home, userData, true);
    expect(isolated).toEqual({ current: join(userData, 'legal-consent.json') });
    expect(restoreCurrentConsent(isolated, documents)).toBe(false);
    saveConsent(isolated.current, documents, 'en', '0.2.6');
    expect(restoreCurrentConsent(isolated, documents)).toBe(true);
    expect(JSON.parse(readFileSync(shared.current, 'utf8'))).toEqual(record());
  });

  it('continues to recognize durable legacy consent if migration fails', () => {
    const paths = consentRecordPaths(home, userData);
    writeRecord(paths.legacy!);
    state.failWrite = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(restoreCurrentConsent(paths, documents)).toBe(true);
    expect(existsSync(paths.current)).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(hasCurrentConsent(paths.legacy!, documents)).toBe(true);
  });

  it('persists new acceptance and propagates storage failures', () => {
    const paths = consentRecordPaths(home, userData);
    saveConsent(paths.current, documents, 'ko', '0.2.6');
    expect(hasCurrentConsent(paths.current, documents)).toBe(true);
    expect(JSON.parse(readFileSync(paths.current, 'utf8'))).toMatchObject({
      accepted: true, version: documents.version, digest: documents.digest, locale: 'ko', appVersion: '0.2.6',
    });
    state.failWrite = true;
    expect(() => saveConsent(paths.current, documents, 'ko', '0.2.7')).toThrow('Cannot persist consent');
    expect(JSON.parse(readFileSync(paths.current, 'utf8')).appVersion).toBe('0.2.6');
    expect(() => saveConsent(paths.current, documents, 'unknown', '0.2.7')).toThrow('Unsupported consent locale');
  });
});
