import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSkillSharing, shareSkill, SkillSharingRequestError } from './skillSharingApi.js';

afterEach(() => vi.unstubAllGlobals());

describe('skill sharing response boundary', () => {
  it('encodes agent identity and rejects the wrong provider response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, provider: 'claude', skills: [] })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(readSkillSharing('agent/a&b', 'codex', new AbortController().signal)).rejects.toBeInstanceOf(SkillSharingRequestError);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/skill-sharing?agentId=agent%2Fa%26b');
  });

  it.each([
    { ok: false, result: { status: 'shared', name: 'skill', path: '/skills/skill' } },
    { ok: true, result: { status: 'shared' } },
    { ok: true, result: { status: 'unknown', name: 'skill', path: '/skills/skill' } },
  ])('rejects invalid successful-looking import payload %#', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(shareSkill('agent', 'source')).rejects.toMatchObject({ kind: 'invalidResponse' });
  });

  it('rejects malformed JSON as an invalid response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('broken')));
    await expect(shareSkill('agent', 'source')).rejects.toMatchObject({ kind: 'invalidResponse' });
  });
});
