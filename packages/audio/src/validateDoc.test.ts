import { describe, expect, it } from 'vitest';
import { createEmptyAudioDoc } from './ops.js';
import { validateAudioDoc } from './validateDoc.js';

describe('untrusted audio document validation', () => {
  it('accepts the empty persisted document', () => {
    expect(validateAudioDoc(createEmptyAudioDoc('doc', 'Title', 1000)).ok).toBe(true);
  });

  it.each([
    { schemaVersion: 2 }, { version: -1 }, { version: 1.5 }, { sampleRate: Infinity },
    { channels: 6 }, { createdAt: NaN }, { tracks: null }, { assets: [] },
    { tracks: [{ id: 'track', clips: [] }, { id: 'track', clips: [] }] },
    { assets: JSON.parse('{"__proto__":{"id":"__proto__"}}') as unknown },
  ])('rejects invalid fields and unsupported schemas: %j', (patch) => {
    expect(validateAudioDoc({ ...createEmptyAudioDoc('doc'), ...patch }).ok).toBe(false);
  });

  it('rejects missing sources and non-finite clip parameters', () => {
    const doc = createEmptyAudioDoc('doc');
    const result = validateAudioDoc({ ...doc, tracks: [{ id: 'audio', clips: [{ id: 'clip', assetId: 'missing', at: 0, sourceStart: 0, duration: 1, gainDb: NaN }] }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.path.endsWith('assetId'))).toBe(true);
    expect(result.errors.some((error) => error.path.endsWith('gainDb'))).toBe(true);
  });
});
