import { describe, expect, it, vi } from 'vitest';
import { buildVibimageBrief, imageAgentPrompt } from './imageAgentBrief.js';
import { AppAgentPreparationError } from '../../apps/registry.js';
import { newImageDocument, newImageLayer } from './imageDocument.js';
import type { ImageSourceDoc } from './imageApi.js';
const api = vi.hoisted(() => ({ readImageDoc: vi.fn(), createImageDoc: vi.fn() }));
vi.mock('./imageApi.js', () => api);

describe('image selection agent context', () => {
  it('stops preparation when the existing document cannot be read', async () => {
    api.readImageDoc.mockRejectedValue(new Error('Disconnected'));
    await expect(buildVibimageBrief({ projectId: '/project', projectName: 'Project', request: 'Edit',
      bubble: { id: 'node', label: 'Image', ref: 'existing' } })).rejects.toBeInstanceOf(AppAgentPreparationError);
    expect(api.createImageDoc).not.toHaveBeenCalled();
  });
  it('identifies the selected photo and properties without copying its embedded bytes into the prompt', () => {
    const payload = newImageDocument();
    payload.layers = [{ ...newImageLayer(payload, 'image', 'Product'), id: 'product', source: `data:image/png;base64,${'YQ=='.repeat(5000)}` }];
    const doc: ImageSourceDoc = { id: 'image-source', appId: 'vibimage', schemaVersion: 1, title: 'Product', revision: 5,
      payload, links: [], lockedPaths: [], parameters: {}, createdAt: 1, updatedAt: 2, label: '', author: 'user' };
    const prompt = imageAgentPrompt(doc, '/project', 'Center this image', 'product', 'draft');
    expect(prompt).toContain('"id":"product"');
    expect(prompt).toContain('"source":"<embedded raster; read the source document>"');
    expect(prompt).toContain('"baseRevision":5');
    expect(prompt).not.toContain('data:image/png;base64,');
    expect(prompt).not.toContain('YQ==');
    expect(prompt).toContain('/api/app/creation/docs/image-source');
    expect(doc.payload.layers[0]?.source).toContain('YQ==');
  });
});
