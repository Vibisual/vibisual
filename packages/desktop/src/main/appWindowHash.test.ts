import { describe, expect, it } from 'vitest';
import { simpleAppWindowHash } from './appWindowHash';

describe('native app draft identity', () => {
  it('round-trips a source-less autosave key into the native renderer URL', () => {
    const draftKey = 'local:12345678-1234-4234-8234-123456789abc';
    const params = new URLSearchParams(simpleAppWindowHash('vibi3d', { projectId: 'C:/한글 project', draftKey,
      appBubbleId: 'node-1', file: '', ignored: 'not-an-identity' }));
    expect(Object.fromEntries(params)).toEqual({ app: 'vibi3d', projectId: 'C:/한글 project', draftKey, appBubbleId: 'node-1' });
  });
});
