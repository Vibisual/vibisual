import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFileSync } from '@vibisual/server';
import { CONSENT_LANGUAGES } from './consentStrings';
import type { ConsentDocuments } from './consentDocuments';

const RECORD_SCHEMA = 1;
const RECORD_FILENAME = 'legal-consent.json';

export interface ConsentRecordPaths {
  current: string;
  legacy?: string;
}

/** Explicit Chromium profiles keep their own acceptance, including installed smoke profiles. */
export function consentRecordPaths(homeDir: string, userDataDir: string, isolatedProfile = false): ConsentRecordPaths {
  const legacy = join(userDataDir, RECORD_FILENAME);
  return isolatedProfile ? { current: legacy } : { current: join(homeDir, '.vibisual', RECORD_FILENAME), legacy };
}

/** Local device preference, never project state and never sent to a provider. */
function readCurrentConsent(path: string, documents: ConsentDocuments): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const valid = record.schema === RECORD_SCHEMA
      && record.version === documents.version
      // The digest records what was accepted; only a new EULA version requires another decision.
      && typeof record.digest === 'string' && /^[a-f0-9]{64}$/.test(record.digest)
      && record.accepted === true
      && typeof record.acceptedAt === 'string' && Number.isFinite(Date.parse(record.acceptedAt))
      && typeof record.appVersion === 'string' && record.appVersion.length > 0
      && CONSENT_LANGUAGES.some(({ locale }) => locale === record.locale);
    return valid ? record : null;
  } catch {
    // Missing, unreadable or damaged records do not count as consent.
    return null;
  }
}

export function hasCurrentConsent(path: string, documents: ConsentDocuments): boolean {
  return readCurrentConsent(path, documents) !== null;
}

export function restoreCurrentConsent(paths: ConsentRecordPaths, documents: ConsentDocuments): boolean {
  if (hasCurrentConsent(paths.current, documents)) return true;
  const record = paths.legacy && readCurrentConsent(paths.legacy, documents);
  if (!record) return false;
  try {
    atomicWriteFileSync(paths.current, JSON.stringify(record, null, 2) + '\n');
  } catch (error) {
    // The original acceptance is already durable; a failed migration must not ask again.
    console.warn('[consent] could not migrate acceptance:', error);
  }
  return true;
}

/** Throws on write failure: the gate must stay closed until durable acceptance succeeds. */
export function saveConsent(path: string, documents: ConsentDocuments, locale: string, appVersion: string): void {
  if (!CONSENT_LANGUAGES.some((language) => language.locale === locale)) throw new Error('Unsupported consent locale');
  atomicWriteFileSync(path, JSON.stringify({
    schema: RECORD_SCHEMA, accepted: true, version: documents.version, digest: documents.digest,
    locale, acceptedAt: new Date().toISOString(), appVersion,
  }, null, 2) + '\n');
}
