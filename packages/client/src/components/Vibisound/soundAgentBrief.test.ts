import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyAudioDoc } from '@vibisual/audio';
import { buildSoundAgentBrief } from './soundAgentBrief.js';

vi.mock('../../apps/registry.js', () => ({ AppAgentPreparationError: class extends Error {} }));
afterEach(() => vi.unstubAllGlobals());
describe('sound node agent brief', () => {
  it('directs the agent to the copied document and its versioned patch API', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ doc: createEmptyAudioDoc('copy-doc', 'Variant') })));
    vi.stubGlobal('fetch', request);
    const brief = await buildSoundAgentBrief({ projectId: '/project', projectName: 'Project', request: 'Lower the voice', bubble: { id: 'node', label: 'Variant', ref: 'copy-doc', file: 'old.wav' } });
    expect(brief?.ref).toBe('copy-doc');
    expect(brief?.text).toContain('First GET /api/app/vibisound/doc/copy-doc?project=Project');
    expect(brief?.text).toContain('POST /api/app/vibisound/doc/copy-doc/patch');
    expect(brief?.text).toContain('baseVersion');
    expect(brief?.text).not.toContain('old.wav');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('fails closed when the linked document cannot be read', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'unknown-doc' }), { status: 404 }));
    vi.stubGlobal('fetch', request);
    await expect(buildSoundAgentBrief({ projectId: '/project', projectName: 'Project', request: 'Edit', bubble: { id: 'node', label: 'Sound', ref: 'missing' } })).rejects.toThrow('vibisound-source-unavailable');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
