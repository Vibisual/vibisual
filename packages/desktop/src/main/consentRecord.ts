import { readFileSync } from 'node:fs';
import { atomicWriteFileSync } from '@vibisual/server';
import { CONSENT_LANGUAGES } from './consentStrings';
import type { ConsentDocuments } from './consentDocuments';

const RECORD_SCHEMA = 1;

/** Local device preference, never project state and never sent to a provider. */
export function hasCurrentConsent(path: string, documents: ConsentDocuments): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    return record.schema === RECORD_SCHEMA
      && record.version === documents.version && record.digest === documents.digest
      && record.accepted === true
      && typeof record.acceptedAt === 'string' && Number.isFinite(Date.parse(record.acceptedAt))
      && typeof record.appVersion === 'string' && record.appVersion.length > 0
      && CONSENT_LANGUAGES.some(({ locale }) => locale === record.locale);
  } catch {
    // Missing, unreadable or damaged records do not count as consent.
    return false;
  }
}

/** Throws on write failure: the gate must stay closed until durable acceptance succeeds. */
export function saveConsent(path: string, documents: ConsentDocuments, locale: string, appVersion: string): void {
  if (!CONSENT_LANGUAGES.some((language) => language.locale === locale)) throw new Error('Unsupported consent locale');
  atomicWriteFileSync(path, JSON.stringify({
    schema: RECORD_SCHEMA, accepted: true, version: documents.version, digest: documents.digest,
    locale, acceptedAt: new Date().toISOString(), appVersion,
  }, null, 2) + '\n');
}
