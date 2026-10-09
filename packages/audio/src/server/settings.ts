import { badRequest, object, safeId } from './errors.js';
import type { AudioProviderCapability, AudioProviderDraft, AudioProviderSettings } from '../types.js';

export type AudioSettings = AudioProviderSettings;

const CAPABILITIES: readonly string[] = ['generate', 'transcribe', 'separate', 'enhance'];

function shortText(value: unknown, name: string, limit: number): string {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u001f]/.test(value)) {
    badRequest(`Invalid provider ${name}.`);
  }
  return value.trim();
}

export function validateSettings(raw: unknown): AudioSettings {
  if (!object(raw) || Object.keys(raw).some((key) => key !== 'providers') || !Array.isArray(raw.providers) || raw.providers.length > 24) {
    badRequest('Settings must contain at most 24 provider drafts and no credentials.');
  }
  const ids = new Set<string>();
  const providers = raw.providers.map((value): AudioProviderDraft => {
    if (!object(value) || Object.keys(value).some((key) => !['id', 'kind', 'name', 'endpoint', 'model', 'capabilities'].includes(key))) {
      badRequest('Provider drafts cannot contain API keys, tokens, or additional fields.');
    }
    if (!safeId(value.id) || ids.has(value.id) || (value.kind !== 'api' && value.kind !== 'local')) {
      badRequest('Invalid or duplicate provider id/kind.');
    }
    ids.add(value.id);
    const name = shortText(value.name, 'name', 120);
    const endpoint = shortText(value.endpoint, 'endpoint', 2048);
    const model = shortText(value.model, 'model', 200);
    if (name.length === 0) badRequest('Provider name is required.');
    if (endpoint !== '') {
      let url: URL;
      try { url = new URL(endpoint); } catch { badRequest('Provider endpoint must be an HTTP(S) URL.'); }
      // Credentials do not belong in persisted templates, including URL query strings.
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        badRequest('Provider endpoint must be HTTP(S), without credentials, query, or fragment.');
      }
    }
    if (!Array.isArray(value.capabilities) || value.capabilities.length > CAPABILITIES.length
      || value.capabilities.some((cap) => typeof cap !== 'string' || !CAPABILITIES.includes(cap))) {
      badRequest('Invalid provider capabilities.');
    }
    return { id: value.id, kind: value.kind, name, endpoint, model, capabilities: [...new Set(value.capabilities)] as AudioProviderCapability[] };
  });
  return { providers };
}
